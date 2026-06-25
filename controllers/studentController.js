// controllers/studentController.js
const db = require('../config/db');

const studentController = {
  getAcademicYearStudent: async (req, res) => {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;

      if (!userId) {
        return res.status(400).json({ error: "USER ID diperlukan" });
      }

      let query = "";
      
      // Jika rolenya PARENT
      if (userRole === 'parent') {
        query = `
          SELECT DISTINCT 
            ay.id, ay.year_name, ay.semester, ay.is_active
          FROM academic_years ay
          JOIN classes c ON c.academic_year_id = ay.id
          JOIN class_members cm ON cm.class_id = c.id
          JOIN users u ON cm.student_id = u.id
          WHERE u.parent_id = $1 AND u.role = 'student'
          ORDER BY ay.id DESC
        `;
      } 
      // Jika rolenya STUDENT
      else {
        query = `
          SELECT DISTINCT
            ay.id, ay.year_name, ay.semester, ay.is_active
          FROM academic_years ay
          JOIN classes c ON c.academic_year_id = ay.id
          JOIN class_members cm ON cm.class_id = c.id
          WHERE cm.student_id = $1
          ORDER BY ay.id DESC
        `;
      }

      const result = await db.query(query, [userId]);

      res.json(result.rows);

    } catch (err) {
      console.error("Error at getAcademicYearStudent: ", err);
      res.status(500).json({ error: "Terjadi kesalahan pada server" });
    }
  },

  getDashboardMeta: async (req, res) => {
    try {
      const studentId = req.user.id;
      const { academic_year_id } = req.query;

      if (!academic_year_id) {
        return res.status(400).json({ error: "Academic year ID diperlukan" });
      }

      // 1. Dapatkan format class_grade_name (contoh: "VIII-A") milik siswa ini
      const classLookUp = await db.query(
        `SELECT c.id as class_id 
         FROM class_members cm
         JOIN classes c ON cm.class_id = c.id
         WHERE cm.student_id = $1 AND c.academic_year_id = $2 LIMIT 1`,
        [studentId, academic_year_id]
      );

      if (classLookUp.rows.length === 0) {
        // Tambahkan fallback attendancePercentage: 100 jika siswa belum punya kelas
        return res.json({ tasks: [], quizzes: [], totalMaterials: 0, attendancePercentage: 100 });
      }

      const classId = classLookUp.rows[0].class_id;

      // 2. Query Tugas (TIDAK DIUBAH)
      const tasksQuery = `
        SELECT 
          t.id, t.title, t.due_date, sub.subject_name,
          CASE WHEN ts.student_id IS NOT NULL THEN true ELSE false END as is_submitted
        FROM tasks t
        JOIN subjects sub ON t.subject_id = sub.id
        LEFT JOIN task_scores ts ON ts.task_id = t.id AND ts.student_id = $1
        WHERE t.class_id = $2
        ORDER BY t.due_date ASC
      `;
      const tasksRes = await db.query(tasksQuery, [studentId, classId]);

      // 3. Query Kuis (TIDAK DIUBAH)
      const quizzesQuery = `
        SELECT 
          q.id, q.title, q.exam_date as due_date, q.start_time, q.end_time, sub.subject_name,
          CASE WHEN qs.student_id IS NOT NULL THEN true ELSE false END as is_attempted
        FROM quizzes q
        JOIN subjects sub ON q.subject_id = sub.id
        LEFT JOIN quiz_scores qs ON qs.quiz_id = q.id AND qs.student_id = $1
        WHERE q.class_id = $2
        ORDER BY q.exam_date ASC
      `;
      const quizzesRes = await db.query(quizzesQuery, [studentId, classId]);

      // 4. Hitung Total Materi (TIDAK DIUBAH)
      const materialsCount = await db.query(
        `SELECT COUNT(m.id)::INT as total FROM materials m 
         WHERE m.class_id = $1`,
        [classId]
      );

      // 5. KALKULASI PERSENTASE KEHADIRAN (PENAMBAHAN BARU YANG AMAN)
      const journalsRes = await db.query(
        `SELECT absent_student_ids FROM teaching_journals WHERE class_id = $1`,
        [classId]
      );

      let totalMeetings = journalsRes.rows.length;
      let totalAbsences = 0;

      journalsRes.rows.forEach(j => {
        let absents = j.absent_student_ids || [];
        // Antisipasi jika database mengembalikan array dalam format string JSON
        if (typeof absents === 'string') {
          try { absents = JSON.parse(absents); } catch(e) { absents = []; }
        }
        
        // Cek jika ID siswa saat ini ada di dalam daftar absen jurnal
        if (absents.map(Number).includes(Number(studentId))) {
          totalAbsences++;
        }
      });

      let attendancePercentage = 100; // Default 100% jika belum ada jurnal sama sekali
      if (totalMeetings > 0) {
        attendancePercentage = ((totalMeetings - totalAbsences) / totalMeetings) * 100;
      }

      // KIRIM SEMUA DATA BERSAMAAN
      res.json({
        tasks: tasksRes.rows,
        quizzes: quizzesRes.rows,
        totalMaterials: materialsCount.rows[0]?.total || 0,
        attendancePercentage: parseFloat(attendancePercentage.toFixed(1)) // Mengirim persentase (1 desimal)
      });

    } catch (err) {
      console.error("Error Dashboard Meta Backend:", err.message);
      res.status(500).json({ error: `Gagal memuat data: ${err.message}` });
    }
  },

  getMySchedule: async (req, res) => {
    try {
      const studentId = req.user.id; // ID dari token JWT
      const academicYearId = req.query.academic_year_id; // ID tahun akademik dari query parameter

      if (!academicYearId) {
        return res.status(400).json({ message: "Parameter academic_year_id diperlukan." });
      }
      // 1. Cari class_id siswa saat ini
      const classRes = await db.query(
        "SELECT class_id FROM class_members INNER JOIN classes ON class_members.class_id = classes.id WHERE student_id = $1 AND classes.academic_year_id = $2",
        [studentId, academicYearId]
      );
      
      if (classRes.rows.length === 0) {
        return res.status(404).json({ message: "Anda belum terdaftar di kelas manapun." });
      }
      const classId = classRes.rows[0].class_id;

      // 2. Ambil data Pengaturan Hari & Slot Waktu Global
      const globalVarsRes = await db.query("SELECT day_of_week, start_time_school, kbm_duration_minutes FROM day_var_global");
      const slotsRes = await db.query(`SELECT slot_number, slot_type, label_name, custom_duration_minutes, day_of_week 
        FROM global_time_slots 
        WHERE academic_year_id = $1 ORDER BY slot_number ASC`, [academicYearId]);

      // 3. Ambil Jadwal Pelajaran (schedules) dengan join ke mapel & guru
      const scheduleRes = await db.query(`
        SELECT 
          s.day_of_week, 
          s.slot_number, 
          sub.subject_name, 
          u.full_name as teacher_name
        FROM schedules s
        JOIN class_subjects cs ON s.class_subject_id = cs.id
        JOIN subjects sub ON cs.subject_id = sub.id
        JOIN users u ON cs.teacher_id = u.id
        JOIN classes c ON s.class_id = c.id
        WHERE s.class_id = $1 AND c.academic_year_id = $2 AND s.academic_year_id = $2
      `, [classId, academicYearId]);

      const schedules = scheduleRes.rows;
      const dayVars = globalVarsRes.rows;
      const globalSlots = slotsRes.rows;

      // 4. Kalkulasi Engine Waktu & Mapping Data
      const daysNameMap = { 1: "Senin", 2: "Selasa", 3: "Rabu", 4: "Kamis", 5: "Jumat", 6: "Sabtu", 7: "Minggu" };
      const formattedSchedule = { "Senin": [], "Selasa": [], "Rabu": [], "Kamis": [], "Jumat": [], "Sabtu": [], "Minggu": [] };

      // Helper untuk format total menit menjadi "HH:MM"
      const formatJam = (tot) => `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;

      // Looping untuk setiap hari (1 = Senin s/d 7 = Minggu)
      for (let dayNum = 1; dayNum <= 7; dayNum++) {
        const dayName = daysNameMap[dayNum];
        
        // Ambil rule waktu & slot untuk hari tersebut
        const todaySetting = dayVars.find(d => Number(d.day_of_week) === dayNum);
        const todaySlots = globalSlots
          .filter(s => Number(s.day_of_week) === dayNum)
          .sort((a, b) => Number(a.slot_number) - Number(b.slot_number));

        if (todaySetting && todaySlots.length > 0) {
          // Parse jam mulai sekolah (misal: "07:00:00")
          const [jam, menit] = (todaySetting.start_time_school || "07:00:00").split(':').map(Number);
          let totalMenitAkumulasi = (jam * 60) + menit;
          const defaultDuration = Number(todaySetting.kbm_duration_minutes) || 40;

          todaySlots.forEach(slot => {
            const startMinutes = totalMenitAkumulasi;
            
            // Tentukan durasi berdasarkan tipe (kbm vs custom/istirahat)
            const durasi = slot.slot_type === 'kbm' 
              ? defaultDuration 
              : Number(slot.custom_duration_minutes || 15);
              
            const endMinutes = startMinutes + durasi;
            totalMenitAkumulasi = endMinutes; // update tracker untuk slot selanjutnya

            const timeStr = `${formatJam(startMinutes)} - ${formatJam(endMinutes)}`;

            if (slot.slot_type === 'kbm') {
              // Jika ini jam KBM, cari mata pelajaran yang di-plot di schedules
              const sched = schedules.find(s => s.day_of_week === dayName && Number(s.slot_number) === Number(slot.slot_number));
              
              if (sched) {
                formattedSchedule[dayName].push({
                  time: timeStr,
                  subject: sched.subject_name,
                  teacher: sched.teacher_name
                });
              } else {
                 formattedSchedule[dayName].push({
                  time: timeStr,
                  subject: "Kosong - (Belum Ada Jadwal)",
                  teacher: "-"
                });
              }
            } else {
              // Jika ini tipe custom (Istirahat / Upacara dll)
              formattedSchedule[dayName].push({
                time: timeStr,
                subject: slot.label_name || "Istirahat",
                teacher: ""
              });
            }
          });
        }
      }

      res.json(formattedSchedule);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Gagal memproses data jadwal pelajaran." });
    }
  },

  // 1. Mengambil daftar Mapel yang punya materi
  getMySubjects: async (req, res) => {
    try {
      const studentId = req.user.id;
      const academicYearId = req.query.academic_year_id;

      if (!academicYearId) return res.status(400).json({ message: "academic_year_id diperlukan." });

      const query = `
        SELECT
          s.id AS "subject_id",
          s.subject_name,
          s.subject_code,
          COUNT(DISTINCT m.id) AS "total_modul"
        FROM
          subjects s
        LEFT JOIN 
          class_members cm ON cm.student_id = $1
        LEFT JOIN 
          classes c ON c.id = cm.class_id AND s.grade = c.grade
        LEFT JOIN
          materials m ON m.subject_id = s.id AND m.class_id = c.id
        JOIN 
          class_subjects cs ON cs.subject_id = s.id
        JOIN
          schedules sch ON sch.class_id = c.id AND sch.class_subject_id = cs.id
        WHERE
          c.academic_year_id = $2
        GROUP BY
          s.id, s.subject_name, s.subject_code
        ORDER BY
          s.subject_name ASC
      `;
      
      const { rows } = await db.query(query, [studentId, academicYearId]);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Gagal mengambil mata pelajaran." });
    }
  },

  // 2. Mengambil detail materi di mapel tertentu
  getMyMaterials: async (req, res) => {
    try {
      const studentId = req.user.id;
      const academicYearId = req.query.academic_year_id;
      const subjectId = req.params.subjectId;

      //console.log("Fetching materials for studentId:", studentId, "academicYearId:", academicYearId, "subjectId:", subjectId);

      const query = `
        SELECT 
          m.id, m.title, m.description, m.link_url, m.file_url, m.created_at,
          u.full_name as teacher_name
        FROM materials m
        JOIN classes c ON m.class_id = c.id
        JOIN class_members cm ON cm.class_id = c.id
        JOIN users u ON m.teacher_id = u.id
        WHERE cm.student_id = $1 AND c.academic_year_id = $2 AND m.subject_id = $3
        ORDER BY m.created_at DESC
      `;
      
      const { rows } = await db.query(query, [studentId, academicYearId, subjectId]);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Gagal mengambil daftar materi." });
    }
  },

  // 3. Mengambil ringkasan Mapel untuk Modul Tugas
  getMyTaskSubjects: async (req, res) => {
    try {
      const studentId = req.user.id;
      const academicYearId = req.query.academic_year_id;
      //console.log("Fetching task subjects for studentId:", studentId, "academicYearId:", academicYearId);
      if (!academicYearId) return res.status(400).json({ message: "academic_year_id diperlukan." });

      // Mengambil daftar mapel, total tugas, tugas selesai, dan tugas mendesak (deadline <= 3 hari)
      const query = `
        SELECT
          s.id AS "subject_id",
          s.subject_name,
          s.subject_code,
          COUNT(DISTINCT t.id) AS total_tasks,
          COUNT(DISTINCT CASE 
          WHEN ts.student_id = $1 AND (ts.task_url IS NOT NULL OR ts.score IS NOT NULL) 
          THEN t.id 
  END) AS submitted_tasks,
  
  -- 3. Urgent tasks (Diperbaiki)
  COUNT(DISTINCT CASE 
    WHEN (ts.task_id IS NULL OR (ts.task_url IS NULL AND ts.score IS NULL)) 
         AND t.due_date IS NOT NULL 
         AND t.due_date >= CURRENT_DATE 
         AND t.due_date <= CURRENT_DATE + INTERVAL '3 days' 
    THEN t.id 
  END) AS urgent_tasks
        FROM subjects s
        JOIN class_members cm ON cm.student_id = $1
        JOIN classes c ON c.id = cm.class_id AND c.grade = s.grade
        LEFT JOIN tasks t ON t.subject_id = s.id AND t.class_id = c.id
        LEFT JOIN task_scores ts ON ts.task_id = t.id AND ts.student_id = $1
        JOIN 
          class_subjects cs ON cs.subject_id = s.id
        JOIN
          schedules sch ON sch.class_id = c.id AND sch.class_subject_id = cs.id
        WHERE c.academic_year_id = $2
        GROUP BY s.id, s.subject_name, s.subject_code
        ORDER BY s.subject_name ASC
      `;
      
      const { rows } = await db.query(query, [studentId, academicYearId]);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Gagal mengambil ringkasan tugas." });
    }
  },


  // 4. Mengambil detail tugas berdasarkan Mapel tertentu
  getMyTasks: async (req, res) => {
    try {
      const studentId = req.user.id;
      const academicYearId = req.query.academic_year_id;
      const subjectId = req.params.subjectId;

      const query = `
        SELECT 
          t.id, t.title, t.description, t.link_url, t.file_url, t.due_date, t.created_at,
          ts.score, ts.task_url as student_submission_url,
          COALESCE(ts.updated_at, ts.created_at) AS submitted_at,
          CASE WHEN ts.student_id IS NOT NULL THEN true ELSE false END as is_submitted,
          u.full_name as teacher_name
        FROM tasks t
        JOIN classes c ON t.class_id = c.id
        JOIN class_members cm ON cm.class_id = c.id
        JOIN users u ON t.teacher_id = u.id
        LEFT JOIN task_scores ts ON ts.task_id = t.id AND ts.student_id = $1
        WHERE cm.student_id = $1 AND c.academic_year_id = $2 AND t.subject_id = $3
        ORDER BY 
          t.created_at DESC
      `;
      
      const { rows } = await db.query(query, [studentId, academicYearId, subjectId]);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Gagal mengambil detail tugas." });
    }
  },
  // 5. Mengambil ringkasan mata pelajaran yang memiliki kuis
// 5. Mengambil ringkasan mata pelajaran yang memiliki kuis (FIXED QUERY)
  getMyQuizSubjects: async (req, res) => {
    try {
      const studentId = req.user.id;
      const academicYearId = req.query.academic_year_id;

      if (!academicYearId) {
        return res.status(400).json({ message: "Parameter academic_year_id diperlukan." });
      }

      const query = `
        SELECT 
          s.id as subject_id, 
          s.subject_name, 
          s.subject_code,
          COUNT(DISTINCT q.id) as total_quizzes,
          COUNT(DISTINCT CASE 
            WHEN qs.score IS NOT NULL 
              OR (q.exam_date + q.end_time) < CURRENT_TIMESTAMP 
            THEN q.id 
          END) as submitted_quizzes,
          COUNT(DISTINCT CASE 
            WHEN q.exam_date IS NOT NULL 
            AND (q.exam_date + q.end_time) >= CURRENT_TIMESTAMP -- Syarat: Kuis masih open
            AND (q.exam_date::date - CURRENT_DATE) <= 1 
            AND (q.exam_date::date - CURRENT_DATE) >= 0 
            THEN q.id
          END) as urgent_quizzes
        FROM class_members cm
        JOIN classes c ON cm.class_id = c.id
        JOIN class_subjects cs ON cs.academic_year_id = c.academic_year_id
        JOIN subjects s ON cs.subject_id = s.id
        LEFT JOIN quizzes q ON q.subject_id = s.id AND q.class_id = c.id
        LEFT JOIN quiz_scores qs ON qs.quiz_id = q.id AND qs.student_id = $1
        JOIN
          schedules sch ON sch.class_id = c.id AND sch.class_subject_id = cs.id
        WHERE cm.student_id = $1 AND c.academic_year_id = $2
        GROUP BY 
          s.id, s.subject_name, s.subject_code
        ORDER BY 
          s.subject_name ASC
      `;
      
      const { rows } = await db.query(query, [studentId, academicYearId]);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Gagal mengambil ringkasan kuis." });
    }
  },

  // 6. Mengambil detail kuis berdasarkan Mapel tertentu
  getMyQuizzes: async (req, res) => {
    try {
      const studentId = req.user.id;
      const academicYearId = req.query.academic_year_id;
      const subjectId = req.params.subjectId;

      const query = `
        SELECT 
          q.id, q.title, q.instruction, q.embed_url, 
          q.exam_date, q.start_time, q.end_time, q.created_at,
          qs.score,
          COALESCE(s.kkm::numeric, ay_kkm.default_kkm::numeric, 80) as kkm,
          CASE WHEN qs.student_id IS NOT NULL THEN true ELSE false END as is_submitted,
          u.full_name as teacher_name
        FROM quizzes q
        JOIN classes c ON q.class_id = c.id
        JOIN class_members cm ON cm.class_id = c.id
        JOIN users u ON q.teacher_id = u.id
        JOIN subjects s ON q.subject_id = s.id
        LEFT JOIN academic_year_kkm ay_kkm ON ay_kkm.academic_year_id = c.academic_year_id
        LEFT JOIN quiz_scores qs ON qs.quiz_id = q.id AND qs.student_id = $1
        WHERE cm.student_id = $1 AND c.academic_year_id = $2 AND q.subject_id = $3
        ORDER BY 
          is_submitted ASC,
          q.exam_date ASC, 
          q.start_time ASC
      `;

      const { rows } = await db.query(query, [studentId, academicYearId, subjectId]);
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Gagal mengambil detail kuis." });
    }
  },

  // 7. Submit tugas oleh siswa
  submitTask: async (req, res) => {
    const { taskId } = req.params;
    const { submission_url } = req.body;
    const studentId = req.user.id; // Didapatkan dari middleware authenticateToken
    //console.log("Menerima permintaan submit tugas. taskId:", taskId, "studentId:", studentId, "submission_url:", submission_url);
    // Validasi manual di sisi backend (Good practice!)
    if (!submission_url) {
      return res.status(400).json({ error: "URL pengumpulan tidak boleh kosong!" });
    }

    try {
      // Kueri SQL menggunakan metode UPSERT (ON DUPLICATE KEY UPDATE)
      // Asumsi: Kombinasi task_id dan student_id adalah UNIQUE KEY / PRIMARY KEY di tabel task_scores
      const query = `
        INSERT INTO task_scores (task_id, student_id, task_url, created_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (task_id, student_id) DO UPDATE SET 
          task_url = EXCLUDED.task_url,  
          updated_at = NOW();
      `;

      // Eksekusi query ke database
      await db.query(query, [taskId, studentId, submission_url]);

      // Berikan respon sukses ke frontend
      return res.status(200).json({ message: "Tugas berhasil dikumpulkan!" });

    } catch (error) {
      console.error("Error saat mengumpulkan tugas:", error);
      return res.status(500).json({ error: "Terjadi kesalahan internal pada server." });
    }
  },

  // Tambahkan di dalam studentController
  getMyGrades: async (req, res) => {
    try {
      const studentId = req.user.id;
      const academicYearId = req.query.academic_year_id;

      //console.log("Fetching grades for studentId:", studentId, "academicYearId:", academicYearId);

      if (!academicYearId) {
        return res.status(400).json({ message: "Parameter academic_year_id diperlukan." });
      }

      // 1. Ambil daftar Mata Pelajaran & Guru
      const subjectRes = await db.query(`
        SELECT DISTINCT 
          sub.id as subject_id, 
          sub.subject_name, 
          u.full_name as teacher_name,
          COALESCE(sub.kkm::numeric, apset.setting_value::numeric) as kkm
        FROM class_members cm
        JOIN classes c ON cm.class_id = c.id
        JOIN schedules s ON s.class_id = c.id
        JOIN class_subjects cs ON s.class_subject_id = cs.id
        JOIN subjects sub ON cs.subject_id = sub.id
        JOIN users u ON cs.teacher_id = u.id
        LEFT JOIN app_settings apset ON apset.setting_key = 'default_kkm'
        WHERE cm.student_id = $1 AND c.academic_year_id = $2
      `, [studentId, academicYearId]);

      // 2. Ambil Nilai Tugas
      const taskRes = await db.query(`
        SELECT t.subject_id, t.title, ts.score
        FROM tasks t
        JOIN classes c ON t.class_id = c.id
        JOIN task_scores ts ON ts.task_id = t.id AND ts.student_id = $1
        WHERE c.academic_year_id = $2 AND ts.score IS NOT NULL
        ORDER BY t.created_at ASC
      `, [studentId, academicYearId]);

      // 3. Ambil Nilai Kuis (Ulangan, UTS, UAS)
      const quizRes = await db.query(`
        SELECT q.subject_id, q.title, qs.score
        FROM quizzes q
        JOIN classes c ON q.class_id = c.id
        JOIN quiz_scores qs ON qs.quiz_id = q.id AND qs.student_id = $1
        WHERE c.academic_year_id = $2 AND qs.score IS NOT NULL
        ORDER BY q.created_at ASC
      `, [studentId, academicYearId]);

      const subjects = subjectRes.rows;
      const tasks = taskRes.rows;
      const quizzes = quizRes.rows;

      // Kumpulan icon untuk mempercantik UI
      const emojis = ["📐", "🔬", "📚", "🌍", "💻", "🎨", "⚽", "🎵", "💡"];

      // 4. Mapping & Kategorisasi Data
      const result = subjects.map((sub, index) => {
        const subjectTasks = tasks.filter(t => t.subject_id === sub.subject_id);
        const subjectQuizzes = quizzes.filter(q => q.subject_id === sub.subject_id);

        const uh = [];
        const uts = [];
        const uas = [];

        subjectQuizzes.forEach(q => {
          const title = q.title.toUpperCase();
          if (title.includes("UTS") || title.includes("TENGAH SEMESTER")) {
            uts.push({ title: q.title, score: Number(q.score) });
          } else if (title.includes("UAS") || title.includes("AKHIR SEMESTER")) {
            uas.push({ title: q.title, score: Number(q.score) });
          } else {
            uh.push({ title: q.title, score: Number(q.score) });
          }
        });

        return {
          subject: sub.subject_name,
          icon: emojis[index % emojis.length],
          teacher: sub.teacher_name,
          kkm: Number(sub.kkm) || 75, // <-- Tambahkan KKM di sini (default 75 untuk jaga-jaga)
          categories: {
            tugas: subjectTasks.map(t => ({ title: t.title, score: Number(t.score) })),
            uh: uh,
            uts: uts,
            uas: uas
          }
        };
      });

      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Gagal mengambil rekap nilai." });
    }
  },
};

module.exports = studentController;