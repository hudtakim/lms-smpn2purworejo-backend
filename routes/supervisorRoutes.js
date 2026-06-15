// src/routes/supervisorRoutes.js
const express = require('express');
const router = express.Router();
const supervisorController = require('../controllers/supervisorController');
const { verifyToken, isSupervisor } = require("../src/middlewares/authMiddleware");

// Hanya user yang login (nantinya bisa diamankan lebih ketat untuk role='supervisor')
router.get('/dashboard', verifyToken, isSupervisor, supervisorController.getDashboardMetrics);
// ROUTE BARU: Untuk halaman Performa Guru
router.get('/teacher-performance', verifyToken, isSupervisor, supervisorController.getTeacherPerformanceMetrics)
router.get('/teacher-detail-assets', verifyToken, isSupervisor, supervisorController.getTeacherDetailedAssets);
router.get('/student-stats', verifyToken, isSupervisor, supervisorController.getStudentStatistics);
// ROUTE BARU: Modul Rapor & Jejak Siswa
router.get('/student-list', verifyToken, isSupervisor, supervisorController.getStudentList);
router.get('/student-detail-performance', verifyToken, isSupervisor, supervisorController.getStudentDetailPerformance);


module.exports = router;