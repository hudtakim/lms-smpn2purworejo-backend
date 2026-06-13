// routes/teacherRoutes.js
const express = require("express");
const router = express.Router();
const teacherController = require("../controllers/teacherController");
const { verifyToken, isTeacher } = require("../src/middlewares/authMiddleware");
const upload = require("../src/middlewares/upload");

// Jalur GET untuk jadwal mengajar guru (Diproteksi Token)
router.get("/my-schedule", verifyToken, isTeacher, teacherController.getTeacherSchedule);
router.get("/my-classes", verifyToken, isTeacher, teacherController.getTeacherClasses);

// A. Ambil Siswa Berdasarkan Kelas (Untuk Tab Overview)
router.get('/kelas/:classId/overview/', verifyToken, isTeacher, teacherController.getClassOverview);

// B. Modul Materi (Get & Post)
router.get('/kelas/:classId/materials/:subjectId', verifyToken, isTeacher, teacherController.getClassMaterials);

// C. Modul Tugas (Get & Post)
router.get('/kelas/:classId/tasks/:subjectId', verifyToken, isTeacher, teacherController.getClassTasks);

// D. Modul Jurnal Mengajar (Get & Post)
router.get('/kelas/:classId/journals/:subjectId', verifyToken, isTeacher, teacherController.getClassJournals);

router.post('/kelas/:classId/journals/:subjectId', verifyToken, isTeacher, teacherController.createClassJournal);

router.post('/kelas/:classId/materials/:subjectId', verifyToken, isTeacher, upload.single('file'), teacherController.createClassMaterial);

router.post('/kelas/:classId/tasks/:subjectId', verifyToken, isTeacher, upload.single('file'), teacherController.createClassTask);

// Tambahkan baris ini di bawah rute POST masing-masing
router.put('/kelas/:classId/materials/:id', verifyToken, isTeacher, upload.single('file'), teacherController.updateClassMaterial);

router.put('/kelas/:classId/tasks/:id', verifyToken, isTeacher, upload.single('file'), teacherController.updateClassTask);

// Jurnal tidak butuh upload.single karena hanya teks
router.put('/kelas/:classId/journals/:id', verifyToken, isTeacher, teacherController.updateClassJournal);

router.delete('/kelas/:classId/materials/:id', verifyToken, isTeacher, teacherController.deleteClassMaterial);
router.delete('/kelas/:classId/tasks/:id', verifyToken, isTeacher, teacherController.deleteClassTask);
router.delete('/kelas/:classId/journals/:id', verifyToken, isTeacher, teacherController.deleteClassJournal);

// --- PROSES MATA PELAJARAN ---
router.get('/active-subjects', verifyToken, isTeacher, teacherController.getActiveSubjects);

// --- MODUL PERANGKAT PEMBELAJARAN ---
router.get('/teaching-documents', verifyToken, isTeacher, teacherController.getTeachingDocuments);
router.post('/teaching-documents', verifyToken, isTeacher, upload.single('file'), teacherController.createTeachingDocument);
router.put('/teaching-documents/:id', verifyToken, isTeacher, upload.single('file'), teacherController.updateTeachingDocument);
router.delete('/teaching-documents/:id', verifyToken, isTeacher, teacherController.deleteTeachingDocument);

// --- MODUL ULANGAN / QUIZ ---
router.get('/kelas/:classId/quizzes/:subjectId', verifyToken, isTeacher, teacherController.getClassQuizzes);
router.post('/kelas/:classId/quizzes/:subjectId', verifyToken, isTeacher, teacherController.createClassQuiz);
router.put('/kelas/:classId/quizzes/:id', verifyToken, isTeacher, teacherController.updateClassQuiz);
router.delete('/kelas/:classId/quizzes/:id', verifyToken, isTeacher, teacherController.deleteClassQuiz);

// Rute untuk Nilai Ulangan & Import Excel
router.get('/kelas/:classId/quizzes/:id/scores', verifyToken, isTeacher, teacherController.getQuizScores);
router.post("/kelas/:classId/quizzes/:id/scores-manual", verifyToken, isTeacher, teacherController.updateQuizScore);
router.post('/kelas/:classId/quizzes/:id/import-scores', verifyToken, isTeacher, upload.single('file'), teacherController.importQuizScores);


// GANTI & TAMBAHKAN KODE INI DI BAGIAN BAWAH teacherRoutes.js:

router.get('/kelas/:classId/tasks/:id/scores', verifyToken, isTeacher, teacherController.getTaskScores);
router.post('/kelas/:classId/tasks/:id/scores', verifyToken, isTeacher, teacherController.updateTaskScore);

// GET Rekap Nilai Matrix (Frontend table)
router.get('/kelas/:classId/gradebook/:subjectId', verifyToken, isTeacher, teacherController.getGradebookMatrix);

// GET Ekspor Rekap Nilai ke XLSX
router.get('/kelas/:classId/gradebook/:subjectId/export', verifyToken, isTeacher, teacherController.exportGradebookExcel);

router.get('/pending-gradings', verifyToken, isTeacher, teacherController.getPendingGradings);

router.get('/class-name', verifyToken, isTeacher, teacherController.getClassNameByClassId);

router.get('/upload-limit', verifyToken, isTeacher, teacherController.getUploadLimit);

module.exports = router;