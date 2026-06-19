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
                    SELECT COALESCE(
                        (SELECT default_kkm FROM academic_year_kkm WHERE academic_year_id = $1 LIMIT 1), 
                        80
                    ) AS default_kkm
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

            // 6. Progres Akselerasi JP Per Jenjang (Berdasarkan Target JP vs Realisasi Jurnal)
            const progressRes = await db.query(`
                WITH CurriculumData AS (
                    SELECT 
                        c.grade,
                        s.target_jp,
                        COALESCE(SUM(
                            CASE 
                                WHEN tj.slots_taught IS NULL OR TRIM(tj.slots_taught) = '' THEN 0
                                ELSE ARRAY_LENGTH(STRING_TO_ARRAY(tj.slots_taught, ','), 1)
                            END
                        ), 0) as total_slots
                    FROM classes c
                    CROSS JOIN subjects s
                    LEFT JOIN (
                        SELECT DISTINCT 
                            sch.class_id, 
                            cs.subject_id
                        FROM schedules sch
                        JOIN class_subjects cs ON sch.class_subject_id = cs.id
                        WHERE cs.academic_year_id = $1
                    ) cs_map ON cs_map.class_id = c.id AND cs_map.subject_id = s.id
                    LEFT JOIN teaching_journals tj ON tj.class_id = c.id AND tj.subject_id = s.id AND c.academic_year_id = $1
                    WHERE c.academic_year_id = $1
                    GROUP BY c.id, c.grade, s.id, s.target_jp
                    HAVING COUNT(cs_map.subject_id) > 0 
                       OR COALESCE(SUM(CASE WHEN tj.slots_taught IS NULL OR TRIM(tj.slots_taught) = '' THEN 0 ELSE ARRAY_LENGTH(STRING_TO_ARRAY(tj.slots_taught, ','), 1) END), 0) > 0
                )
                SELECT 
                    grade,
                    COALESCE(SUM(target_jp), 0) as total_target_jp,
                    COALESCE(SUM(total_slots), 0) as total_slots
                FROM CurriculumData
                GROUP BY grade
                ORDER BY grade ASC;
            `, [academic_year_id]);
            
            // Format data menjadi object { progress, actual, target } agar UI bisa menampilkan detailnya

