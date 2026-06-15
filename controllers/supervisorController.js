// src/controllers/supervisorController.js
const db = require('../config/db');

const supervisorController = {
    getDashboardMetrics: async (req, res) => {
        try {
            // Tangkap ID Tahun Ajaran Aktif dari query Frontend
            const { academic_year_id } = req.query;
            
            if (!academic_year_id) {
                return res.status(400).json({ error: "academic_year_id diperlukan untuk memuat dashboard." });
            }

            // 1. Dapatkan Rata-rata Nilai Sekolah (Filter by Academic Year)
            const avgGradeRes = await db.query(`
                SELECT COALESCE(ROUND(AVG(gabungan_nilai.score), 1), NULL) as avg_score 
                FROM (
                    SELECT ts.score FROM task_scores ts
                    JOIN tasks t ON ts.task_id = t.id JOIN classes c ON t.class_id = c.id
                    WHERE c.academic_year_id = $1 AND ts.score IS NOT NULL
                    UNION ALL
                    SELECT qs.score FROM quiz_scores qs
                    JOIN quizzes q ON qs.quiz_id = q.id JOIN classes c ON q.class_id = c.id
                    WHERE c.academic_year_id = $1 AND qs.score IS NOT NULL
                ) as gabungan_nilai;
            `, [academic_year_id]);
            const avgGrade = avgGradeRes.rows[0].avg_score;

            // 2A. Progress Penilaian (Persentase berkas yang sudah dinilai)
            const submissionStats = await db.query(`
                WITH GlobalSetting AS (
                    SELECT CAST(setting_value AS NUMERIC) AS default_kkm 
                    FROM app_settings WHERE setting_key = 'default_kkm' LIMIT 1
                ),
                GabunganSubmission AS (
                    SELECT ts.id, ts.score, COALESCE(s.kkm, g.default_kkm) AS kkm_acuan
                    FROM task_scores ts
                    JOIN tasks t ON ts.task_id = t.id JOIN classes c ON t.class_id = c.id JOIN subjects s ON t.subject_id = s.id
                    CROSS JOIN GlobalSetting g
                    WHERE c.academic_year_id = $1
                    UNION ALL

                    SELECT qs.id, qs.score, COALESCE(s.kkm, g.default_kkm) AS kkm_acuan
                    FROM quiz_scores qs
                    JOIN quizzes q ON qs.quiz_id = q.id JOIN classes c ON q.class_id = c.id JOIN subjects s ON q.subject_id = s.id
                    CROSS JOIN GlobalSetting g
                    WHERE c.academic_year_id = $1
                )
                SELECT 
                    COUNT(id) as total_submitted,
                    SUM(CASE WHEN score IS NOT NULL THEN 1 ELSE 0 END) as total_graded,
                    SUM(CASE WHEN score < kkm_acuan THEN 1 ELSE 0 END) as below_kkm
                FROM GabunganSubmission;
            `, [academic_year_id]);
            const { total_submitted, total_graded, below_kkm } = submissionStats.rows[0];
            const completionRate = total_submitted > 0 ? Math.round((total_graded / total_submitted) * 100) : 0;

            // 2B. Ketuntasan Belajar (Rata-rata persentase siswa lulus KKM per aset penilaian)
            const passingStats = await db.query(`
                WITH GlobalSetting AS (
                    SELECT CAST(setting_value AS NUMERIC) AS default_kkm 
                    FROM app_settings WHERE setting_key = 'default_kkm' LIMIT 1
                ),
                PerItemStats AS (
                    SELECT 
                        t.id AS item_id,
                        COUNT(ts.score) AS total_graded,
                        SUM(CASE WHEN ts.score >= COALESCE(s.kkm, g.default_kkm) THEN 1 ELSE 0 END) AS passed_count
                    FROM tasks t
                    JOIN classes c ON t.class_id = c.id
                    JOIN subjects s ON t.subject_id = s.id
                    JOIN task_scores ts ON ts.task_id = t.id
                    CROSS JOIN GlobalSetting g
                    WHERE c.academic_year_id = $1
                    GROUP BY t.id
                    
                    UNION ALL
                    
                    SELECT 
                        q.id AS item_id,
                        COUNT(qs.score) AS total_graded,
                        SUM(CASE WHEN qs.score >= COALESCE(s.kkm, g.default_kkm) THEN 1 ELSE 0 END) AS passed_count
                    FROM quizzes q
                    JOIN classes c ON q.class_id = c.id
                    JOIN subjects s ON q.subject_id = s.id
                    JOIN quiz_scores qs ON qs.quiz_id = q.id
                    CROSS JOIN GlobalSetting g
                    WHERE c.academic_year_id = $1
                    GROUP BY q.id
                )
                SELECT 
                    COALESCE(ROUND(AVG(CASE WHEN total_graded > 0 THEN (passed_count::NUMERIC / total_graded) * 100 END), 0), 0) as passing_rate
                FROM PerItemStats;
            `, [academic_year_id]);
            const passingRate = parseInt(passingStats.rows[0].passing_rate) || 0;

            // 3. Index Keaktifan Guru (Normalisasi: Rata-rata vs Guru dengan Aset Tertinggi)
            const teacherIndexRes = await db.query(`
                WITH TeacherAssets AS (
                    SELECT 
                        u.id as teacher_id,
                        (
                            (SELECT COUNT(td.id) FROM teaching_documents td WHERE td.teacher_id = u.id AND td.academic_year_id = $1) +
                            (SELECT COUNT(tj.id) FROM teaching_journals tj JOIN classes c ON tj.class_id = c.id WHERE tj.teacher_id = u.id AND c.academic_year_id = $1) +
                            (SELECT COUNT(m.id) FROM materials m JOIN classes c ON m.class_id = c.id WHERE m.teacher_id = u.id AND c.academic_year_id = $1) + 
                            (SELECT COUNT(t.id) FROM tasks t JOIN classes c ON t.class_id = c.id WHERE t.teacher_id = u.id AND c.academic_year_id = $1) +
                            (SELECT COUNT(q.id) FROM quizzes q JOIN classes c ON q.class_id = c.id WHERE q.teacher_id = u.id AND c.academic_year_id = $1)
                        ) as total_assets
                    FROM users u
                    WHERE u.role = 'teacher' AND u.is_active = true
                )
                SELECT 
                    COALESCE(SUM(total_assets), 0) as sum_assets,
                    COALESCE(AVG(total_assets), 0) as avg_assets,
                    COALESCE(MAX(total_assets), 0) as max_assets
                FROM TeacherAssets;
            `, [academic_year_id]);

            const { sum_assets, avg_assets, max_assets } = teacherIndexRes.rows[0];
            let teacherActiveIndex = 0;
            const totalAssets = parseInt(sum_assets) || 0; 
            
            if (parseFloat(max_assets) > 0) {
                teacherActiveIndex = Math.round((parseFloat(avg_assets) / parseFloat(max_assets)) * 100);
            }

            // 4. Guru Ter-Inovatif (Optimalisasi JOIN class_subjects)
            const topTeachersRes = await db.query(`
                SELECT 
                    u.full_name as name, 
                    COALESCE(
                        (SELECT s.subject_name 
                         FROM class_subjects cs 
                         JOIN subjects s ON cs.subject_id = s.id 
                         WHERE cs.teacher_id = u.id AND cs.academic_year_id = $1 
                         LIMIT 1), 'Umum'
                    ) as mapel,
                    (SELECT COUNT(*) FROM materials m JOIN classes c ON m.class_id = c.id WHERE m.teacher_id = u.id AND c.academic_year_id = $1) + 
                    (SELECT COUNT(*) FROM tasks t JOIN classes c ON t.class_id = c.id WHERE t.teacher_id = u.id AND c.academic_year_id = $1) + 
                    (SELECT COUNT(*) FROM quizzes q JOIN classes c ON q.class_id = c.id WHERE q.teacher_id = u.id AND c.academic_year_id = $1) +
                    (SELECT COUNT(*) FROM teaching_documents td WHERE td.teacher_id = u.id AND td.academic_year_id = $1) + 
                    (SELECT COUNT(*) FROM teaching_journals tj JOIN classes c ON tj.class_id = c.id WHERE tj.teacher_id = u.id AND c.academic_year_id = $1) as score
                FROM users u
                WHERE u.role = 'teacher'
                ORDER BY score DESC
                LIMIT 3
            `, [academic_year_id]);

            // 5. Siswa Teraktif
            const topStudentsRes = await db.query(`
                SELECT 
                    u.full_name as name,
                    COALESCE((SELECT c.name FROM class_members cm JOIN classes c ON cm.class_id = c.id WHERE cm.student_id = u.id AND c.academic_year_id = $1 LIMIT 1), 'Umum') as kelas,
                    ROUND(AVG(gabungan_nilai.score), 0) as point
                FROM users u
                JOIN (
                    SELECT ts.student_id, ts.score FROM task_scores ts JOIN tasks t ON ts.task_id = t.id JOIN classes c ON t.class_id = c.id WHERE c.academic_year_id = $1 AND ts.score IS NOT NULL
                    UNION ALL
                    SELECT qs.student_id, qs.score FROM quiz_scores qs JOIN quizzes q ON qs.quiz_id = q.id JOIN classes c ON q.class_id = c.id WHERE c.academic_year_id = $1 AND qs.score IS NOT NULL
                ) gabungan_nilai ON u.id = gabungan_nilai.student_id
                WHERE u.role = 'student'
                GROUP BY u.id, u.full_name
                ORDER BY point DESC
                LIMIT 3;
            `, [academic_year_id]);

            // 6. Progres Materi Per Jenjang
            const progressRes = await db.query(`
                SELECT c.grade, COUNT(m.id) as material_count 
                FROM classes c
                LEFT JOIN materials m ON c.id = m.class_id
                WHERE c.academic_year_id = $1
                GROUP BY c.grade
                ORDER BY c.grade ASC
            `, [academic_year_id]);
            
            const gradeProgress = { 7: 0, 8: 0, 9: 0 };
            progressRes.rows.forEach(r => {
                gradeProgress[r.grade] = Math.min(Math.round((parseInt(r.material_count) / 50) * 100), 100);
            });

            // 7. Audit Data Tambahan
            const activeSubjectsRes = await db.query(`SELECT COUNT(id) as count FROM subjects WHERE is_active = true`);
            
            res.json({
                kpi: {
                    avgGrade: parseFloat(avgGrade),
                    completionRate: completionRate,
                    passingRate: passingRate,
                    belowKkm: parseInt(below_kkm) || 0,
                    teacherIndex: teacherActiveIndex
                },
                topTeachers: topTeachersRes.rows,
                topStudents: topStudentsRes.rows,
                progress: gradeProgress,
                audit: {
                    activeSubjects: parseInt(activeSubjectsRes.rows[0].count),
                    totalAssets: totalAssets,
                    totalSubmissions: parseInt(total_submitted) || 0
                }
            });

        } catch (err) {
            console.error("Error Supervisor Dashboard:", err);
            res.status(500).json({ error: "Gagal memuat data laporan mutu pendidikan." });
        }
    },

    getTeacherPerformanceMetrics: async (req, res) => {
        try {
            const { academic_year_id } = req.query;
            
            if (!academic_year_id) {
                return res.status(400).json({ error: "academic_year_id diperlukan." });
            }

            const teachersRes = await db.query(`
                SELECT 
                    u.id,
                    u.full_name as name, 
                    
                    -- INOVASI BARU: Menggabungkan multi-mapel tanpa duplikat menggunakan STRING_AGG
                    COALESCE(
                        (SELECT STRING_AGG(DISTINCT s.subject_name, ', ') 
                         FROM class_subjects cs 
                         JOIN subjects s ON cs.subject_id = s.id 
                         WHERE cs.teacher_id = u.id AND cs.academic_year_id = $1), 'Umum'
                    ) as mapel,
                    
                    -- Hitung Materi
                    (SELECT COUNT(*) FROM materials m JOIN classes c ON m.class_id = c.id WHERE m.teacher_id = u.id AND c.academic_year_id = $1) as materi_count,
                    
                    -- Hitung Tugas & Kuis
                    ((SELECT COUNT(*) FROM tasks t JOIN classes c ON t.class_id = c.id WHERE t.teacher_id = u.id AND c.academic_year_id = $1) + 
                     (SELECT COUNT(*) FROM quizzes q JOIN classes c ON q.class_id = c.id WHERE q.teacher_id = u.id AND c.academic_year_id = $1)) as tugas_count,
                    
                    -- Hitung Total Aset KBM
                    (
                        (SELECT COUNT(*) FROM materials m JOIN classes c ON m.class_id = c.id WHERE m.teacher_id = u.id AND c.academic_year_id = $1) + 
                        (SELECT COUNT(*) FROM tasks t JOIN classes c ON t.class_id = c.id WHERE t.teacher_id = u.id AND c.academic_year_id = $1) + 
                        (SELECT COUNT(*) FROM quizzes q JOIN classes c ON q.class_id = c.id WHERE q.teacher_id = u.id AND c.academic_year_id = $1) +
                        (SELECT COUNT(*) FROM teaching_documents td WHERE td.teacher_id = u.id AND td.academic_year_id = $1) + 
                        (SELECT COUNT(*) FROM teaching_journals tj JOIN classes c ON tj.class_id = c.id WHERE tj.teacher_id = u.id AND c.academic_year_id = $1)
                    ) as total_assets,
                    
                    -- Hitung Rata-rata Nilai Siswa
                    COALESCE((
                        SELECT ROUND(AVG(gabungan_nilai.score), 1)
                        FROM (
                            SELECT ts.score FROM task_scores ts JOIN tasks t ON ts.task_id = t.id JOIN classes c ON t.class_id = c.id WHERE c.academic_year_id = $1 AND t.teacher_id = u.id AND ts.score IS NOT NULL
                            UNION ALL
                            SELECT qs.score FROM quiz_scores qs JOIN quizzes q ON qs.quiz_id = q.id JOIN classes c ON q.class_id = c.id WHERE c.academic_year_id = $1 AND q.teacher_id = u.id AND qs.score IS NOT NULL
                        ) gabungan_nilai
                    ), 0) as avg_grade

                FROM users u
                WHERE u.role = 'teacher' AND u.is_active = true
                ORDER BY total_assets DESC;
            `, [academic_year_id]);

            res.json({
                data: teachersRes.rows
            });

        } catch (err) {
            console.error("Error Supervisor Teacher Performance:", err);
            res.status(500).json({ error: "Gagal memuat data performa guru." });
        }
    },

    // Tambahkan di src/controllers/supervisorController.js

getTeacherDetailedAssets: async (req, res) => {
        try {
            const { academic_year_id, teacher_id } = req.query;
            
            if (!academic_year_id || !teacher_id) {
                return res.status(400).json({ error: "academic_year_id dan teacher_id diperlukan." });
            }

            // 1. Ambil Materi (Dengan URL File/Link)
            const materials = await db.query(`
                SELECT m.id, m.title, m.description, m.file_url, m.link_url, m.created_at, CONCAT(c.grade,'-',c.name) as class_name, COALESCE(s.subject_name, 'Umum') as subject_name
                FROM materials m 
                JOIN classes c ON m.class_id = c.id 
                LEFT JOIN subjects s ON m.subject_id = s.id
                WHERE m.teacher_id = $1 AND c.academic_year_id = $2
                ORDER BY m.created_at DESC
            `, [teacher_id, academic_year_id]);

            // 2. Ambil Tugas & Kuis (Digabung sebagai Assessments)
            const tasks = await db.query(`
                SELECT t.id, t.title, t.file_url, t.link_url, t.due_date as target_date, CONCAT(c.grade,'-',c.name) as class_name, COALESCE(s.subject_name, 'Umum') as subject_name, 'Tugas' as type
                FROM tasks t 
                JOIN classes c ON t.class_id = c.id 
                LEFT JOIN subjects s ON t.subject_id = s.id
                WHERE t.teacher_id = $1 AND c.academic_year_id = $2
            `, [teacher_id, academic_year_id]);

            const quizzes = await db.query(`
                SELECT q.id, q.title, NULL as file_url, q.embed_url as link_url, NULL as target_date, CONCAT(c.grade,'-',c.name) as class_name, COALESCE(s.subject_name, 'Umum') as subject_name, 'Kuis' as type
                FROM quizzes q 
                JOIN classes c ON q.class_id = c.id 
                LEFT JOIN subjects s ON q.subject_id = s.id
                WHERE q.teacher_id = $1 AND c.academic_year_id = $2
            `, [teacher_id, academic_year_id]);

            // 3. Ambil Perangkat Pembelajaran / Dokumen
            const documents = await db.query(`
                SELECT td.id, td.title, td.description, td.file_url, td.link_url, td.grade, COALESCE(s.subject_name, 'Umum') as subject_name
                FROM teaching_documents td
                LEFT JOIN subjects s ON td.subject_id = s.id
                WHERE td.teacher_id = $1 AND td.academic_year_id = $2
                ORDER BY td.created_at DESC
            `, [teacher_id, academic_year_id]);

            // 4. Ambil Jurnal Mengajar (Logika mendalam sesuai permintaanmu)
            const journals = await db.query(`
                SELECT tj.id, tj.journal_date, tj.real_time_range, tj.slots_taught, tj.notes, tj.is_substitute, tj.substitute_name, CONCAT(c.grade,'-',c.name) as class_name, COALESCE(s.subject_name, 'Umum') as subject_name
                FROM teaching_journals tj
                JOIN classes c ON tj.class_id = c.id
                LEFT JOIN subjects s ON tj.subject_id = s.id
                WHERE tj.teacher_id = $1 AND c.academic_year_id = $2
                ORDER BY tj.journal_date DESC
            `, [teacher_id, academic_year_id]);

            res.json({
                materials: materials.rows,
                assessments: [...tasks.rows, ...quizzes.rows].sort((a, b) => new Date(b.target_date || 0) - new Date(a.target_date || 0)),
                documents: documents.rows,
                journals: journals.rows
            });

        } catch (err) {
            console.error("Error Get Teacher Detailed Assets:", err);
            res.status(500).json({ error: "Gagal memuat detail aset mengajar." });
        }
    },
    
    getStudentStatistics: async (req, res) => {
        try {
            const { academic_year_id } = req.query;
            
            if (!academic_year_id) {
                return res.status(400).json({ error: "academic_year_id diperlukan untuk memuat statistik." });
            }

            // 1. KPI: Total Siswa & Siswa Aktif di Tahun Ajaran Ini
            const studentCountRes = await db.query(`
                SELECT 
                    COUNT(DISTINCT cm.student_id) as total,
                    SUM(CASE WHEN u.is_active = true THEN 1 ELSE 0 END) as aktif
                FROM class_members cm
                JOIN classes c ON cm.class_id = c.id
                JOIN users u ON cm.student_id = u.id
                WHERE c.academic_year_id = $1;
            `, [academic_year_id]);
            const { total, aktif } = studentCountRes.rows[0];

            // 2. KPI: Ketuntasan KKM Sekolah & Hitung Siswa Berisiko (Unik)
            // Definisi Berisiko POV Supervisor: Siswa yang memiliki >= 2 kali nilai di bawah KKM (Tugas/Kuis)
            const riskAndPassingRes = await db.query(`
                WITH GlobalSetting AS (
                    SELECT CAST(setting_value AS NUMERIC) AS default_kkm 
                    FROM app_settings WHERE setting_key = 'default_kkm' LIMIT 1
                ),
                -- Gabungkan semua nilai beserta ID itemnya (Task/Quiz)
                GabunganNilai AS (
                    SELECT ts.student_id, ts.score, COALESCE(s.kkm, g.default_kkm) AS kkm_acuan, t.id as item_id, 'task' as item_type
                    FROM task_scores ts
                    JOIN tasks t ON ts.task_id = t.id JOIN classes c ON t.class_id = c.id JOIN subjects s ON t.subject_id = s.id CROSS JOIN GlobalSetting g WHERE c.academic_year_id = $1 AND ts.score IS NOT NULL
                    UNION ALL
                    SELECT qs.student_id, qs.score, COALESCE(s.kkm, g.default_kkm) AS kkm_acuan, q.id as item_id, 'quiz' as item_type
                    FROM quiz_scores qs
                    JOIN quizzes q ON qs.quiz_id = q.id JOIN classes c ON q.class_id = c.id JOIN subjects s ON q.subject_id = s.id CROSS JOIN GlobalSetting g WHERE c.academic_year_id = $1 AND qs.score IS NOT NULL
                ),
                -- Metrik A: Hitung Total Remedial Per Siswa (Untuk Siswa Berisiko)
                SiswaMetrics AS (
                    SELECT 
                        student_id,
                        SUM(CASE WHEN score < kkm_acuan THEN 1 ELSE 0 END) as total_remedial
                    FROM GabunganNilai
                    GROUP BY student_id
                ),
                -- Metrik B: Hitung Ketuntasan Per Item Penilaian (SAMA PERSIS DENGAN DASHBOARD)
                PerItemStats AS (
                    SELECT 
                        item_id,
                        item_type,
                        COUNT(score) AS total_graded,
                        SUM(CASE WHEN score >= kkm_acuan THEN 1 ELSE 0 END) AS passed_count
                    FROM GabunganNilai
                    GROUP BY item_id, item_type
                )
                SELECT 
                    (SELECT COUNT(student_id) FROM SiswaMetrics WHERE total_remedial >= 2) as berisiko_count,
                    (SELECT COALESCE(ROUND(AVG(CASE WHEN total_graded > 0 THEN (passed_count::NUMERIC / total_graded) * 100 END), 0), 0) FROM PerItemStats) as passing_rate;
            `, [academic_year_id]);
            
            const berisiko_count = parseInt(riskAndPassingRes.rows[0].berisiko_count) || 0;
            const passing_rate = (riskAndPassingRes.rows[0].passing_rate || 0) + "%";

            // 3. Grafik: Kesehatan Nilai Rata-rata per Jenjang (Kelas 7, 8, 9)
            const gradeHealthRes = await db.query(`
                SELECT c.grade, COALESCE(ROUND(AVG(gabungan.score), 0), 0) as avg_score
                FROM classes c
                JOIN (
                    SELECT t.class_id, ts.score FROM task_scores ts JOIN tasks t ON ts.task_id = t.id WHERE ts.score IS NOT NULL
                    UNION ALL
                    SELECT q.class_id, qs.score FROM quiz_scores qs JOIN quizzes q ON qs.quiz_id = q.id WHERE qs.score IS NOT NULL
                ) gabungan ON c.id = gabungan.class_id
                WHERE c.academic_year_id = $1
                GROUP BY c.grade
                ORDER BY c.grade ASC;
            `, [academic_year_id]);
            
            const gradeHealth = { 'VII': 0, 'VIII': 0, 'IX': 0 };
            gradeHealthRes.rows.forEach(r => {
                if(gradeHealth.hasOwnProperty(r.grade)) {
                    gradeHealth[r.grade] = parseInt(r.avg_score);
                }
            });

// 4. Leaderboard: 5 Siswa Teraktif & Berprestasi (Nilai Rata-rata Tertinggi + Akumulasi Poin Tugas)
        const topStudentsRes = await db.query(`
            WITH GlobalSetting AS (
                SELECT CAST(setting_value AS NUMERIC) AS default_kkm 
                FROM app_settings 
                WHERE setting_key = 'default_kkm' 
                LIMIT 1
            )
            SELECT 
                ROW_NUMBER() OVER (ORDER BY AVG(gabungan_nilai.score) DESC) as rank,
                u.full_name as name,
                COALESCE((SELECT c.name FROM class_members cm JOIN classes c ON cm.class_id = c.id WHERE cm.student_id = u.id AND c.academic_year_id = $1 LIMIT 1), 'Umum') as kelas,
                (COUNT(gabungan_nilai.score) * 15) as xp, -- Formula XP: Jumlah submit dikali bobot keaktifan
                ROUND(AVG(gabungan_nilai.score), 0) as avg,
                CASE 
                    -- Excellent: Titik tengah antara KKM dan 100
                    WHEN AVG(gabungan_nilai.score) >= ((100.0 - MAX(g.default_kkm)) / 2.0) + MAX(g.default_kkm) THEN 'Excellent'
                    -- Good: Tepat atau di atas KKM
                    WHEN AVG(gabungan_nilai.score) >= MAX(g.default_kkm) THEN 'Good'
                    -- Need Attention: Di bawah KKM
                    ELSE 'Need Attention'
                END as status
            FROM users u
            CROSS JOIN GlobalSetting g
            JOIN (
                SELECT ts.student_id, ts.score FROM task_scores ts JOIN tasks t ON ts.task_id = t.id JOIN classes c ON t.class_id = c.id WHERE c.academic_year_id = $1 AND ts.score IS NOT NULL
                UNION ALL
                SELECT qs.student_id, qs.score FROM quiz_scores qs JOIN quizzes q ON qs.quiz_id = q.id JOIN classes c ON q.class_id = c.id WHERE c.academic_year_id = $1 AND qs.score IS NOT NULL
            ) gabungan_nilai ON u.id = gabungan_nilai.student_id
            WHERE u.role = 'student'
            GROUP BY u.id, u.full_name
            ORDER BY avg DESC
            LIMIT 5;
        `, [academic_year_id]);

            res.json({
                studentStats: {
                    total: parseInt(total) || 0,
                    aktif: parseInt(aktif) || 0,
                    berisiko: berisiko_count,
                    tuntas: passing_rate
                },
                gradeHealth,
                topStudents: topStudentsRes.rows
            });

        } catch (err) {
            console.error("Error Supervisor Student Statistics:", err);
            res.status(500).json({ error: "Gagal memuat data statistik siswa." });
        }
    },

    // --- FUNGSI BARU UNTUK LIST SISWA & DETAIL RAPOR ---
    getStudentList: async (req, res) => {
        try {
            const { academic_year_id } = req.query;
            if (!academic_year_id) return res.status(400).json({ error: "academic_year_id diperlukan." });

            const studentsRes = await db.query(`
                SELECT 
                    u.id, 
                    u.full_name as name, 
                    u.username as nis,
                    CONCAT(c.grade, '-', c.name) as class_name,
                    c.id as class_id,
                    COALESCE((
                        SELECT ROUND(AVG(gabungan_nilai.score), 1)
                        FROM (
                            SELECT ts.score FROM task_scores ts JOIN tasks t ON ts.task_id = t.id WHERE t.class_id = c.id AND ts.student_id = u.id AND ts.score IS NOT NULL
                            UNION ALL
                            SELECT qs.score FROM quiz_scores qs JOIN quizzes q ON qs.quiz_id = q.id WHERE q.class_id = c.id AND qs.student_id = u.id AND qs.score IS NOT NULL
                        ) gabungan_nilai
                    ), 0) as avg_score,
                    (
                        SELECT SUM(CASE WHEN score < kkm_acuan THEN 1 ELSE 0 END)
                        FROM (
                            SELECT ts.score, COALESCE(s.kkm, (SELECT CAST(setting_value AS NUMERIC) FROM app_settings WHERE setting_key = 'default_kkm' LIMIT 1)) AS kkm_acuan
                            FROM task_scores ts JOIN tasks t ON ts.task_id = t.id JOIN subjects s ON t.subject_id = s.id WHERE t.class_id = c.id AND ts.student_id = u.id AND ts.score IS NOT NULL
                            UNION ALL
                            SELECT qs.score, COALESCE(s.kkm, (SELECT CAST(setting_value AS NUMERIC) FROM app_settings WHERE setting_key = 'default_kkm' LIMIT 1)) AS kkm_acuan
                            FROM quiz_scores qs JOIN quizzes q ON qs.quiz_id = q.id JOIN subjects s ON q.subject_id = s.id WHERE q.class_id = c.id AND qs.student_id = u.id AND qs.score IS NOT NULL
                        ) all_scores
                    ) as remedial_count
                FROM users u
                JOIN class_members cm ON u.id = cm.student_id
                JOIN classes c ON cm.class_id = c.id
                WHERE u.role = 'student' AND c.academic_year_id = $1
                ORDER BY c.grade, c.name, u.full_name
            `, [academic_year_id]);

            res.json(studentsRes.rows);
        } catch (err) {
            console.error("Error getStudentList:", err);
            res.status(500).json({ error: "Gagal mengambil daftar siswa." });
        }
    },

    getStudentDetailPerformance: async (req, res) => {
        try {
            const { academic_year_id, student_id } = req.query;
            if (!academic_year_id || !student_id) {
                return res.status(400).json({ error: "Parameter academic_year_id dan student_id diperlukan." });
            }

            // 1. Ambil Nama Lengkap Siswa untuk pencocokan teks di kolom absent_students
            const studentRes = await db.query("SELECT full_name FROM users WHERE id = $1", [student_id]);
            if (studentRes.rows.length === 0) {
                return res.status(404).json({ error: "Siswa tidak ditemukan." });
            }
            const studentName = studentRes.rows[0].full_name;

            // 2. Ambil KKM bawaan global sekolah
            const globalKkmRes = await db.query("SELECT CAST(setting_value AS NUMERIC) as kkm FROM app_settings WHERE setting_key = 'default_kkm' LIMIT 1");
            const globalKkm = globalKkmRes.rows.length > 0 ? globalKkmRes.rows[0].kkm : 75;

            // 3. Ambil Rekam Nilai Tugas Siswa
            const tasksRes = await db.query(`
                SELECT t.title, COALESCE(s.subject_name, 'Umum') as subject_name, ts.score, t.due_date as date, 'Tugas' as type, COALESCE(s.kkm, $3) as kkm
                FROM tasks t
                JOIN subjects s ON t.subject_id = s.id
                JOIN class_members cm ON t.class_id = cm.class_id
                LEFT JOIN task_scores ts ON ts.task_id = t.id AND ts.student_id = $1
                WHERE cm.student_id = $1 AND t.class_id IN (SELECT id FROM classes WHERE academic_year_id = $2)
            `, [student_id, academic_year_id, globalKkm]);

            // 4. Ambil Rekam Nilai Kuis Siswa
            const quizzesRes = await db.query(`
                SELECT q.title, COALESCE(s.subject_name, 'Umum') as subject_name, qs.score, q.exam_date as date, 'Kuis' as type, COALESCE(s.kkm, $3) as kkm
                FROM quizzes q
                JOIN subjects s ON q.subject_id = s.id
                JOIN class_members cm ON q.class_id = cm.class_id
                LEFT JOIN quiz_scores qs ON qs.quiz_id = q.id AND qs.student_id = $1
                WHERE cm.student_id = $1 AND q.class_id IN (SELECT id FROM classes WHERE academic_year_id = $2)
            `, [student_id, academic_year_id, globalKkm]);

            // 5. Ambil Log Jurnal Mengajar - Tarik absent_student_ids DAN absent_students sekaligus
            const journalsRes = await db.query(`
                SELECT tj.journal_date, tj.real_time_range, tj.notes, COALESCE(s.subject_name, 'Umum') as subject_name, tj.absent_student_ids, tj.absent_students
                FROM teaching_journals tj
                LEFT JOIN subjects s ON tj.subject_id = s.id
                JOIN class_members cm ON tj.class_id = cm.class_id
                WHERE cm.student_id = $1 AND tj.class_id IN (SELECT id FROM classes WHERE academic_year_id = $2)
                ORDER BY tj.journal_date DESC
            `, [student_id, academic_year_id]);

            // 6. PILA LOGIKA: ID Array untuk Deteksi Utama, Kolom Teks untuk Detail Alasan
            const attendanceLog = journalsRes.rows.map(j => {
                let isAbsent = false;
                let status = 'Hadir'; // Default jika ID siswa tidak masuk daftar absen
                let reason = null;

                // TAHAP A: Validasi mutlak menggunakan Array ID Siswa
                try {
                    const absentIds = typeof j.absent_student_ids === 'string' 
                        ? JSON.parse(j.absent_student_ids) 
                        : (j.absent_student_ids || []);
                    if (Array.isArray(absentIds) && absentIds.map(Number).includes(Number(student_id))) {
                        isAbsent = true;
                    }
                } catch (e) {
                    // Fallback aman jika penyimpanan string JSON di DB mentah
                    if (String(j.absent_student_ids).includes(`"${student_id}"`) || String(j.absent_student_ids).includes(String(student_id))) {
                        isAbsent = true;
                    }
                }

                // TAHAP B: Jika terbukti absen, bedah teks di kolom absent_students untuk cari Detail Status & Alasan
                if (isAbsent) {
                    status = 'Alpha'; // Fallback default jika teks nama/keterangan tidak cocok
                    
                    if (j.absent_students) {
                        // Escape karakter regex bawaan dari nama lengkap siswa agar aman di RegExp
                        const escapedName = studentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        
                        // Regex menangkap pola: Nama Siswa (Tipe Kehadiran - Alasan)
                        const regex = new RegExp(`${escapedName}\\s*\\(([^)]+)\\)`, 'i');
                        const match = j.absent_students.match(regex);

                        if (match) {
                            const extractedText = match[1]; // Ambil teks dalam tanda kurung (...)
                            
                            // Cek jika guru menyertakan alasan lewat tanda pisah strip (-)
                            if (extractedText.includes('-')) {
                                const splitIndex = extractedText.indexOf('-');
                                status = extractedText.substring(0, splitIndex).trim();
                                reason = extractedText.substring(splitIndex + 1).trim();
                            } else {
                                // Jika guru tidak menulis alasan (hanya tipe kehadiran saja seperti "Sakit")
                                status = extractedText.trim();
                            }
                        }
                    }
                }
                
                return {
                    date: j.journal_date,
                    time: j.real_time_range,
                    subject: j.subject_name,
                    status: status, // Bernilai 'Hadir', 'Sakit', 'Izin', 'Alpha', dll.
                    reason: reason, // Berisi teks alasan (bisa null jika guru tidak mengisi alasan)
                    notes: j.notes
                };
            });

            res.json({
                assessments: [...tasksRes.rows, ...quizzesRes.rows].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)),
                attendance: attendanceLog
            });

        } catch (err) {
            console.error("Error getStudentDetailPerformance:", err);
            res.status(500).json({ error: "Gagal mengambil detail rekam jejak siswa." });
        }
    }
};

module.exports = supervisorController;