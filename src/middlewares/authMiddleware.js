// src/middlewares/authMiddleware.js
const jwt = require("jsonwebtoken");
const db = require("../../config/db"); // Koneksi database pool kamu
const { getMaintenanceStatus } = require("../../controllers/globalController");

/**
 * Middleware untuk memvalidasi apakah user sudah login (punya token valid)
 */
const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Mengambil string setelah 'Bearer'
  
  if (!token) {
    return res.status(401).json({ success: false, message: "Akses ditolak, token tidak ditemukan" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Menyimpan data user hasil decode (id, role, dll) ke dalam objek req
    next();
  } catch (error) {
    return res.status(403).json({ success: false, message: "Token tidak valid atau kadaluwarsa" });
  }
};

/**
 * Middleware untuk memastikan hanya user dengan role 'admin' yang bisa lewat
 */
const isAdmin = (req, res, next) => {
  // Pastikan verifyToken sudah dijalankan sebelumnya agar req.user tersedia
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ 
      success: false, 
      message: "Akses terbatas! Hanya Administrator yang diizinkan." 
    });
  }
  next();
};

const isTeacher = (req, res, next) => {
  // Pastikan verifyToken sudah dijalankan sebelumnya agar req.user tersedia
  if (!req.user || req.user.role !== "teacher") {
    return res.status(403).json({ 
      success: false, 
      message: "Akses terbatas! Hanya Guru yang diizinkan." 
    });
  }
  next();
};

const isStudent = (req, res, next) => {
  // Pastikan verifyToken sudah dijalankan sebelumnya agar req.user tersedia
  if (!req.user || req.user.role !== "student") {
    return res.status(403).json({ 
      success: false, 
      message: "Akses terbatas! Hanya Siswa yang diizinkan." 
    });
  }
  next();
};

const isSupervisor = (req, res, next) => {
  // Pastikan verifyToken sudah dijalankan sebelumnya agar req.user tersedia
  if (!req.user || req.user.role !== "supervisor") {
    return res.status(403).json({ 
      success: false, 
      message: "Akses terbatas! Hanya Supervisor yang diizinkan." 
    });
  }
  next();
};

const isAdminOrTeacher = (req, res, next) => {
  // Pastikan verifyToken sudah dijalankan sebelumnya agar req.user tersedia
  if (!req.user || !(req.user.role === "admin" || req.user.role === "teacher")) {
    return res.status(403).json({ 
      success: false, 
      message: "Akses terbatas! Hanya Admin dan Guru yang diizinkan." 
    });
  }
  next();
};

const isAdminOrTeacherOrSupervisor = (req, res, next) => {
  // Pastikan verifyToken sudah dijalankan sebelumnya agar req.user tersedia
  if (!req.user || !(req.user.role === "admin" || req.user.role === "teacher" || req.user.role === "supervisor")) {
    return res.status(403).json({ 
      success: false, 
      message: "Akses terbatas! Hanya Admin, Guru, dan Pengawas yang diizinkan." 
    });
  }
  next();
};

module.exports = {
  verifyToken,
  isAdmin,
  isTeacher,
  isStudent,
  isAdminOrTeacher,
  isSupervisor,
  isAdminOrTeacherOrSupervisor
};