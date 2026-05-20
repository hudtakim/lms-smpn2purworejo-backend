// controllers/authController.js
const db = require('../config/db'); // Sesuaikan dengan path koneksi database Anda
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
  const { username, password } = req.body;

  try {
    // 1. Cari user berdasarkan username
    const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Username atau password salah." });
    }

    const user = result.rows[0];

    // 2. CEK STATUS: Jika nonaktif, blokir login langsung di sini
    if (user.is_active === false) {
      return res.status(403).json({ error: "Akun Anda dinonaktifkan. Silakan hubungi Admin." });
    }

    // 3. Cek Password (membandingkan password input dengan hash di DB)
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
      return res.status(401).json({ error: "Username atau password salah." });
    }

    // 4. BUAT SESSION 1 JAM: Generate JWT Token
    // Pastikan Anda sudah menulis JWT_SECRET="bebas_apa_aja" di file .env
    const token = jwt.sign(
      { id: user.id, role: user.role, name: user.full_name },
      process.env.JWT_SECRET || 'rahasia_spero_lms', 
      { expiresIn: '1h' } // Sesi hangus tepat dalam 1 jam
    );

    // 5. Kirim data sukses ke frontend
    res.json({
      message: "Login berhasil!",
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
};