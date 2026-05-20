const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// =========================================================
// 1. ROUTES: USER MANAGEMENT (TETAP AMAN)
// =========================================================
router.get('/users', adminController.getUsers);
router.post('/users', adminController.createUser);
router.put('/users/:id', adminController.updateUser);
router.post('/users/import', adminController.importUsersExcel);
router.delete('/users/:id', adminController.deleteUser);

// =========================================================
// 2. ROUTES: ROOM MANAGEMENT (TETAP AMAN)
// =========================================================
router.get('/rooms', adminController.getRooms);
router.post('/rooms', adminController.createRoom);
router.post('/rooms/import', adminController.importRoomsExcel);

// =========================================================
// 3. ROUTES: ACADEMIC YEARS (TETAP AMAN)
// =========================================================
router.get('/academic-years', adminController.getAcademicYears);
router.post('/academic-years', adminController.createAcademicYear);
router.patch('/academic-years/activate/:id', adminController.activateSemester);

// =========================================================
// 4. ROUTES: SUBJECTS (MAPEL) (TETAP AMAN)
// =========================================================
router.get('/subjects', adminController.getSubjects);
router.post('/subjects', adminController.createSubject);
router.patch('/users/:id/toggle-status', adminController.toggleUserStatus);

router.put('/subjects/:id', adminController.updateSubject); 
router.patch('/subjects/:id/toggle', adminController.toggleSubjectStatus);



// =========================================================
// 🔄 5. SINKRONISASI JADWAL & KELAS (DISESUAIKAN KE FRONTEND)
// =========================================================

// Tambahkan rute master kelas ini jika belum ada di file lain, untuk dropdown frontend
router.get('/classes', adminController.getClasses); 

// Route untuk Plotting Mapel & Pengajar Kelas
// UBAH: Sesuaikan parameter :classId menjadi :class_id agar serasi dengan req.params backend
router.get('/classes/:class_id/subjects', adminController.getClassSubjects);
router.post('/class-subjects', adminController.assignClassSubject);
router.delete('/class-subjects/:id', adminController.removeClassSubject);

// Route untuk Kalender Jadwal Jam Pelajaran
// UBAH: Ubah adminController.getClassSchedules menjadi adminController.getSchedulesByClass 
// dan sesuaikan parameter jadi :class_id
router.get('/classes/:class_id/schedules', adminController.getSchedulesByClass);
router.post('/schedules', adminController.createSchedule);
router.delete('/schedules/:id', adminController.deleteSchedule);

// Route untuk Kerangka Slot Acuan Waktu Global
// UBAH: Arahkan fungsi ke nama yang dipanggil Frontend: /time-slots
router.get('/time-slots', adminController.getGlobalTimeSlots);
router.post('/time-slots', adminController.createGlobalTimeSlot);
router.delete('/time-slots/:id', adminController.deleteGlobalTimeSlot);

module.exports = router;