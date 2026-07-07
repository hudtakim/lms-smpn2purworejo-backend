// controllers/teacherController.js
const db = require("../config/db");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const teacherController = {
  getTeacherSchedule: async (req, res) => {
    try {
      const teacherId = req.user.id; 
      const { academic_year_id } = req.query; 

      let query = `
        SELECT 
            s.day_of_week,
            s.slot_number,
            sub.subject_name,
            sub.subject_code,
            sub.id as subject_id,
            c.id as classId,
            CONCAT(c.grade, '-', c.name) as class_name
        FROM schedules s
        JOIN class_subjects cs ON s.class_subject_id = cs.id
        JOIN subjects sub ON cs.subject_id = sub.id
        JOIN classes c ON s.class_id = c.id
        WHERE cs.teacher_id = $1
      `;
      let params = [teacherId];

      if (academic_year_id) {
        query += ` AND cs.academic_year_id = $2 AND s.academic_year_id = $2`;
        params.push(academic_year_id);
      }
      
      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "Gagal mengambil data jadwal dari database" }); }
  },

  getTeacherClasses: async (req, res) => {
    try {
      const teacherId = req.user.id;
      const { academic_year_id } = req.query; 

      // Guru mengetahui mereka mengajar kelas apa BERDASARKAN tabel schedules, bukan class_subjects lagi
      let query = `
        SELECT 
            c.id as class_id,
            CONCAT(c.grade, '-', c.name) as class_name,
            COUNT(DISTINCT cm.student_id) as total_siswa,
            sub.id as subject_id,
            sub.subject_name,
            sub.subject_code,
            
            -- AMAN: Subquery hitung tugas & kuis aktif tanpa merusak GROUP BY utama
            (
              (
                SELECT COUNT(*) FROM tasks t
                WHERE t.class_id = c.id
                  AND t.subject_id = sub.id
                  AND t.teacher_id = $1
                  AND t.due_date >= NOW()
              ) + 
              (
                SELECT COUNT(*) FROM quizzes q
                WHERE q.class_id = c.id
                  AND q.subject_id = sub.id
                  AND q.teacher_id = $1
                  AND q.exam_date >= NOW()
              )
            )::INTEGER as tugas_aktif

        FROM schedules s
        JOIN class_subjects cs ON s.class_subject_id = cs.id
        JOIN subjects sub ON cs.subject_id = sub.id
        JOIN classes c ON s.class_id = c.id
        LEFT JOIN class_members cm ON c.id = cm.class_id
        WHERE cs.teacher_id = $1
      `;
      let params = [teacherId];

      if (academic_year_id) {
        query += ` AND cs.academic_year_id = $2`;
        params.push(academic_year_id);
      }

      query += ` GROUP BY c.id, c.grade, c.name, cs.id, sub.subject_name, sub.subject_code, sub.id ORDER BY c.grade, c.name, sub.subject_name`;
      
      const result = await db.query(query, params);
      res.json(result.rows);
      //console.log("Data kelas yang diambil untuk guru:", result.rows);
    } catch (err) { 
      console.error("Error fetching teacher classes:", err);
      res.status(500).json({ error: "Gagal mengambil data kelas dari database" }); 
    }
  },

  getClassOverview: async (req, res) => {
    try {
      const { classId } = req.params; // Contoh: "VIII-A"
      // Kita JOIN ke tabel 'classes' untuk mencocokkan 
      // CONCAT(grade, '-', name) dengan 'VIII-A'
      const query = `
        SELECT u.id, u.full_name as name 
        FROM users u
        JOIN class_members cm ON u.id = cm.student_id
        JOIN classes c ON cm.class_id = c.id
        WHERE c.id = $1 
        ORDER BY u.full_name ASC
      `;
      
      const result = await db.query(query, [classId]);
      // Mengambil data dari result.rows (standar pg)
      res.json({ students: result.rows });
    } catch (err) {
      console.error("Error fetching students:", err);
      res.status(500).json({ message: "Gagal mengambil data siswa: " + err.message });
    }
  },

  // Perbaikan getClassMaterials
  getClassMaterials: async (req, res) => {
    try {
      // Ubah ? jadi $1
      const result = await db.query("SELECT * FROM materials WHERE class_id = $1 AND subject_id = $2 AND teacher_id = $3 ORDER BY id DESC", [req.params.classId, req.params.subjectId, req.user.id]);
      res.json(result.rows); 
    } catch (err) { res.status(500).json({ message: err.message }); }
  },

