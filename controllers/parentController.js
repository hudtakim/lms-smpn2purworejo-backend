// controllers/parentController.js
const db = require('../config/db');

const parentController = {
  // 1. Mengambil daftar anak yang terhubung dengan orang tua ini
  getMyChildren: async (req, res) => {
    try {
      const parentId = req.user.id;
      const query = `
        SELECT id as student_id, full_name, username, gender, religion 
        FROM users 
        WHERE role = 'student' AND parent_id = $1
        ORDER BY full_name ASC
      `;
      const result = await db.query(query, [parentId]);
      res.json(result.rows);
    } catch (err) {
      console.error("Error at getMyChildren: ", err);
      res.status(500).json({ error: "Gagal mengambil data anak" });
    }
  },

  getChildDashboardMeta: async (req, res) => {
    try {
      const parentId = req.user.id;
      const { student_id, academic_year_id } = req.query;

      if (!student_id || !academic_year_id) {
        return res.status(400).json({ error: "student_id dan academic_year_id diperlukan" });
      }

      // Validasi Keamanan + Ambil Agama Anak
      const checkChild = await db.query(`SELECT id, religion FROM users WHERE id = $1 AND parent_id = $2`, [student_id, parentId]);
      if (checkChild.rows.length === 0) {
        return res.status(403).json({ error: "Akses ditolak. Ini bukan data anak Anda." });
      }
      
      // Ambil string agama anak (dibuat lowercase)
      const childReligion = checkChild.rows[0].religion ? checkChild.rows[0].religion.toLowerCase() : '';

      // Cari kelas anak
      const classLookUp = await db.query(
        `SELECT c.id as class_id, CONCAT(c.grade, '-', c.name) as class_name, u.full_name as homeroom_teacher
         FROM class_members cm
         JOIN classes c ON cm.class_id = c.id
         LEFT JOIN users u ON c.homeroom_teacher_id = u.id
         WHERE cm.student_id = $1 AND c.academic_year_id = $2 LIMIT 1`,
        [student_id, academic_year_id]
      );

      if (classLookUp.rows.length === 0) {
        return res.json({ tasks: [], quizzes: [], attendancePercentage: 100, className: "Belum ada kelas", homeRoomTeacher: null, todayAttendance: [] });
      }

      const classId = classLookUp.rows[0].class_id;
      const className = classLookUp.rows[0].class_name;
      const homeroomTeacher = classLookUp.rows[0].homeroom_teacher;

      // Query Tugas (Ditambahkan Filter Agama)
      const tasksQuery = `
        SELECT t.id, t.title, t.due_date, sub.subject_name, CASE WHEN ts.student_id IS NOT NULL THEN true ELSE false END as is_submitted, ts.score
        FROM tasks t 
        JOIN subjects sub ON t.subject_id = sub.id 
        LEFT JOIN task_scores ts ON ts.task_id = t.id AND ts.student_id = $1
        WHERE t.class_id = $2 AND DATE(t.due_date) >= CURRENT_DATE 
          AND (
            NOT (
              sub.subject_name ILIKE '%islam%' OR sub.subject_name ILIKE '%katolik%' OR sub.subject_name ILIKE '%kristen%' OR 
              sub.subject_name ILIKE '%hindu%' OR sub.subject_name ILIKE '%buddha%' OR sub.subject_name ILIKE '%konghucu%'
            )
            OR sub.subject_name ILIKE '%' || $3 || '%'
          )
        ORDER BY t.due_date ASC
      `;
      const tasksRes = await db.query(tasksQuery, [student_id, classId, childReligion]);

      // Query Kuis (Ditambahkan Filter Agama)
      const quizzesQuery = `
        SELECT q.id, q.title, q.exam_date as due_date, q.start_time, q.end_time, sub.subject_name, CASE WHEN qs.student_id IS NOT NULL THEN true ELSE false END as is_attempted, qs.score
        FROM quizzes q 
        JOIN subjects sub ON q.subject_id = sub.id 
        LEFT JOIN quiz_scores qs ON qs.quiz_id = q.id AND qs.student_id = $1
        WHERE q.class_id = $2 AND DATE(q.exam_date) >= CURRENT_DATE 
          AND (
            NOT (
              sub.subject_name ILIKE '%islam%' OR sub.subject_name ILIKE '%katolik%' OR sub.subject_name ILIKE '%kristen%' OR 
              sub.subject_name ILIKE '%hindu%' OR sub.subject_name ILIKE '%buddha%' OR sub.subject_name ILIKE '%konghucu%'
            )
            OR sub.subject_name ILIKE '%' || $3 || '%'
          )
        ORDER BY q.exam_date ASC
      `;
      const quizzesRes = await db.query(quizzesQuery, [student_id, classId, childReligion]);

      // AMBIL JURNAL KHUSUS HARI INI (Ditambahkan Filter Agama)
      const todayQuery = `
        SELECT 
          tj.absent_student_ids, 
          tj.slots_taught, 
          sub.subject_name, 
          u.full_name as teacher_name
        FROM teaching_journals tj
        LEFT JOIN subjects sub ON tj.subject_id = sub.id
        LEFT JOIN users u ON tj.teacher_id = u.id
        WHERE tj.class_id = $1 AND DATE(tj.journal_date) = CURRENT_DATE
          AND (
            sub.subject_name IS NULL OR
            NOT (
              sub.subject_name ILIKE '%islam%' OR sub.subject_name ILIKE '%katolik%' OR sub.subject_name ILIKE '%kristen%' OR 
              sub.subject_name ILIKE '%hindu%' OR sub.subject_name ILIKE '%buddha%' OR sub.subject_name ILIKE '%konghucu%'
            )
            OR sub.subject_name ILIKE '%' || $2 || '%'
          )
        ORDER BY tj.journal_date ASC
      `;
      const todayJournalsRes = await db.query(todayQuery, [classId, childReligion]);

      const todayAttendance = todayJournalsRes.rows.map(j => {
        let absents = j.absent_student_ids || [];
        if (typeof absents === 'string') {
          try { absents = JSON.parse(absents); } catch(e) { absents = []; }
        }
        
        const isAbsent = absents.map(Number).includes(Number(student_id));
        const formattedSlots = j.slots_taught ? j.slots_taught.split(',').join(', ') : "-";

        return {
          subject: j.subject_name || "Umum",
          teacher: j.teacher_name || "Guru Tidak Diketahui",
          slots: formattedSlots,
          status: isAbsent ? "Absen" : "Hadir"
        };
      });

      // Kalkulasi Kehadiran Global (Ditambahkan Filter Agama di JOIN Jurnal)
      const journalsQuery = `
        SELECT tj.absent_student_ids 
        FROM teaching_journals tj
        JOIN subjects sub ON tj.subject_id = sub.id
        WHERE tj.class_id = $1
          AND (
            NOT (
              sub.subject_name ILIKE '%islam%' OR sub.subject_name ILIKE '%katolik%' OR sub.subject_name ILIKE '%kristen%' OR 
              sub.subject_name ILIKE '%hindu%' OR sub.subject_name ILIKE '%buddha%' OR sub.subject_name ILIKE '%konghucu%'
            )
            OR sub.subject_name ILIKE '%' || $2 || '%'
          )
      `;
      const journalsRes = await db.query(journalsQuery, [classId, childReligion]);
      
      let totalMeetings = journalsRes.rows.length;
      let totalAbsences = 0;

      journalsRes.rows.forEach(j => {
        let absents = j.absent_student_ids || [];
        if (typeof absents === 'string') { try { absents = JSON.parse(absents); } catch(e) { absents = []; } }
        if (absents.map(Number).includes(Number(student_id))) totalAbsences++;
      });

      let attendancePercentage = 100;
      if (totalMeetings > 0) attendancePercentage = ((totalMeetings - totalAbsences) / totalMeetings) * 100;

      res.json({
        className,
        homeroomTeacher,
        tasks: tasksRes.rows,
        quizzes: quizzesRes.rows,
        attendancePercentage: parseFloat(attendancePercentage.toFixed(1)),
        totalAbsences,
        totalMeetings,
        todayAttendance
      });

    } catch (err) {
      console.error("Error Dashboard Meta Parent:", err.message);
      res.status(500).json({ error: `Gagal memuat data: ${err.message}` });
    }
  },

  // 3. Mengambil Rekap Nilai Anak
  getChildGrades: async (req, res) => {
    try {
      const parentId = req.user.id;
      const { student_id, academic_year_id } = req.query;

      if (!student_id || !academic_year_id) {
        return res.status(400).json({ message: "student_id dan academic_year_id diperlukan." });
      }

      // Validasi Keamanan + Ambil Agama Anak
      const checkChild = await db.query(`SELECT id, religion FROM users WHERE id = $1 AND parent_id = $2`, [student_id, parentId]);
      if (checkChild.rows.length === 0) return res.status(403).json({ error: "Akses ditolak." });
      
      const childReligion = checkChild.rows[0].religion ? checkChild.rows[0].religion.toLowerCase() : '';

      // Query subjek nilai (Ditambahkan Filter Agama)
      const subjectRes = await db.query(`
        SELECT DISTINCT sub.id as subject_id, sub.subject_name, u.full_name as teacher_name, COALESCE(sub.kkm::numeric, apset.setting_value::numeric) as kkm
        FROM class_members cm
        JOIN classes c ON cm.class_id = c.id
        JOIN schedules s ON s.class_id = c.id
        JOIN class_subjects cs ON s.class_subject_id = cs.id
        JOIN subjects sub ON cs.subject_id = sub.id
        JOIN users u ON cs.teacher_id = u.id
        LEFT JOIN app_settings apset ON apset.setting_key = 'default_kkm'
        WHERE cm.student_id = $1 AND c.academic_year_id = $2
          AND (
            NOT (
              sub.subject_name ILIKE '%islam%' OR sub.subject_name ILIKE '%katolik%' OR sub.subject_name ILIKE '%kristen%' OR 
              sub.subject_name ILIKE '%hindu%' OR sub.subject_name ILIKE '%buddha%' OR sub.subject_name ILIKE '%konghucu%'
            )
            OR sub.subject_name ILIKE '%' || $3 || '%'
          )
      `, [student_id, academic_year_id, childReligion]);

      const taskRes = await db.query(`
        SELECT t.subject_id, t.title, ts.score
        FROM tasks t
        JOIN classes c ON t.class_id = c.id
        JOIN task_scores ts ON ts.task_id = t.id AND ts.student_id = $1
        WHERE c.academic_year_id = $2 AND ts.score IS NOT NULL
      `, [student_id, academic_year_id]);

      const quizRes = await db.query(`
        SELECT q.subject_id, q.title, qs.score
        FROM quizzes q
        JOIN classes c ON q.class_id = c.id
        JOIN quiz_scores qs ON qs.quiz_id = q.id AND qs.student_id = $1
        WHERE c.academic_year_id = $2 AND qs.score IS NOT NULL
      `, [student_id, academic_year_id]);

      const result = subjectRes.rows.map((sub) => {
        const subjectTasks = taskRes.rows.filter(t => t.subject_id === sub.subject_id);
        const subjectQuizzes = quizRes.rows.filter(q => q.subject_id === sub.subject_id);
        
        const uh = []; const uts = []; const uas = [];
        subjectQuizzes.forEach(q => {
          const title = q.title.toUpperCase();
          if (title.includes("UTS") || title.includes("TENGAH")) uts.push({ title: q.title, score: Number(q.score) });
          else if (title.includes("UAS") || title.includes("AKHIR")) uas.push({ title: q.title, score: Number(q.score) });
          else uh.push({ title: q.title, score: Number(q.score) });
        });

        return {
          subject: sub.subject_name,
          teacher: sub.teacher_name,
          kkm: Number(sub.kkm) || 75,
          categories: {
            tugas: subjectTasks.map(t => ({ title: t.title, score: Number(t.score) })),
            uh, uts, uas
          }
        };
      });

      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Gagal mengambil rekap nilai anak." });
    }
  },

  // 4. Mengambil Detail Ketidakhadiran Anak (Jurnal)
  getChildAttendanceHistory: async (req, res) => {
    try {
      const parentId = req.user.id;
      const { student_id, academic_year_id } = req.query;

      // Validasi Keamanan + Ambil Agama Anak
      const checkChild = await db.query(`SELECT id, religion FROM users WHERE id = $1 AND parent_id = $2`, [student_id, parentId]);
      if (checkChild.rows.length === 0) return res.status(403).json({ error: "Akses ditolak." });

      const childReligion = checkChild.rows[0].religion ? checkChild.rows[0].religion.toLowerCase() : '';

      // Query Riwayat Absensi Jurnal (Ditambahkan Filter Agama)
      const query = `
        SELECT tj.journal_date, tj.real_time_range, tj.notes, tj.absent_student_ids, sub.subject_name, u.full_name as teacher_name
        FROM teaching_journals tj
        JOIN classes c ON tj.class_id = c.id
        JOIN subjects sub ON tj.subject_id = sub.id
        JOIN users u ON tj.teacher_id = u.id
        WHERE c.academic_year_id = $2
          AND (
            NOT (
              sub.subject_name ILIKE '%islam%' OR sub.subject_name ILIKE '%katolik%' OR sub.subject_name ILIKE '%kristen%' OR 
              sub.subject_name ILIKE '%hindu%' OR sub.subject_name ILIKE '%buddha%' OR sub.subject_name ILIKE '%konghucu%'
            )
            OR sub.subject_name ILIKE '%' || $3 || '%'
          )
        ORDER BY tj.journal_date DESC
      `;
      const journalsRes = await db.query(query, [student_id, academic_year_id, childReligion]);
      
      const absences = journalsRes.rows.filter(j => {
        let absents = j.absent_student_ids || [];
        if (typeof absents === 'string') {
          try { absents = JSON.parse(absents); } catch(e) { absents = []; }
        }
        return absents.map(Number).includes(Number(student_id));
      });

      res.json(absences);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Gagal mengambil riwayat absensi anak." });
    }
  }
};

module.exports = parentController;