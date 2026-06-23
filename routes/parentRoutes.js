// routes/parentRoutes.js
const express = require("express");
const router = express.Router();
const parentController = require("../controllers/parentController");
const { verifyToken, isParent } = require("../src/middlewares/authMiddleware");

// Mengambil daftar dropdown anak
router.get("/my-children", verifyToken, isParent, parentController.getMyChildren);

// Dashboard Meta, Nilai, dan Absensi (Membutuhkan ?student_id=X&academic_year_id=Y)
router.get("/dashboard-meta", verifyToken, isParent, parentController.getChildDashboardMeta);
router.get("/grades", verifyToken, isParent, parentController.getChildGrades);
router.get("/attendance", verifyToken, isParent, parentController.getChildAttendanceHistory);

module.exports = router;