// --- PERBAIKAN CREATE MATERI ---
  createClassMaterial: async (req, res) => {
    try {
      const { title, description, link_url } = req.body;
      // Jika ada file yang diupload, ambil path-nya, jika tidak jadikan null
      const file_url = req.file ? `/uploads/${req.file.filename}` : null;

      // Tambahkan $6 untuk file_url
      await db.query(
        "INSERT INTO materials (class_id, teacher_id, title, description, link_url, file_url, subject_id) VALUES ($1, $2, $3, $4, $5, $6, $7)", 
        [req.params.classId, req.user.id, title, description, link_url, file_url, req.params.subjectId]
      );
      res.status(201).json({ success: true, message: "Materi berhasil dirilis" });
    } catch (err) { 
      res.status(500).json({ message: err.message }); 
    }
  },

  // Perbaikan getClassTasks
  getClassTasks: async (req, res) => {
    try {
      const result = await db.query("SELECT * FROM tasks WHERE class_id = $1 AND subject_id = $2 AND teacher_id = $3 ORDER BY id DESC", [req.params.classId, req.params.subjectId, req.user.id]);
      res.json(result.rows);
    } catch (err) { res.status(500).json({ message: err.message }); }
  },

  // Perbaikan createClassTask
  createClassTask: async (req, res) => {
    try {
      const { title, description, link_url, due_date } = req.body;
      const file_url = req.file ? `/uploads/${req.file.filename}` : null;

      // Tambahkan $7 untuk file_url
      await db.query(
        "INSERT INTO tasks (class_id, teacher_id, title, description, link_url, due_date, file_url, subject_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", 
        [req.params.classId, req.user.id, title, description, link_url, due_date || null, file_url, req.params.subjectId]
      );
      res.status(201).json({ success: true, message: "Tugas berhasil dibuat" });
    } catch (err) { 
      console.error("Error creating task:", err);
      res.status(500).json({ message: err.message }); 
    }
  },

  // Perbaikan getClassJournals
  getClassJournals: async (req, res) => {
    try {
      const result = await db.query("SELECT * FROM teaching_journals WHERE class_id = $1 AND subject_id = $2 AND teacher_id = $3 ORDER BY id DESC", [req.params.classId, req.params.subjectId, req.user.id]);
      res.json(result.rows);
    } catch (err) { res.status(500).json({ message: err.message }); }
  },

  // Perbaikan createClassJournal
  createClassJournal: async (req, res) => {
      try {
        const { journal_date, real_time_range, slots_taught, notes, absent_students, absent_student_ids, is_substitute, substitute_name } = req.body;
        await db.query(
          "INSERT INTO teaching_journals (class_id, teacher_id, journal_date, real_time_range, slots_taught, notes, absent_students, absent_student_ids, is_substitute, substitute_name, subject_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
          [req.params.classId, req.user.id, journal_date, real_time_range, slots_taught, notes, absent_students, absent_student_ids, is_substitute, substitute_name, req.params.subjectId]
        );
        res.status(201).json({ success: true, message: "Jurnal berhasil disimpan" });
      } catch (err) { res.status(500).json({ message: err.message }); }
    },

    updateClassJournal: async (req, res) => {
    try {
      const { id } = req.params;
      const { journal_date, real_time_range, slots_taught, notes, absent_students, absent_student_ids, is_substitute, substitute_name } = req.body;
      
      const query = `
        UPDATE teaching_journals 
        SET journal_date=$1, real_time_range=$2, slots_taught=$3, notes=$4, absent_students=$5, absent_student_ids=$6, is_substitute=$7, substitute_name=$8 
        WHERE id=$9
      `;
      const params = [journal_date, real_time_range, slots_taught, notes, absent_students, absent_student_ids, is_substitute, substitute_name, id];
      
      await db.query(query, params);
      res.json({ success: true, message: "Jurnal berhasil diperbarui" });
    } catch (err) { res.status(500).json({ message: err.message }); }
  },

  updateClassMaterial: async (req, res) => {
    try {
      const { id } = req.params;
      const { title, description, link_url } = req.body;

      // 1. Cek file lama di database (Sesuaikan nama tabel Anda, misal: materials)
      const oldMaterialResult = await db.query(
        "SELECT file_url FROM materials WHERE id = $1",
        [id]
      );

      const oldMaterial = oldMaterialResult.rows[0];
      let newFileUrl = oldMaterial?.file_url || null;

      // 2. Jika user mengunggah file BARU
      if (req.file) {
        newFileUrl = `/uploads/${req.file.filename}`;

        // 3. Hapus file LAMA dari folder server
        if (oldMaterial?.file_url) {
          const oldFilePath = path.join(
            __dirname,
            "..",
            oldMaterial.file_url.replace(/^\/+/, "")
          );

          // Cek apakah file fisik lama benar-benar ada, lalu hapus
          if (fs.existsSync(oldFilePath)) {
            fs.unlinkSync(oldFilePath); // 🔥 Mengeksekusi auto-delete
          }
        }
      }

      // 4. Update data di database dengan link file yang baru (atau tetap yang lama jika tidak ada upload)
      await db.query(
        `UPDATE materials
        SET title = $1,
            description = $2,
            link_url = $3,
            file_url = $4
        WHERE id = $5`,
        [title, description, link_url, newFileUrl, id]
      );

      res.json({ message: "Materi berhasil diperbarui" });
    } catch (err) {
      console.error("Error updateClassMaterial:", err.message);
      res.status(500).json({ error: "Gagal memperbarui materi" });
    }
  },

  updateClassTask: async (req, res) => {
    try {
      const { id } = req.params;
      const { title, description, link_url, due_date } = req.body;

      // Ambil data tugas lama
      const oldTaskResult = await db.query(
        "SELECT file_url FROM tasks WHERE id = $1",
        [id]
      );

      const oldTask = oldTaskResult.rows[0];

      let newFileUrl = oldTask?.file_url || null;

      // Jika ada file baru yang diupload
      if (req.file) {
        newFileUrl = `/uploads/${req.file.filename}`;

        // Hapus file lama jika ada
        if (oldTask?.file_url) {
          const oldFilePath = path.join(
            __dirname,
            "..",
            oldTask.file_url.replace(/^\/+/, "")
          );

          if (fs.existsSync(oldFilePath)) {
            fs.unlinkSync(oldFilePath);
          }
        }
      }

      await db.query(
        `UPDATE tasks
        SET title = $1,
            description = $2,
            link_url = $3,
            due_date = $4,
            file_url = $5
        WHERE id = $6`,
        [
          title,
          description,
          link_url,
          due_date || null,
          newFileUrl,
          id
        ]
      );

      res.json({
        success: true,
        message: "Tugas berhasil diperbarui"
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({
        message: err.message
      });
    }
  },

  deleteClassMaterial: async (req, res) => {
    try {
      const { id } = req.params;
      
      // 1. Cari data file sebelum dihapus
      const result = await db.query("SELECT file_url FROM materials WHERE id = $1", [id]);
      const file_url = result.rows[0]?.file_url;

      // 2. Hapus file fisik jika ada
      if (file_url) {
        const filePath = path.join(__dirname, "..", file_url.replace(/^\/+/, ""));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }

      // 3. Hapus data dari database
      await db.query("DELETE FROM materials WHERE id = $1", [id]);
      res.json({ success: true, message: "Materi berhasil dihapus" });
    } catch (err) {
      res.status(500).json({ message: "Gagal menghapus materi: " + err.message });
    }
  },

  deleteClassTask: async (req, res) => {
    try {
      const { id } = req.params;
      
      const result = await db.query("SELECT file_url FROM tasks WHERE id = $1", [id]);
      const file_url = result.rows[0]?.file_url;

      if (file_url) {
        const filePath = path.join(__dirname, "..", file_url.replace(/^\/+/, ""));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }

      await db.query("DELETE FROM tasks WHERE id = $1", [id]);
      res.json({ success: true, message: "Tugas berhasil dihapus" });
    } catch (err) {
      res.status(500).json({ message: "Gagal menghapus tugas: " + err.message });
    }
  },

  deleteClassJournal: async (req, res) => {
    try {
      const { id } = req.params;
      // Jurnal tidak punya file attachment, langsung hapus dari database
      await db.query("DELETE FROM teaching_journals WHERE id = $1", [id]);
      res.json({ success: true, message: "Jurnal berhasil dihapus" });
    } catch (err) {
      res.status(500).json({ message: "Gagal menghapus jurnal: " + err.message });
    }
  },

  // =========================================================================
  // MODUL PERANGKAT PEMBELAJARAN (GURU)
  // =========================================================================

  // 1. Ambil daftar mata pelajaran aktif untuk Dropdown Search di Frontend
  getActiveSubjects: async (req, res) => {
      // Tangkap dari query string
      const { academic_year_id } = req.query; 
      
      try {
        let query = "SELECT id, subject_name, subject_code FROM subjects WHERE is_active = true";
        let params = [];

        // Filter spesifik per tahun ajaran agar guru tidak salah tarik data
        if (academic_year_id) {
            query += " AND academic_year_id = $1";
            params.push(academic_year_id);
        }
        
        query += " ORDER BY subject_name ASC";

        const result = await db.query(query, params);
        res.json(result.rows);
      } catch (err) {
        res.status(500).json({ message: "Gagal mengambil mata pelajaran: " + err.message });
      }
    },

  // 2. Ambil semua perangkat pembelajaran milik guru berdasarkan Tahun Ajaran aktif
  getTeachingDocuments: async (req, res) => {
    try {
      const teacherId = req.user.id;
      const { academic_year_id } = req.query;

      if (!academic_year_id) {
        return res.status(400).json({ message: "Parameter academic_year_id diperlukan" });
      }

      const result = await db.query(
        `SELECT td.*, s.subject_name, s.subject_code 
         FROM teaching_documents td
         JOIN subjects s ON td.subject_id = s.id
         WHERE td.teacher_id = $1 AND td.academic_year_id = $2
         ORDER BY td.created_at DESC`,
        [teacherId, academic_year_id]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Gagal mengambil dokumen: " + err.message });
    }
  },

  // 3. Simpan perangkat pembelajaran baru (Bisa File atau Link Eksternal)
  createTeachingDocument: async (req, res) => {
    try {
      const teacherId = req.user.id;
      const { academic_year_id, subject_id, grade, title, description, link_url } = req.body;
      
      // Jika ada file yang diunggah, susun path-nya
      const file_url = req.file ? `/uploads/${req.file.filename}` : null;

      // Validasi: Guru harus memilih salah satu, file langsung ATAU link eksternal
      if (!file_url && !link_url) {
        return res.status(400).json({ message: "Silakan unggah file perangkat atau masukkan tautan eksternal" });
      }

      await db.query(
        `INSERT INTO teaching_documents 
          (teacher_id, academic_year_id, subject_id, grade, title, description, file_url, link_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [teacherId, academic_year_id, subject_id, grade, title, description || null, file_url, link_url || null]
      );

      res.status(201).json({ success: true, message: "Perangkat pembelajaran berhasil disimpan" });
    } catch (err) {
      // Safe guard: jika database error tapi file sudah kepalang masuk ke folder uploads, hapus filenya
      if (req.file) {
        const filePath = path.join(__dirname, "..", "uploads", req.file.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      res.status(500).json({ message: "Gagal menyimpan dokumen: " + err.message });
    }
  },

  // 4. Perbarui Perangkat Pembelajaran
  updateTeachingDocument: async (req, res) => {
    try {
      const { id } = req.params;
      const { subject_id, grade, title, description, link_url, hapus_file_lama } = req.body;

      // Ambil data dokumen lama dari DB
      const checkDoc = await db.query("SELECT file_url, link_url FROM teaching_documents WHERE id = $1", [id]);
      if (checkDoc.rows.length === 0) {
        return res.status(404).json({ message: "Dokumen tidak ditemukan" });
      }

      let currentFileUrl = checkDoc.rows[0].file_url;
      let currentLinkUrl = link_url || checkDoc.rows[0].link_url;

      // Skenario A: Ada file baru yang diunggah
      if (req.file) {
        currentFileUrl = `/uploads/${req.file.filename}`;
        currentLinkUrl = null; // Menghapus link jika berganti ke file langsung

        // Hapus file lama di lokal server jika sebelumnya ada
        if (checkDoc.rows[0].file_url) {
          const oldFilePath = path.join(__dirname, "..", checkDoc.rows[0].file_url.replace(/^\/+/, ""));
          if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
        }
      } 
      // Skenario B: Guru mengubah mode dari File ke Link eksternal (menghapus file lama)
      else if (link_url && (hapus_file_lama === "true" || hapus_file_lama === true)) {
        currentFileUrl = null;
        if (checkDoc.rows[0].file_url) {
          const oldFilePath = path.join(__dirname, "..", checkDoc.rows[0].file_url.replace(/^\/+/, ""));
          if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
        }
      }

      // Validasi Akhir sebelum update
      if (!currentFileUrl && !currentLinkUrl) {
        return res.status(400).json({ message: "Dokumen tidak boleh kosong. Sediakan file atau link eksternal." });
      }

      await db.query(
        `UPDATE teaching_documents 
         SET subject_id = $1, grade = $2, title = $3, description = $4, file_url = $5, link_url = $6, updated_at = CURRENT_TIMESTAMP
         WHERE id = $7`,
        [subject_id, grade, title, description || null, currentFileUrl, currentLinkUrl, id]
      );

      res.json({ success: true, message: "Perangkat pembelajaran berhasil diperbarui" });
    } catch (err) {
      if (req.file) {
        const filePath = path.join(__dirname, "..", "uploads", req.file.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      res.status(500).json({ message: "Gagal memperbarui dokumen: " + err.message });
    }
  },

  // 5. Hapus Perangkat Pembelajaran beserta file fisiknya
  deleteTeachingDocument: async (req, res) => {
    try {
      const { id } = req.params;

      const doc = await db.query("SELECT file_url FROM teaching_documents WHERE id = $1", [id]);
      if (doc.rows.length === 0) {
        return res.status(404).json({ message: "Dokumen tidak ditemukan" });
      }

      // Jika ada file fisik di server, hapus terlebih dahulu
      const file_url = doc.rows[0].file_url;
      if (file_url) {
        const filePath = path.join(__dirname, "..", file_url.replace(/^\/+/, ""));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }

      await db.query("DELETE FROM teaching_documents WHERE id = $1", [id]);
      res.json({ success: true, message: "Perangkat pembelajaran berhasil dihapus" });
    } catch (err) {
      res.status(500).json({ message: "Gagal menghapus dokumen: " + err.message });
    }
  },

 // --- MODUL ULANGAN / QUIZ (Sesuai Skema Tabel Baru) ---
  getClassQuizzes: async (req, res) => {
    try {
      const result = await db.query(
        `SELECT id, class_id, teacher_id, title, instruction, embed_url, 
                TO_CHAR(exam_date, 'YYYY-MM-DD') as exam_date, 
                TO_CHAR(start_time, 'HH24:MI') as start_time, 
                TO_CHAR(end_time, 'HH24:MI') as end_time 
         FROM quizzes 
         WHERE class_id = $1 AND subject_id = $2 AND teacher_id = $3
         ORDER BY id DESC`,
        [req.params.classId, req.params.subjectId, req.user.id] // Pastikan subjectId juga dipertimbangkan jika diperlukan untuk filter lebih spesifik
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Gagal mengambil data kuis: " + err.message });
    }
  },

  createClassQuiz: async (req, res) => {
    try {
      const { title, instruction, embed_url, exam_date, start_time, end_time } = req.body;
      
      // Ekstraksi otomatis URL murni dari kode embed iframe
      let extractedUrl = embed_url;
      const iframeRegex = /src=["']([^"']+)["']/;
      const match = embed_url.match(iframeRegex);
      if (match && match[1]) {
        extractedUrl = match[1];
      }

      await db.query(
        `INSERT INTO quizzes (class_id, teacher_id, title, instruction, embed_url, exam_date, start_time, end_time, subject_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [req.params.classId, req.user.id, title, instruction || null, extractedUrl, exam_date, start_time, end_time, req.params.subjectId]
      );
      res.status(201).json({ success: true, message: "Ulangan/Quiz berhasil dibuat" });
    } catch (err) {
      res.status(500).json({ message: "Gagal membuat kuis: " + err.message });
    }
  },

  updateClassQuiz: async (req, res) => {
    try {
      const { id } = req.params;
      const { title, instruction, embed_url, exam_date, start_time, end_time } = req.body;
      
      let extractedUrl = embed_url;
      const iframeRegex = /src=["']([^"']+)["']/;
      const match = embed_url.match(iframeRegex);
      if (match && match[1]) {
        extractedUrl = match[1];
      }

      await db.query(
        `UPDATE quizzes 
         SET title = $1, instruction = $2, embed_url = $3, exam_date = $4, start_time = $5, end_time = $6 
         WHERE id = $7`,
        [title, instruction || null, extractedUrl, exam_date, start_time, end_time, id]
      );
      res.json({ success: true, message: "Ulangan/Quiz berhasil diperbarui" });
    } catch (err) {
      res.status(500).json({ message: "Gagal memperbarui kuis: " + err.message });
    }
  },

  deleteClassQuiz: async (req, res) => {
    try {
      const { id } = req.params;
      await db.query("DELETE FROM quizzes WHERE id = $1", [id]);
      res.json({ success: true, message: "Ulangan/Quiz berhasil dihapus" });
    } catch (err) {
      res.status(500).json({ message: "Gagal menghapus kuis: " + err.message });
    }
  },

  // --- REKAP SKOR NILAI SISWA & IMPORT EXCEL VIA UNIQUE CONSTRAINT ---
  getQuizScores: async (req, res) => {
      try {
        const { classId, id } = req.params; // classId = "VIII-A", id = quiz_id
        
        // 1. Ambil KKM Global sebagai Base Default
        const kkmGlobalRes = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'default_kkm'");
        let activeKkm = kkmGlobalRes.rows.length > 0 ? parseFloat(kkmGlobalRes.rows[0].setting_value) : 75;

        // Ekstrak jenjang kelas (grade) dari classId. 
        // Contoh: "VIII-A" akan di-split berdasarkan '-' lalu diambil bagian pertamanya -> "VIII"
        const gradeString = classId.split('-')[0];

        // 2. Ambil KKM Custom dari tabel subjects berdasarkan guru dan jenjang kelasnya
        const kkmMapelRes = await db.query(`
          SELECT sub.kkm 
          FROM class_subjects cs
          JOIN subjects sub ON cs.subject_id = sub.id
          WHERE cs.teacher_id = $1 AND sub.grade = $2
          LIMIT 1
        `, [req.user.id, gradeString]);

        // Jika mapel punya custom KKM (tidak null), override KKM Global
        if (kkmMapelRes.rows.length > 0 && kkmMapelRes.rows[0].kkm !== null) {
          activeKkm = parseFloat(kkmMapelRes.rows[0].kkm);
        }

        // 3. Ambil data nilai siswa (menggunakan query Anda yang sudah fix/benar)
        const query = `
          SELECT u.id as student_id, u.username, u.full_name as name, qs.score
          FROM users u
          JOIN class_members cm ON u.id = cm.student_id
          JOIN classes c ON cm.class_id = c.id
          LEFT JOIN quiz_scores qs ON qs.quiz_id = $1 AND qs.student_id = u.id
          WHERE c.id = $2
          ORDER BY u.full_name ASC
        `;
        const result = await db.query(query, [id, classId]);
        
        // Return 2 object: scores (array) dan kkm (angka)
        res.json({ scores: result.rows, kkm: activeKkm });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Gagal mengambil skor kuis: " + err.message });
      }
    },

  importQuizScores: async (req, res) => {
    try {
      const { id } = req.params; // quiz_id
      if (!req.file) {
        return res.status(400).json({ message: "File dokumen excel tidak terdeteksi" });
      }

      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet);
      //console.log("Data yang diimpor dari Excel:", data);

      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      for (const row of data) {
        let studentName = "";
        let usernameLms = "";
        let rawScore = "";

        // Normalisasi header kolom pembacaan Excel
        for (const key of Object.keys(row)) {
          const lowerKey = key.toLowerCase().trim();
          if (lowerKey === "nama" || lowerKey.includes("nama lengkap")) {
            studentName = String(row[key]).trim();
          } else if (lowerKey === "username lms" || lowerKey.includes("username")) {
            usernameLms = String(row[key]).trim();
          } else if (lowerKey === "score" || lowerKey === "skor" || lowerKey.includes("skor/")) {
            rawScore = String(row[key]).trim();
          }
        }

        if (studentName || usernameLms) {
          // Parsing nilai pecahan gform numerik (misal: "80 / 100" menjadi 80.00)
          let finalScore = 0;
          if (rawScore.includes("/")) {
            const parts = rawScore.split("/");
            const obtained = parseFloat(parts[0].trim());
            const total = parseFloat(parts[1].trim());
            if (!isNaN(obtained) && !isNaN(total) && total > 0) {
              finalScore = (obtained / total) * 100;
            }
          } else {
            finalScore = parseFloat(rawScore) || 0;
          }

          // Cari student_id dari tabel users berdasarkan data unik username / nama lengkap
          let userQuery;
          if (usernameLms) {
            userQuery = await db.query("SELECT id FROM users WHERE LOWER(username) = LOWER($1)", [usernameLms]);
          }
          if ((!userQuery || userQuery.rows.length === 0) && studentName) {
            userQuery = await db.query("SELECT id FROM users WHERE LOWER(full_name) = LOWER($1)", [studentName]);
          }

          if (userQuery && userQuery.rows.length > 0) {
            const studentId = userQuery.rows[0].id;

            // Manfaatkan klausa ON CONFLICT untuk manajemen upsert data instan aman
            await db.query(
              `INSERT INTO quiz_scores (quiz_id, student_id, score) 
               VALUES ($1, $2, $3) 
               ON CONFLICT (quiz_id, student_id) 
               DO UPDATE SET score = EXCLUDED.score`,
              [id, studentId, finalScore]
            );
          }
        }
      }

      res.json({ success: true, message: "Data nilai Google Form berhasil di-import!" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Gagal memproses import dokumen excel: " + err.message });
    }
  },

  // FUNGSI BARU: Untuk menyimpan nilai kuis yang diinput manual satu per satu
  updateQuizScore: async (req, res) => {
    try {
      const { id } = req.params; // quiz_id
      const { student_id, score } = req.body;

      await db.query(
        `INSERT INTO quiz_scores (quiz_id, student_id, score) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (quiz_id, student_id) 
         DO UPDATE SET score = EXCLUDED.score`,
        [id, student_id, score === "" ? null : parseFloat(score)]
      );

      res.json({ success: true, message: "Nilai kuis manual berhasil disimpan!" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Gagal memperbarui skor kuis: " + err.message });
    }
  },

  getTaskScores: async (req, res) => {
    try {
      const { classId, id } = req.params; // id merupakan task_id
      
      const kkmGlobalRes = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'default_kkm'");
      let activeKkm = kkmGlobalRes.rows.length > 0 ? parseFloat(kkmGlobalRes.rows[0].setting_value) : 75;

      const gradeString = classId.split('-')[0];
      const kkmMapelRes = await db.query(`
        SELECT sub.kkm 
        FROM class_subjects cs
        JOIN subjects sub ON cs.subject_id = sub.id
        WHERE cs.teacher_id = $1 AND sub.grade = $2
        LIMIT 1
      `, [req.user.id, gradeString]);

      if (kkmMapelRes.rows.length > 0 && kkmMapelRes.rows[0].kkm !== null) {
        activeKkm = parseFloat(kkmMapelRes.rows[0].kkm);
      }

      // PERUBAHAN: Tambahkan ts.task_url pada SELECT
      const query = `
        SELECT u.id as student_id, u.username, u.full_name as name, ts.score, ts.task_url
        FROM users u
        JOIN class_members cm ON u.id = cm.student_id
        JOIN classes c ON cm.class_id = c.id
        LEFT JOIN task_scores ts ON ts.task_id = $1 AND ts.student_id = u.id
        WHERE c.id = $2
        ORDER BY u.full_name ASC
      `;
      
      const result = await db.query(query, [id, classId]);
      res.json({ scores: result.rows, kkm: activeKkm });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Gagal mengambil skor tugas: " + err.message });
    }
  },

  // FUNGSI BARU: Untuk menyimpan nilai tugas yang diinput manual oleh guru
  updateTaskScore: async (req, res) => {
    try {
      const { id } = req.params; // task_id
      const { student_id, score } = req.body;

      // Upsert: Jika data belum ada, Insert. Jika sudah ada, Update skornya.
      await db.query(
        `INSERT INTO task_scores (task_id, student_id, score) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (task_id, student_id) 
         DO UPDATE SET score = EXCLUDED.score, updated_at = CURRENT_TIMESTAMP`,
        [id, student_id, score]
      );

      res.json({ success: true, message: "Nilai tugas berhasil disimpan!" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Gagal memperbarui skor tugas: " + err.message });
    }
  },

getGradebookMatrix: async (req, res) => {
    try {
      const { classId, subjectId } = req.params;

        // 1. Ambil KKM Global Default dari app_settings sebagai Fallback
      const kkmGlobalRes = await db.query(
        "SELECT setting_value FROM app_settings WHERE setting_key = 'default_kkm'"
      );
      let activeKkm = kkmGlobalRes.rows.length > 0 ? parseFloat(kkmGlobalRes.rows[0].setting_value) : 75;

      // 2. Ambil KKM Spesifik Mata Pelajaran dari tabel subjects
      const kkmMapelRes = await db.query(
        "SELECT kkm FROM subjects WHERE id = $1", 
        [subjectId]
      );
      if (kkmMapelRes.rows.length > 0 && kkmMapelRes.rows[0].kkm !== null) {
        activeKkm = parseFloat(kkmMapelRes.rows[0].kkm);
      }
      
      const parsedSubjectId = parseInt(subjectId, 10);
      if (isNaN(parsedSubjectId)) {
          return res.status(400).json({ message: "ID Mata Pelajaran tidak valid." });
      }

      // 1. Ambil daftar siswa (Ini tetap pakai JOIN karena tabel user butuh relasi kelas)
      const studentsQuery = `
        SELECT u.id as student_id, u.username, u.full_name as name
        FROM users u
        JOIN class_members cm ON u.id = cm.student_id
        JOIN classes c ON cm.class_id = c.id
        WHERE c.id = $1
        ORDER BY u.full_name ASC
      `;
      const studentsRes = await db.query(studentsQuery, [classId]);
      
      // 2. Ambil Tugas & Kuis (SOLUSI SUPER SIMPEL: Langsung cocokan class_id dengan $1)
      const tasksRes = await db.query(
        `SELECT id, title, 'task' as type FROM tasks WHERE class_id = $1 AND subject_id = $2 ORDER BY created_at ASC`, 
        [classId, parsedSubjectId]
      );
      
      const quizzesRes = await db.query(
        `SELECT id, title, 'quiz' as type FROM quizzes WHERE class_id = $1 AND subject_id = $2 ORDER BY created_at ASC`, 
        [classId, parsedSubjectId]
      );
      
      const assessments = [
        ...tasksRes.rows.map(t => ({ uid: `task_${t.id}`, id: t.id, title: t.title, type: t.type })),
        ...quizzesRes.rows.map(q => ({ uid: `quiz_${q.id}`, id: q.id, title: q.title, type: q.type }))
      ];

      // 3. Ambil data Nilai (Scores)
      const taskScores = await db.query(
        `SELECT student_id, task_id, score FROM task_scores WHERE task_id IN (SELECT id FROM tasks WHERE subject_id = $1)`, 
        [parsedSubjectId]
      );
      const quizScores = await db.query(
        `SELECT student_id, quiz_id, score FROM quiz_scores WHERE quiz_id IN (SELECT id FROM quizzes WHERE subject_id = $1)`, 
        [parsedSubjectId]
      );

      // 4. Susun Format Matrix
      const students = studentsRes.rows.map(student => {
        const scores = {};
        taskScores.rows.forEach(ts => { if (ts.student_id === student.student_id) scores[`task_${ts.task_id}`] = ts.score; });
        quizScores.rows.forEach(qs => { if (qs.student_id === student.student_id) scores[`quiz_${qs.quiz_id}`] = qs.score; });
        return { ...student, scores };
      });

      res.json({ assessments, students, kkm: activeKkm });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Gagal mengambil matriks nilai kelas" });
    }
  },

 exportGradebookExcel: async (req, res) => {
    try {
      const { classId, subjectId } = req.params;
      
      const parsedSubjectId = parseInt(subjectId, 10);
      if (isNaN(parsedSubjectId)) {
        return res.status(400).json({ message: "ID Mata Pelajaran tidak valid." });
      }
      
      const studentsRes = await db.query(`SELECT u.id as student_id, u.username, u.full_name as name FROM users u JOIN class_members cm ON u.id = cm.student_id JOIN classes c ON cm.class_id = c.id WHERE c.id = $1 ORDER BY u.full_name ASC`, [classId]);
      
      // SOLUSI SIMPEL DITERAPKAN DI SINI JUGA
      const tasksRes = await db.query(`SELECT id, title FROM tasks WHERE class_id = $1 AND subject_id = $2`, [classId, parsedSubjectId]);
      const quizzesRes = await db.query(`SELECT id, title FROM quizzes WHERE class_id = $1 AND subject_id = $2`, [classId, parsedSubjectId]);
      
      const taskScores = await db.query(`SELECT student_id, task_id, score FROM task_scores WHERE task_id IN (SELECT id FROM tasks WHERE subject_id = $1)`, [parsedSubjectId]);
      const quizScores = await db.query(`SELECT student_id, quiz_id, score FROM quiz_scores WHERE quiz_id IN (SELECT id FROM quizzes WHERE subject_id = $1)`, [parsedSubjectId]);

      const assessments = [
        ...tasksRes.rows.map(t => ({ uid: `task_${t.id}`, title: t.title })),
        ...quizzesRes.rows.map(q => ({ uid: `quiz_${q.id}`, title: q.title }))
      ];

      const excelData = studentsRes.rows.map((student, index) => {
        const row = {
          "No": index + 1,
          "Nama Siswa": student.name,
          "NIS/Username": student.username || "-"
        };
        
        assessments.forEach(ass => {
           let score = null;
           if (ass.uid.startsWith("task_")) {
              const f = taskScores.rows.find(ts => ts.student_id === student.student_id && `task_${ts.task_id}` === ass.uid);
              if (f) score = f.score;
           } else {
              const f = quizScores.rows.find(qs => qs.student_id === student.student_id && `quiz_${qs.quiz_id}` === ass.uid);
              if (f) score = f.score;
           }
           row[ass.title] = score !== null ? Number(score) : "Belum";
        });
        
        return row;
      });

      const worksheet = XLSX.utils.json_to_sheet(excelData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Rekap_Nilai");
      const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

      res.setHeader('Content-Disposition', `attachment; filename="Rekap_Nilai_${classId}.xlsx"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(excelBuffer);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Gagal mengekspor file Excel" });
    }
  },

  getPendingGradings: async (req, res) => {
    try {
      const teacherId = req.user.id;
      const { academic_year_id } = req.query;

      // Validasi awal agar data aman
      if (!academic_year_id) {
        return res.status(400).json({ error: "Parameter academic_year_id diperlukan" });
      }

      // 1. QUERY UNTUK TUGAS (TASKS) YANG MELEWATI DEADLINE
      const tasksQuery = `
        SELECT * FROM (
          SELECT 
            'Tugas' AS type,
            t.id,
            t.title,
            c.id AS class_id,
            CONCAT(c.grade, '-', c.name) as class_name,
            t.due_date,
            t.subject_id,
            sub.subject_name,
            EXTRACT(DAY FROM NOW() - t.due_date)::INTEGER AS days_overdue,
            (
              SELECT COUNT(cm.student_id) 
              FROM class_members cm
              JOIN classes c2 ON cm.class_id = c2.id
              WHERE c2.id = t.class_id
                AND cm.student_id NOT IN (
                  SELECT ts.student_id FROM task_scores ts WHERE ts.task_id = t.id AND ts.score IS NOT NULL
                )
            ) AS unsubmitted_count
          FROM tasks t
          JOIN subjects sub ON t.subject_id = sub.id
          JOIN classes c ON c.id = t.class_id
          WHERE t.teacher_id = $1 
            AND c.academic_year_id = $2
            AND t.due_date < NOW()
        ) tasks_overdue
        WHERE unsubmitted_count > 0
      `;

      // 2. QUERY UNTUK KUIS (QUIZZES) YANG MELEWATI EXAM DATE
      const quizzesQuery = `
        SELECT * FROM (
          SELECT 
            'Kuis' AS type,
            q.id,
            q.title,
            c.id AS class_id,
            CONCAT(c.grade, '-', c.name) as class_name,
            q.exam_date AS due_date,
            q.subject_id,
            sub.subject_name,
            EXTRACT(DAY FROM NOW() - q.exam_date)::INTEGER AS days_overdue,
            (
              SELECT COUNT(cm.student_id) 
              FROM class_members cm
              JOIN classes c2 ON cm.class_id = c2.id
              WHERE c2.id = q.class_id
                AND cm.student_id NOT IN (
                  SELECT qs.student_id FROM quiz_scores qs WHERE qs.quiz_id = q.id AND qs.score IS NOT NULL
                )
            ) AS unsubmitted_count
          FROM quizzes q
          JOIN subjects sub ON q.subject_id = sub.id
          JOIN classes c ON c.id = q.class_id
          WHERE q.teacher_id = $1 
            AND c.academic_year_id = $2
            AND q.exam_date < NOW()
        ) quizzes_overdue
        WHERE unsubmitted_count > 0
      `;

      // Jalankan kedua query secara paralel menggunakan Promise.all agar performanya kencang
      const [tasksResult, quizzesResult] = await Promise.all([
        db.query(tasksQuery, [teacherId, academic_year_id]),
        db.query(quizzesQuery, [teacherId, academic_year_id])
      ]);

      // Gabungkan hasil array dari Tugas dan Kuis menjadi satu kesatuan
      const allPending = [...tasksResult.rows, ...quizzesResult.rows];

      // Urutkan data dari yang paling lama terlewat (days_overdue paling besar) agar yang paling urgent naik ke atas
      allPending.sort((a, b) => b.days_overdue - a.days_overdue);

      // Kembalikan hasilnya ke Frontend
      res.json(allPending);
    } catch (err) {
      console.error("Error pada getPendingGradings:", err);
      res.status(500).json({ error: "Gagal mengambil data penilaian tertunda" });
    }
  },

  getClassNameByClassId: async (req, res) => {
      try {
          const { classId } = req.query;

          // Validasi jika classId tidak dikirim di query params
          if (!classId) {
              return res.status(400).json({ error: "classId diperlukan di query parameter" });
          }

          // Ambil data grade dan name untuk digabungkan (misal: 10-A)
          const classQuery = `SELECT grade, name FROM classes WHERE id = $1`;
          const classRes = await db.query(classQuery, [classId]);

          // Jika data kelas tidak ditemukan di database
          if (classRes.rows.length === 0) {
              return res.status(404).json({ error: "Kelas tidak ditemukan" });
          }

          // Gabungkan grade dan name, misal: "10-A"
          const { grade, name } = classRes.rows[0];
          const className = `${grade}-${name}`;

          // Kirim respon sukses ke frontend
          return res.status(200).json({ className });

      } catch (error) {
          console.error("Error getClassNameByClassId: ", error);
          return res.status(500).json({ error: "Terjadi kesalahan pada server" });
      }
  },

  getUploadLimit: async (req,res) => {
        try{
            const query = `SELECT * FROM app_settings WHERE setting_key = 'upload_limit'`;
            const {rows} = await db.query(query);
            res.json(rows[0]);
        }catch(err){
            console.error(err);
            res.status(500).json({error: 'Internal server error'});
        };
  }
};

module.exports = teacherController;