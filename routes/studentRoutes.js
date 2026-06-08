// routes/studentRoutes.js
const express = require("express");
const router = express.Router();
const studentController = require("../controllers/studentController");
const { verifyToken } = require("../src/middlewares/authMiddleware");

router.get("/dashboard-meta", verifyToken, studentController.getDashboardMeta);

// Route untuk mengambil jadwal POV Siswa
router.get("/my-schedule", verifyToken, studentController.getMySchedule);

// Tambahkan 2 baris ini di file studentRoutes.js kamu
router.get("/my-subjects", verifyToken, studentController.getMySubjects);
router.get("/my-materials/:subjectId", verifyToken, studentController.getMyMaterials);

// GET Ringkasan mapel beserta jumlah tugas & tugas mendesaknya
router.get("/my-task-subjects", verifyToken, studentController.getMyTaskSubjects);

// GET Detail tugas per mapel beserta status pengerjaan siswa
router.get("/my-tasks/:subjectId", verifyToken, studentController.getMyTasks);

// Route untuk Kuis / Ulangan
router.get("/my-quiz-subjects", verifyToken, studentController.getMyQuizSubjects);
router.get("/my-quizzes/:subjectId", verifyToken, studentController.getMyQuizzes);

router.post("/submit-task/:taskId", verifyToken, studentController.submitTask);
//router.post("/submit-quiz/:quizId", verifyToken, studentController.submitQuiz);

router.get("/my-grades", verifyToken, studentController.getMyGrades);


module.exports = router;