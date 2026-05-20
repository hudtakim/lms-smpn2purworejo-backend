// src/controllers/AcademicYearController.js
const db = require("../config/db"); // Koneksi database pool kamu

/**
 * 1. GET: Ambil semua data tahun ajaran (Urutan ID terbaru paling atas)
 */
const getAcademicYears = async (req, res) => {
  try {
    const query = `
      SELECT id, year_name, semester, is_active 
      FROM academic_years 
      ORDER BY id DESC;
    `;
    const { rows } = await db.query(query);

    return res.status(200).json({
      success: true,
      message: "Daftar tahun ajaran berhasil dimuat",
      data: rows
    });
  } catch (error) {
    console.error("Error getAcademicYears:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Internal server error saat mengambil data tahun ajaran" 
    });
  }
};

/**
 * 2. POST: Tambah data Tahun Ajaran baru (Default is_active: false)
 */
const createAcademicYear = async (req, res) => {
  const { year_name, semester } = req.body;

  if (!year_name || !semester) {
    return res.status(400).json({ success: false, message: "Tahun ajaran dan semester wajib diisi" });
  }

  try {
    // Validasi duplikasi data agar kombinasi tahun & semester unik
    const checkDuplicate = await db.query(
      "SELECT id FROM academic_years WHERE year_name = $1 AND semester = $2",
      [year_name, semester]
    );

    if (checkDuplicate.rowCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Gagal! Sesi ${year_name} - ${semester} sudah terdaftar.`
      });
    }

    const query = `
      INSERT INTO academic_years (year_name, semester, is_active)
      VALUES ($1, $2, false)
      RETURNING *;
    `;
    const { rows } = await db.query(query, [year_name, semester]);

    return res.status(201).json({
      success: true,
      message: "Tahun ajaran baru berhasil disimpan",
      data: rows[0]
    });
  } catch (error) {
    console.error("Error createAcademicYear:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * 3. PATCH/PUT: Aktivasi Sesi Utama (Metode Sinkron Transaksi)
 * Saat satu baris bernilai TRUE, baris yang lain otomatis diset menjadi FALSE
 */
const toggleActivePeriod = async (req, res) => {
  const { id } = req.params;

  try {
    // Jalankan sistem transaksi PostgreSQL agar perubahan aman & sinkron
    await db.query("BEGIN");

    // Langkah A: Matikan status aktif di seluruh data
    await db.query("UPDATE academic_years SET is_active = false");

    // Langkah B: Hidupkan status aktif di baris ID terpilih
    const updateQuery = `
      UPDATE academic_years 
      SET is_active = true 
      WHERE id = $1 
      RETURNING *;
    `;
    const { rows, rowCount } = await db.query(updateQuery, [id]);

    if (rowCount === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Tahun ajaran tidak ditemukan" });
    }

    await db.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Sesi ${rows[0].year_name} (${rows[0].semester}) kini aktif digunakan sistem`,
      data: rows[0]
    });
  } catch (error) {
    await db.query("ROLLBACK");
    console.error("Error toggleActivePeriod:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * 4. DELETE: Hapus Sesi Akademik Berdasar Aturan Integritas
 */
const deleteAcademicYear = async (req, res) => {
  const { id } = req.params;

  try {
    // Validasi 1: Sesi aktif berjalan tidak boleh dihapus mendadak
    const statusCheck = await db.query("SELECT is_active FROM academic_years WHERE id = $1", [id]);
    if (statusCheck.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Data tidak ditemukan" });
    }
    if (statusCheck.rows[0].is_active === true) {
      return res.status(400).json({
        success: false,
        message: "Gagal! Sesi aktif utama tidak bisa dihapus."
      });
    }

    // Validasi 2: Cek relasi tabel classes, jika data sudah terpakai tidak boleh dihapus
    const classCheck = await db.query("SELECT COUNT(*) FROM classes WHERE academic_year_id = $1", [id]);
    if (parseInt(classCheck.rows[0].count) > 0) {
      return res.status(400).json({
        success: false,
        message: "Gagal menghapus! Periode akademik ini sudah terpakai di manajemen unit kelas."
      });
    }

    await db.query("DELETE FROM academic_years WHERE id = $1", [id]);

    return res.status(200).json({
      success: true,
      message: "Periode akademik berhasil dihapus"
    });
  } catch (error) {
    console.error("Error deleteAcademicYear:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

module.exports = {
  getAcademicYears,
  createAcademicYear,
  toggleActivePeriod,
  deleteAcademicYear
};