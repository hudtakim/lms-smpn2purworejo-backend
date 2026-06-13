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
                SELECT m.id, m.title, m.description, m.file_url, m.link_url, m.created_at, c.name as class_name, COALESCE(s.subject_name, 'Umum') as subject_name
                FROM materials m 
                JOIN classes c ON m.class_id = c.id 
                LEFT JOIN subjects s ON m.subject_id = s.id
                WHERE m.teacher_id = $1 AND c.academic_year_id = $2
                ORDER BY m.created_at DESC
            `, [teacher_id, academic_year_id]);

            // 2. Ambil Tugas & Kuis (Digabung sebagai Assessments)
            const tasks = await db.query(`
                SELECT t.id, t.title, t.file_url, t.link_url, t.due_date as target_date, c.name as class_name, COALESCE(s.subject_name, 'Umum') as subject_name, 'Tugas' as type
                FROM tasks t 
                JOIN classes c ON t.class_id = c.id 
                LEFT JOIN subjects s ON t.subject_id = s.id
                WHERE t.teacher_id = $1 AND c.academic_year_id = $2
            `, [teacher_id, academic_year_id]);

            const quizzes = await db.query(`
                SELECT q.id, q.title, NULL as file_url, q.embed_url as link_url, NULL as target_date, c.name as class_name, COALESCE(s.subject_name, 'Umum') as subject_name, 'Kuis' as type
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
                SELECT tj.id, tj.journal_date, tj.real_time_range, tj.slots_taught, tj.notes, tj.is_substitute, tj.substitute_name, c.name as class_name, COALESCE(s.subject_name, 'Umum') as subject_name
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
    }
};

module.exports = supervisorController;