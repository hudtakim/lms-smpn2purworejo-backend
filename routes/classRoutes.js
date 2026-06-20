// src/routes/classRoutes.js
const express = require("express");
const router = express.Router();
// Tambahkan addClass di object destructuring import
const { getClasses, assignStudentsToClass, addClass, updateClass, deleteClass, 
    getAvailableTeacherForHomeroom, getAvailableStudentsForClassPlotting, getClassDetail, getClassMembers, addClassMembersMassive, removeClassMember,
    importClassesExcel, importClassMembersExcel
} = require("../controllers/classController");
const { verifyToken, isAdmin } = require("../src/middlewares/authMiddleware");
const upload = require("../src/middlewares/upload");


// Rute untuk mendapatkan daftar kelas

router.get("/available-homeroom-teacher", verifyToken, isAdmin, getAvailableTeacherForHomeroom);
router.get("/available-students", verifyToken, isAdmin, getAvailableStudentsForClassPlotting);
router.get("/:academic_year_id", verifyToken, getClasses);

// 🔥 Rute baru: Menambahkan kelas baru (Khusus Admin)
router.post("/", verifyToken, isAdmin, addClass);

router.put("/:id", verifyToken, isAdmin, updateClass);
router.delete("/:id", verifyToken, isAdmin, deleteClass);

// Rute untuk plotting siswa ke kelas
router.post("/:classId/assign-students", verifyToken, isAdmin, assignStudentsToClass);
router.get("/:classId/detail", verifyToken, isAdmin, getClassDetail);
router.get("/:classId/members", verifyToken, isAdmin, getClassMembers);
router.post("/:classId/members", verifyToken, isAdmin, addClassMembersMassive);
router.delete("/:classId/members/:studentId", verifyToken, isAdmin, removeClassMember);

router.post("/import", verifyToken, upload.single("file"), isAdmin, importClassesExcel);
router.post("/import-members", verifyToken, upload.single("file"), isAdmin, importClassMembersExcel);

module.exports = router;