const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// =========================================================
// 1. ROUTES: USER MANAGEMENT
// =========================================================

// Get users dengan filter & pagination (GET /api/admin/users?role=student&search=budi)
router.get('/users', adminController.getUsers);

// Tambah user manual (POST /api/admin/users)
router.post('/users', adminController.createUser);

// Import user via Excel (POST /api/admin/users/import)
router.post('/users/import', adminController.importUsersExcel);

// Hapus user (DELETE /api/admin/users/:id)
router.delete('/users/:id', adminController.deleteUser);


// =========================================================
// 2. ROUTES: ROOM MANAGEMENT
// =========================================================

// Get semua ruangan (GET /api/admin/rooms)
router.get('/rooms', adminController.getRooms);

// Tambah ruangan manual (POST /api/admin/rooms)
router.post('/rooms', adminController.createRoom);

// Import ruangan via Excel (POST /api/admin/rooms/import)
router.post('/rooms/import', adminController.importRoomsExcel);

// Hapus ruangan (DELETE /api/admin/rooms/:id) - Optional jika butuh
// router.delete('/rooms/:id', adminController.deleteRoom);


// =========================================================
// 3. ROUTES: ACADEMIC YEARS
// =========================================================

// Get list tahun ajaran (GET /api/admin/academic-years)
router.get('/academic-years', adminController.getAcademicYears);

// Tambah tahun ajaran baru (POST /api/admin/academic-years)
router.post('/academic-years', adminController.createAcademicYear);

// Setel tahun ajaran/semester yang aktif (PATCH /api/admin/academic-years/activate/:id)
router.patch('/academic-years/activate/:id', adminController.activateSemester);


// =========================================================
// 4. ROUTES: SUBJECTS (MAPEL)
// =========================================================

// Get semua mata pelajaran (GET /api/admin/subjects)
router.get('/subjects', adminController.getSubjects);

// Tambah mata pelajaran (POST /api/admin/subjects)
router.post('/subjects', adminController.createSubject);

router.patch('/users/:id/toggle-status', adminController.toggleUserStatus);


module.exports = router;