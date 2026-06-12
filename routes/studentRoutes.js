// routes/studentRoutes.js
const express = require("express");
const router = express.Router();
const studentController = require("../controllers/studentController");
const { verifyToken, isStudent} = require("../src/middlewares/authMiddleware");

router.get("/dashboard-meta", verifyToken, isStudent, studentController.getDashboardMeta);

// Route untuk mengambil jadwal POV Siswa
router.get("/my-schedule", verifyToken, isStudent, studentController.getMySchedule);

// Tambahkan 2 baris ini di file studentRoutes.js kamu
router.get("/my-subjects", verifyToken, isStudent, studentController.getMySubjects);
router.get("/my-materials/:subjectId", verifyToken, isStudent, studentController.getMyMaterials);

// GET Ringkasan mapel beserta jumlah tugas & tugas mendesaknya
router.get("/my-task-subjects", verifyToken, isStudent, studentController.getMyTaskSubjects);

// GET Detail tugas per mapel beserta status pengerjaan siswa
router.get("/my-tasks/:subjectId", verifyToken, isStudent, studentController.getMyTasks);

// Route untuk Kuis / Ulangan
router.get("/my-quiz-subjects", verifyToken, isStudent, studentController.getMyQuizSubjects);
router.get("/my-quizzes/:subjectId", verifyToken, isStudent, studentController.getMyQuizzes);

router.post("/submit-task/:taskId", verifyToken, isStudent, studentController.submitTask);
//router.post("/submit-quiz/:quizId", verifyToken, isStudent, studentController.submitQuiz);

router.get("/my-grades", verifyToken, isStudent, studentController.getMyGrades);

router.get("/academic-years", verifyToken, isStudent, studentController.getAcademicYearStudent);


module.exports = router;