// routes/teacherRoutes.js
const express = require("express");
const router = express.Router();
const teacherController = require("../controllers/teacherController");
const { verifyToken } = require("../src/middlewares/authMiddleware");
const upload = require("../src/middlewares/upload");

// Jalur GET untuk jadwal mengajar guru (Diproteksi Token)
router.get("/my-schedule", verifyToken, teacherController.getTeacherSchedule);
router.get("/my-classes", verifyToken, teacherController.getTeacherClasses);

// A. Ambil Siswa Berdasarkan Kelas (Untuk Tab Overview)
router.get('/kelas/:classId/overview/', verifyToken, teacherController.getClassOverview);

// B. Modul Materi (Get & Post)
router.get('/kelas/:classId/materials/:subjectId', verifyToken, teacherController.getClassMaterials);

// C. Modul Tugas (Get & Post)
router.get('/kelas/:classId/tasks/:subjectId', verifyToken, teacherController.getClassTasks);

// D. Modul Jurnal Mengajar (Get & Post)
router.get('/kelas/:classId/journals/:subjectId', verifyToken, teacherController.getClassJournals);

router.post('/kelas/:classId/journals/:subjectId', verifyToken, teacherController.createClassJournal);

router.post('/kelas/:classId/materials/:subjectId', verifyToken, upload.single('file'), teacherController.createClassMaterial);

router.post('/kelas/:classId/tasks/:subjectId', verifyToken, upload.single('file'), teacherController.createClassTask);

// Tambahkan baris ini di bawah rute POST masing-masing
router.put('/kelas/:classId/materials/:id', verifyToken, upload.single('file'), teacherController.updateClassMaterial);

router.put('/kelas/:classId/tasks/:id', verifyToken, upload.single('file'), teacherController.updateClassTask);

// Jurnal tidak butuh upload.single karena hanya teks
router.put('/kelas/:classId/journals/:id', verifyToken, teacherController.updateClassJournal);

router.delete('/kelas/:classId/materials/:id', verifyToken, teacherController.deleteClassMaterial);
router.delete('/kelas/:classId/tasks/:id', verifyToken, teacherController.deleteClassTask);
router.delete('/kelas/:classId/journals/:id', verifyToken, teacherController.deleteClassJournal);

// --- PROSES MATA PELAJARAN ---
router.get('/active-subjects', verifyToken, teacherController.getActiveSubjects);

// --- MODUL PERANGKAT PEMBELAJARAN ---
router.get('/teaching-documents', verifyToken, teacherController.getTeachingDocuments);
router.post('/teaching-documents', verifyToken, upload.single('file'), teacherController.createTeachingDocument);
router.put('/teaching-documents/:id', verifyToken, upload.single('file'), teacherController.updateTeachingDocument);
router.delete('/teaching-documents/:id', verifyToken, teacherController.deleteTeachingDocument);

// --- MODUL ULANGAN / QUIZ ---
router.get('/kelas/:classId/quizzes/:subjectId', verifyToken, teacherController.getClassQuizzes);
router.post('/kelas/:classId/quizzes/:subjectId', verifyToken, teacherController.createClassQuiz);
router.put('/kelas/:classId/quizzes/:id', verifyToken, teacherController.updateClassQuiz);
router.delete('/kelas/:classId/quizzes/:id', verifyToken, teacherController.deleteClassQuiz);

// Rute untuk Nilai Ulangan & Import Excel
router.get('/kelas/:classId/quizzes/:id/scores', verifyToken, teacherController.getQuizScores);
router.post("/kelas/:classId/quizzes/:id/scores-manual", verifyToken, teacherController.updateQuizScore);
router.post('/kelas/:classId/quizzes/:id/import-scores', verifyToken, upload.single('file'), teacherController.importQuizScores);


// GANTI & TAMBAHKAN KODE INI DI BAGIAN BAWAH teacherRoutes.js:

router.get('/kelas/:classId/tasks/:id/scores', verifyToken, teacherController.getTaskScores);
router.post('/kelas/:classId/tasks/:id/scores', verifyToken, teacherController.updateTaskScore);

// GET Rekap Nilai Matrix (Frontend table)
router.get('/kelas/:classId/gradebook/:subjectId', verifyToken, teacherController.getGradebookMatrix);

// GET Ekspor Rekap Nilai ke XLSX
router.get('/kelas/:classId/gradebook/:subjectId/export', verifyToken, teacherController.exportGradebookExcel);

module.exports = router;