// 6. Progres Akselerasi JP Per Jenjang
            
            // Kita pastikan formatnya object kosong untuk menampung data dinamis
            const gradeProgress = {}; 

            progressRes.rows.forEach(r => {
                // R.grade akan membaca 'VII', 'VIII', dll sesuai isi database
                const gradeStr = r.grade; 
                const target = parseInt(r.total_target_jp) || 0;
                const actual = parseInt(r.total_slots) || 0;
                
                // 1. JIKA JENJANG INI BELUM ADA DI OBJECT, BIKIN BARU OTOMATIS
                if(!gradeProgress[gradeStr]) {
                    gradeProgress[gradeStr] = {
                        progress: 0,
                        actual: 0,
                        target: 0
                    };
                }
                
                // 2. AKUMULASIKAN DATA MAPEL KE JENJANG TERSEBUT
                gradeProgress[gradeStr].target += target;
                gradeProgress[gradeStr].actual += actual;
            });

            // 3. HITUNG PERSENTASE SETELAH SEMUANYA TERKUMPUL
            Object.keys(gradeProgress).forEach(grade => {
                const item = gradeProgress[grade];
                
                if (item.target > 0) {
                    // Hitung progres (dibatasi maksimal 100%)
                    item.progress = Math.min(Math.round((item.actual / item.target) * 100), 100);
                } else {
                    // Jika target total jenjang ini 0, kembalikan 0 agar FE memunculkan "Target belum di atur"
                    item.progress = 0;
                }
            });

            // Lanjut ke bagian 7. Audit Data Tambahan...

            // 7. Audit Data Tambahan 
            // ... (lanjutkan ke kode auditRes seperti sebelumnya)

            const auditRes = await db.query(`
                SELECT COUNT(*) as active_subjects FROM class_subjects WHERE academic_year_id = $1
            `, [academic_year_id]);
            const activeSubjects = parseInt(auditRes.rows[0].active_subjects) || 0;

            // 8. KEMBALIKAN SEMUA DATA KE FRONTEND
            res.json({
                kpi: {
                    avgGrade: avgGrade || 0,
                    completionRate: completionRate || 0,
                    passingRate: passingRate || 0,
                    belowKkm: below_kkm || 0,
                    teacherIndex: teacherActiveIndex || 0
                },
                topTeachers: topTeachersRes.rows,
                topStudents: topStudentsRes.rows,
                progress: gradeProgress,
                audit: {
                    activeSubjects: activeSubjects,
                    totalAssets: totalAssets, // Didapat dari query teacherIndexRes
                    totalSubmissions: total_submitted // Didapat dari query submissionStats
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
    },

    getCurriculumProgress: async (req, res) => {
        try {
            const { academic_year_id } = req.query;
            if (!academic_year_id) {
                return res.status(400).json({ error: "academic_year_id diperlukan." });
            }

            const result = await db.query(`
                SELECT 
                    c.grade,
                    c.id as class_id,
                    c.name as class_name,
                    s.id as subject_id,
                    COALESCE(s.subject_name, 'Umum') as mapel,
                    s.target_jp, -- <--- TAMBAHKAN INI
                    STRING_AGG(DISTINCT u.full_name, ', ') as guru,
                    COALESCE(SUM(
                        CASE 
                            WHEN tj.slots_taught IS NULL OR TRIM(tj.slots_taught) = '' THEN 0
                            ELSE ARRAY_LENGTH(STRING_TO_ARRAY(tj.slots_taught, ','), 1)
                        END
                    ), 0) as total_slots,
                    COUNT(CASE WHEN tj.is_substitute = true THEN 1 END) as substitute_count
                FROM classes c
                CROSS JOIN subjects s
                
                LEFT JOIN (
                    SELECT DISTINCT 
                        sch.class_id, 
                        cs.subject_id, 
                        cs.teacher_id, 
                        cs.id as cs_id
                    FROM schedules sch
                    JOIN class_subjects cs ON sch.class_subject_id = cs.id
                    WHERE cs.academic_year_id = $1
                ) cs_map ON cs_map.class_id = c.id AND cs_map.subject_id = s.id
                
                LEFT JOIN users u ON cs_map.teacher_id = u.id
                LEFT JOIN teaching_journals tj ON tj.class_id = c.id AND tj.subject_id = s.id AND c.academic_year_id = $1
                
                WHERE c.academic_year_id = $1
                GROUP BY c.id, c.grade, c.name, s.id, s.subject_name, s.target_jp -- <--- TAMBAHKAN DI SINI JUGA
                HAVING COUNT(cs_map.cs_id) > 0 OR COALESCE(SUM(CASE WHEN tj.slots_taught IS NULL OR TRIM(tj.slots_taught) = '' THEN 0 ELSE ARRAY_LENGTH(STRING_TO_ARRAY(tj.slots_taught, ','), 1) END), 0) > 0
                ORDER BY c.grade, c.name, s.subject_name;
            `, [academic_year_id]);

            let totalJpSekolah = 0;
            const formattedData = result.rows.map((row, index) => {
                const totalSlots = parseInt(row.total_slots) || 0;
                totalJpSekolah += totalSlots;

                // BIARKAN NULL JIKA ADMIN BELUM MENGISI!
                const targetJp = row.target_jp ? parseInt(row.target_jp) : null; 

                // Jika target kosong, progress bar dibuat 0 agar grafiknya mati/kosong
                const progressVisual = targetJp ? Math.min(Math.round((totalSlots / targetJp) * 100), 100) : 0;

                // Klasifikasi status yang membongkar kelalaian admin
                let status = "Baru Dimulai";
                if (!targetJp) status = "⚠ Target Belum Diatur";
                else if (totalSlots >= targetJp) status = "Tuntas"; // Tepat atau lebih
                else if (totalSlots >= (targetJp * 0.75)) status = "Hampir Tuntas";
                else if (totalSlots >= (targetJp * 0.35)) status = "Sedang Berproses";
                else if (totalSlots === 0) status = "Belum Ada KBM";

                return {
                    id: `${row.class_id}-${row.subject_id || 'umum'}-${index}`,
                    grade: row.grade,
                    class_id: row.class_id,
                    class_name: row.class_name,
                    mapel: row.mapel,
                    guru: row.guru || "Belum Ditentukan",
                    progress: progressVisual, 
                    total_slots: totalSlots,
                    target_jp: targetJp, 
                    substitute_count: parseInt(row.substitute_count) || 0,
                    status: status
                };
            });

            const totalMapel = formattedData.length;
            const avgProgress = totalMapel > 0 ? Math.round(formattedData.reduce((acc, curr) => acc + curr.progress, 0) / totalMapel) : 0;
            const tuntasCount = formattedData.filter(d => d.status === "Tuntas" || d.status === "Hampir Tuntas").length;
            const totalInvalSekolah = formattedData.reduce((acc, curr) => acc + curr.substitute_count, 0);

            res.json({
                data: formattedData,
                summary: { avgProgress, totalMapel, tuntasCount, totalInvalSekolah, totalJpSekolah }
            });
        } catch (error) {
            console.error("Error Get Curriculum Progress:", error);
            res.status(500).json({ error: "Gagal memuat data capaian kurikulum." });
        }
    },
};

module.exports = supervisorController;