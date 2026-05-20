// src/controllers/ClassController.js
const db = require("../config/db"); // Sesuaikan dengan path koneksi database/pool PostgreSQL Anda

/**
 * Mendapatkan semua data kelas beserta informasi Wali Kelas
 */
const getClasses = async (req, res) => {
  // 1. Tangkap academic_year_id yang dikirim frontend via query parameter (?academic_year_id=...)
  //console.log("Received academic_year_id in query:", req.params); // Debug log untuk memastikan ID terkirim dengan benar
  const { academic_year_id } = req.params;
  try {
    // 2. Buat query dasar (Base Query) dangan perhitungan agregasi siswa terdaftar
    let query = `
      SELECT 
        c.id, 
        c.grade, 
        c.name AS class_name, 
        c.is_active,
        c.capacity,            -- 🌟 Mengambil kapasitas asli dari DB
        c.homeroom_teacher_id, -- 🌟 Wajib diambil agar modal edit bisa auto-select wali kelas
        ay.year_name AS academic_year,
        u.full_name AS homeroom_teacher_name,
        COUNT(cm.student_id)::INT AS student_count -- 🌟 Menghitung siswa yang di-plot ke kelas ini
      FROM classes c
      JOIN academic_years ay ON c.academic_year_id = ay.id
      LEFT JOIN users u ON c.homeroom_teacher_id = u.id
      LEFT JOIN class_members cm ON c.id = cm.class_id -- 🌟 Gabungkan ke tabel relasi plotting siswa
    `;
    
    const params = [];

    // 3. JIKA frontend mengirimkan academic_year_id, suntikkan klausul WHERE ke SQL
    if (academic_year_id) {
      query += ` WHERE c.academic_year_id = $1`;
      params.push(parseInt(academic_year_id)); // Konversi ke integer agar aman
    }

    // 4. Tambahkan pengelompokan (GROUP BY) karena menggunakan fungsi COUNT()
    query += `
      GROUP BY 
        c.id, 
        c.grade, 
        c.name, 
        c.is_active, 
        c.capacity, 
        c.homeroom_teacher_id, 
        ay.year_name, 
        u.full_name
    `;

    // 5. Tambahkan pengurutan di akhir query setelah GROUP BY
    query += ` ORDER BY c.grade ASC, c.name ASC;`;
    
    // 6. Eksekusi ke database dengan membawa array params
    const { rows } = await db.query(query, params);
    
    return res.status(200).json({
      success: true,
      message: "Berhasil mengambil data kelas",
      data: rows
    });
  } catch (error) {
    console.error("Error getClasses:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const addClass = async (req, res) => {
  // 🌟 Tambahkan capacity ke dalam list request body destructuring
  const { academic_year_id, room_id, grade, name, homeroom_teacher_id, capacity } = req.body;

  // Validasi input wajib
  if (!academic_year_id || !grade || !name) {
    return res.status(400).json({
      success: false,
      message: "Tahun ajaran, tingkatan (grade), dan nama kelas wajib diisi"
    });
  }

  try {
    // Query untuk memasukkan data kelas baru (ditambah kolom capacity)
    const query = `
      INSERT INTO classes (academic_year_id, room_id, grade, name, homeroom_teacher_id, capacity)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    
    // Konversi nilai kapasitas ke integer murni, beri fallback 36 jika kosong
    const targetCapacity = capacity ? parseInt(capacity, 10) : 36;

    // Jika room_id atau homeroom_teacher_id tidak diisi di form, kirim nilai null ke DB
    const values = [
      academic_year_id, 
      room_id || null, 
      grade, 
      name, 
      homeroom_teacher_id || null,
      targetCapacity // 🌟 Masukkan nilai kapasitas ke parameter $6
    ];

    const { rows } = await db.query(query, values);

    return res.status(201).json({
      success: true,
      message: "Kelas baru berhasil ditambahkan",
      data: rows[0]
    });
  } catch (error) {
    console.error("Error addClass:", error);

    // Deteksi error jika melanggar unique constraint (unique_class_per_year)
    if (error.code === "23505") {
      return res.status(400).json({
        success: false,
        message: `Kelas ${grade} ${name} sudah ada untuk tahun ajaran tersebut.`
      });
    }

    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const updateClass = async (req, res) => {
  const { id } = req.params;
  // 1. Tangkap parameter dari payload frontend
  const { grade, name, capacity, homeroom_teacher_id } = req.body;

  try {
    // 2. Query UPDATE yang menyertakan capacity murni ke table classes
    const query = `
      UPDATE classes 
      SET 
        grade = $1, 
        name = $2, 
        capacity = $3, -- 🌟 PASTIKAN KOLOM INI SUDAH DIUPDATE KEDALAM DATABASE
        homeroom_teacher_id = $4,
        updated_at = NOW()
      WHERE id = $5
      RETURNING *;
    `;

    const values = [
      grade, 
      name, 
      parseInt(capacity, 10), 
      homeroom_teacher_id ? parseInt(homeroom_teacher_id, 10) : null, 
      parseInt(id, 10)
    ];

    const { rows } = await db.query(query, values);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Kelas tidak ditemukan" });
    }

    return res.status(200).json({
      success: true,
      message: "Berhasil memperbarui data kelas",
      data: rows[0]
    });

  } catch (error) {
    console.error("Error updateClass:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * 🚀 FITUR DELETE KELAS (Skenario Ketat - Proteksi Riwayat Siswa)
 */
const deleteClass = async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Validasi Preventif: Cek apakah sudah ada siswa ter-plotting di kelas ini
    const memberCheck = await db.query("SELECT COUNT(*) FROM class_members WHERE class_id = $1", [id]);
    
    if (parseInt(memberCheck.rows[0].count) > 0) {
      return res.status(400).json({
        success: false,
        message: "Kelas gagal dihapus! Masih ada siswa yang terdaftar di kelas ini. Kosongkan data siswa terlebih dahulu."
      });
    }

    // 2. Jika aman (kosong), lakukan hard delete fisik dari database
    const { rowCount } = await db.query("DELETE FROM classes WHERE id = $1", [id]);

    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: "Data kelas tidak ditemukan" });
    }

    return res.status(200).json({
      success: true,
      message: "Kelas berhasil dihapus secara permanen dari database"
    });
  } catch (error) {
    console.error("Error deleteClass:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};



/**
 * Melakukan plotting / assign banyak siswa sekaligus ke dalam satu kelas
 */
const assignStudentsToClass = async (req, res) => {
  const { classId } = req.params;
  const { student_ids } = req.body; // Ekspektasi data: [12, 13, 14, 15] (Array of ID)

  if (!student_ids || !Array.isArray(student_ids) || student_ids.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Daftar ID siswa tidak valid atau kosong"
    });
  }

  // Menggunakan Transaction agar jika salah satu siswa gagal dimasukkan, seluruh proses dibatalkan (Rollback)
  const client = await db.connect();
  
  try {
    await client.query("BEGIN");

    // Loop untuk memasukkan setiap siswa ke dalam tabel penghubung class_members
    const insertQuery = `
      INSERT INTO class_members (class_id, student_id) 
      VALUES ($1, $2)
      ON CONFLICT (class_id, student_id) DO NOTHING; -- Mencegah error jika siswa sudah terdaftar
    `;

    for (const studentId of student_ids) {
      await client.query(insertQuery, [classId, studentId]);
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Berhasil memasukkan ${student_ids.length} siswa ke dalam kelas.`
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error assignStudentsToClass:", error);
    return res.status(500).json({ success: false, message: "Gagal memproses plotting siswa" });
  } finally {
    client.release();
  }
};

const getAvailableTeacherForHomeroom = async (req, res) => {
  const { academic_year_id } = req.query;

  if (!academic_year_id) {
    return res.status(400).json({ success: false, message: "academic_year_id diperlukan" });
  }

  try {
    const query = `
      SELECT id, full_name AS name 
      FROM users 
      -- 1. Kunci utama: Hanya user dengan role guru dan berstatus AKTIF
      WHERE role = 'teacher' AND is_active = true
      
      -- 2. Pengecualian: Guru tidak boleh sudah terdaftar sebagai wali kelas di tahun ajaran ini
      AND id NOT IN (
        SELECT homeroom_teacher_id 
        FROM classes 
        WHERE academic_year_id = $1 
          AND homeroom_teacher_id IS NOT NULL
      )
      
      ORDER BY full_name ASC;
    `;
    
    const { rows } = await db.query(query, [parseInt(academic_year_id)]);
    
    return res.status(200).json({
      success: true,
      message: "Berhasil mengambil data kandidat wali kelas yang tersedia",
      data: rows
    });
  } catch (error) {
    console.error("Error getAvailableTeacherForHomeroom:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const getAvailableStudentsForClassPlotting = async (req, res) => {
  // 1. Ambil ID tahun ajaran aktif dari query parameter (?academic_year_id=...)
  const { academic_year_id } = req.query;

  // 2. Validasi input parameter wajib
  if (!academic_year_id) {
    return res.status(400).json({ 
      success: false, 
      message: "academic_year_id diperlukan untuk memfilter data tahun ajaran aktif!" 
    });
  }

  try {
    // 3. Query menggunakan NOT EXISTS untuk proteksi terhadap nilai NULL & optimalisasi performa
    const query = `
      SELECT 
        u.id, 
        u.username, 
        u.full_name,
        u.gender,
        u.religion
      FROM users u
      -- Filter utama: Pastikan hanya mengambil user dengan role siswa yang statusnya AKTIF
      WHERE u.role = 'student' 
        AND u.is_active = true
        
        -- Filter relasi: Kecualikan siswa yang sudah punya plotting kelas di tahun ajaran ini
        AND NOT EXISTS (
          SELECT 1 
          FROM class_members cm
          JOIN classes c ON cm.class_id = c.id
          WHERE c.academic_year_id = $1 
            AND cm.student_id = u.id
        )
        
      -- Urutkan berdasarkan nama lengkap dari A sampai Z
      ORDER BY u.full_name ASC;
    `;

    // 4. Eksekusi query dengan parameter aman (Mencegah SQL Injection)
    const { rows } = await db.query(query, [parseInt(academic_year_id)]);

    // 5. Kembalikan response sukses ke frontend
    return res.status(200).json({ 
      success: true, 
      message: "Berhasil mengambil data kandidat siswa yang siap di-plotting",
      data: rows 
    });

  } catch (error) {
    // 6. Logging error internal untuk mempermudah debugging jika terjadi kendala database
    console.error("Error pada getAvailableStudentsForClassPlotting:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Internal server error. Gagal mengambil data ketersediaan siswa." 
    });
  }
};

/**
 * @desc    1. GET DETAIL INFO KELAS (Nama kelas & info nama wali kelas)
 * @route   GET /api/admin/classes/:classId
 */
const getClassDetail = async (req, res) => {
  const { classId } = req.params;

  try {
    const query = `
      SELECT 
        c.id, 
        c.grade, 
        c.name AS class_name, 
        c.homeroom_teacher_id,
        u.full_name AS homeroom_teacher_name
      FROM classes c
      LEFT JOIN users u ON c.homeroom_teacher_id = u.id AND u.role = 'teacher'
      WHERE c.id = $1;
    `;
    const { rows } = await db.query(query, [parseInt(classId)]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Ruang kelas tidak ditemukan" });
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error("Error pada getClassDetail:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * @desc    2. GET DAFTAR SISWA YANG SUDAH TERDAFTAR DI KELAS INI
 * @route   GET /api/admin/classes/:classId/members
 */
const getClassMembers = async (req, res) => {
  const { classId } = req.params;

  try {
    const query = `
      SELECT 
        u.id, 
        u.username, 
        u.full_name,
        u.religion,
        u.gender
      FROM class_members cm
      JOIN users u ON cm.student_id = u.id
      WHERE cm.class_id = $1 AND u.role = 'student'
      ORDER BY u.full_name ASC;
    `;
    const { rows } = await db.query(query, [parseInt(classId)]);

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("Error pada getClassMembers:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const addClassMembersMassive = async (req, res) => {
  // 🛠️ KOREKSI 1: Samakan dengan nama di router kamu (:class_id)
  const { classId } = req.params;
  const { student_ids } = req.body; // Menerima array ID siswa contoh: [12, 15, 23]

  if (!student_ids || !Array.isArray(student_ids) || student_ids.length === 0) {
    return res.status(400).json({ success: false, message: "Daftar ID siswa tidak valid!" });
  }

  try {
    // Jalankan database TRANSACTION agar aman jika terjadi interupsi di tengah jalan
    await db.query("BEGIN");

    // 🛠️ KOREKSI 2: Ambil nilai kapasitas (capacity) dinamis dari tabel classes untuk kelas ini
    const classInfoQuery = `SELECT capacity FROM classes WHERE id = $1`;
    const classInfoRes = await db.query(classInfoQuery, [parseInt(classId)]);
    
    if (classInfoRes.rows.length === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Ruang kelas tidak ditemukan." });
    }
    
    // Jika kolom capacity di DB kosong/null, kita beri fallback otomatis ke 36
    const maxCapacity = classInfoRes.rows[0].capacity || 36;

    // Validasi internal: Cek jumlah siswa yang saat ini sudah terdaftar di kelas tersebut
    const countQuery = `SELECT COUNT(*) FROM class_members WHERE class_id = $1`;
    const countRes = await db.query(countQuery, [parseInt(classId)]);
    const currentTotal = parseInt(countRes.rows[0].count);

    // 🛠️ KOREKSI 3: Bandingkan dengan maxCapacity hasil query database, bukan angka 36 lagi
    if (currentTotal + student_ids.length > maxCapacity) {
      await db.query("ROLLBACK");
      return res.status(400).json({ 
        success: false, 
        message: `Kapasitas kelas overload! Kuota tersisa hanya untuk ${maxCapacity - currentTotal} siswa.` 
      });
    }

    // Lakukan looping pembentukan query bulk insert secara dinamis
    const values = [];
    const valueStrings = [];
    let paramIndex = 1;

    student_ids.forEach((studentId) => {
      valueStrings.push(`($${paramIndex}, $${paramIndex + 1})`);
      values.push(parseInt(classId), parseInt(studentId));
      paramIndex += 2;
    });

    const insertQuery = `
      INSERT INTO class_members (class_id, student_id) 
      VALUES ${valueStrings.join(", ")}
      ON CONFLICT (class_id, student_id) DO NOTHING; -- Mencegah error jika data duplikat tidak sengaja terkirim
    `;

    await db.query(insertQuery, values);
    
    // Commit seluruh rangkaian data jika validasi terpenuhi semua
    await db.query("COMMIT");

    return res.status(200).json({ 
      success: true, 
      message: `Berhasil memploting ${student_ids.length} siswa ke dalam kelas.` 
    });

  } catch (error) {
    // Batalkan seluruh antrean data jika salah satu baris query gagal dieksekusi
    await db.query("ROLLBACK");
    console.error("Error pada addClassMembersMassive:", error);
    return res.status(500).json({ success: false, message: "Gagal menyimpan data plotting siswa." });
  }
};

/**
 * @desc    4. DELETE SISWA DARI KELAS (KICK / RESET PLOTTING)
 * @route   DELETE /api/admin/classes/:classId/members/:studentId
 */
const removeClassMember = async (req, res) => {
  const { classId, studentId } = req.params;

  try {
    const query = `
      DELETE FROM class_members 
      WHERE class_id = $1 AND student_id = $2
      RETURNING *;
    `;
    const { rows } = await db.query(query, [parseInt(classId), parseInt(studentId)]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Hubungan data siswa dan kelas tidak ditemukan" });
    }

    return res.status(200).json({ success: true, message: "Siswa berhasil dikeluarkan dari ruang kelas" });
  } catch (error) {
    console.error("Error pada removeClassMember:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Pastikan dieksport di baris paling bawah file!
module.exports = {
  getClasses,
  addClass,
  assignStudentsToClass,
  updateClass, 
  deleteClass, 
  getAvailableTeacherForHomeroom,
  getAvailableStudentsForClassPlotting,
  getClassDetail,
  getClassMembers,
  addClassMembersMassive,
  removeClassMember
};