const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const fileUpload = require('express-fileupload');
const { verifyToken, isAdmin, isAdminOrTeacher } = require("../src/middlewares/authMiddleware");

// =========================================================
// 1. ROUTES: USER MANAGEMENT (TETAP AMAN)
// =========================================================
router.get('/users', verifyToken, isAdmin,  adminController.getUsers);
router.post('/users', verifyToken, isAdmin,  adminController.createUser);
router.put('/users/:id', verifyToken, isAdmin,  adminController.updateUser);
router.post('/users/import', verifyToken, isAdmin,  fileUpload(), adminController.importUsersExcel);
router.delete('/users/:id', verifyToken, isAdmin,  adminController.deleteUser);

// =========================================================
// 2. ROUTES: ROOM MANAGEMENT (TETAP AMAN)
// =========================================================
router.get('/rooms', verifyToken, isAdmin,  adminController.getRooms);
router.post('/rooms', verifyToken, isAdmin,  adminController.createRoom);
router.post('/rooms/import', verifyToken, isAdmin, fileUpload(), adminController.importRoomsExcel);

// =========================================================
// 3. ROUTES: ACADEMIC YEARS (TETAP AMAN)
// =========================================================
router.get('/academic-years', verifyToken, isAdminOrTeacher,  adminController.getAcademicYears);
router.post('/academic-years', verifyToken, isAdmin,  adminController.createAcademicYear);
router.patch('/academic-years/activate/:id', verifyToken, isAdmin,  adminController.activateSemester);

// =========================================================
// 4. ROUTES: SUBJECTS (MAPEL) (TETAP AMAN)
// =========================================================
router.get('/subjects', verifyToken, isAdmin,  adminController.getSubjects);
router.post('/subjects', verifyToken, isAdmin,  adminController.createSubject);
router.patch('/users/:id/toggle-status', verifyToken, isAdmin,  adminController.toggleUserStatus);

router.put('/subjects/:id', verifyToken, isAdmin,  adminController.updateSubject); 
router.patch('/subjects/:id/toggle', verifyToken, isAdmin,  adminController.toggleSubjectStatus);



// =========================================================
// 🔄 5. SINKRONISASI JADWAL & KELAS (DISESUAIKAN KE FRONTEND)
// =========================================================

// Tambahkan rute master kelas ini jika belum ada di file lain, untuk dropdown frontend
router.get('/classes', verifyToken, isAdmin,  adminController.getClasses); 

// Route untuk Plotting Mapel & Pengajar Kelas
// UBAH: Sesuaikan parameter :classId menjadi :class_id agar serasi dengan req.params backend
router.get('/classes/:class_id/subjects', verifyToken, isAdmin,  adminController.getClassSubjects);
router.post('/class-subjects', verifyToken, isAdmin,  adminController.assignClassSubject);
router.delete('/class-subjects/:id', verifyToken, isAdmin,  adminController.removeClassSubject);

// Route untuk Kalender Jadwal Jam Pelajaran
// UBAH: Ubah adminController.getClassSchedules menjadi adminController.getSchedulesByClass 
// dan sesuaikan parameter jadi :class_id
router.get('/classes/:class_id/schedules', verifyToken, isAdmin,  adminController.getSchedulesByClass);
router.post('/schedules', verifyToken, isAdmin,  adminController.createSchedule);
router.delete('/schedules/:id', verifyToken, isAdmin,  adminController.deleteSchedule);

// Route untuk Kerangka Slot Acuan Waktu Global
// UBAH: Arahkan fungsi ke nama yang dipanggil Frontend: /time-slots
router.get('/time-slots', verifyToken, isAdminOrTeacher,  adminController.getGlobalTimeSlots);
router.post('/time-slots', verifyToken, isAdmin,  adminController.createGlobalTimeSlot);
router.delete('/time-slots/:id', verifyToken, isAdmin,  adminController.deleteGlobalTimeSlot);

router.get('/day-settings', verifyToken, isAdminOrTeacher,  adminController.getDaySettings); // Route untuk mengambil pengaturan hari sekolah
router.put('/day-settings', verifyToken, isAdmin,  adminController.updateDaySettings); // Route untuk update pengaturan hari sekolah

router.get('/classes/global/subjects', verifyToken, isAdmin,  adminController.getClassSubjects);

// ==========================================
// 2. ROUTE UNTUK MANAJEMEN JADWAL 
// ==========================================
// Mengambil seluruh jadwal untuk kalkulasi total beban mengajar guru di panel kiri
router.get('/classes/global/schedules', verifyToken, isAdmin,  adminController.getClassSchedules);

router.get('/settings/kkm', verifyToken, isAdmin,  adminController.getGlobalKkm);
router.put('/settings/kkm', verifyToken, isAdmin,  adminController.updateGlobalKkm);

// Mengambil jadwal spesifik untuk kalender kelas di panel kanan
//router.get('/classes/:classId/schedules', adminController.getClassSchedules);

// ==========================================
// 3. ROUTE KHUSUS SISTEM & PEMELIHARAAN (TELEMETRI & BACKUP)
// ==========================================
router.get('/system/telemetry', verifyToken, isAdmin,  adminController.getSystemTelemetry);
router.get('/system/backup', verifyToken, isAdmin,  adminController.getSystemBackup);

router.delete('/maintenance/academic-year', verifyToken, isAdmin,  adminController.deleteByAcademicYear);
router.delete('/maintenance/users', verifyToken, isAdmin,  adminController.deleteUsersByRoleAndDate);

router.get('/settings/app', verifyToken, isAdmin,  adminController.getAppSettings);
router.put('/settings/app', verifyToken, isAdmin,  adminController.updateAppSettings);


module.exports = router;