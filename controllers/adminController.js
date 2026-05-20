// controllers/adminController.js
const db = require('../config/db');
const bcrypt = require('bcrypt');
const XLSX = require('xlsx');

const saltRounds = 10;

const adminController = {
    // =========================================================
    // 1. MANAJEMEN USER (GURU, SISWA, KURIKULUM, DLL)
    // =========================================================
    
    getUsers: async (req, res) => {
        const { role, search, page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;
        try {
            let query = 'SELECT id, username, full_name, role, is_active FROM users WHERE 1=1';
            let params = [];
            if (role && role !== 'all') { params.push(role); query += ` AND role = $${params.length}`; }
            if (search) { params.push(`%${search}%`); query += ` AND (full_name ILIKE $${params.length} OR username ILIKE $${params.length})`; }

            const totalRes = await db.query(query, params);
            params.push(limit, offset);
            query += ` ORDER BY full_name ASC LIMIT $${params.length - 1} OFFSET $${params.length}`;
            const rowsRes = await db.query(query, params);

            res.json({ data: rowsRes.rows, total: totalRes.rowCount, pages: Math.ceil(totalRes.rowCount / limit) });
        } catch (err) { res.status(500).json({ error: err.message }); }
    },

    createUser: async (req, res) => {
        const { username, password, full_name, role } = req.body;
        try {
            const hashedPassword = await bcrypt.hash(password, saltRounds);
            const result = await db.query(
                'INSERT INTO users (username, password, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id, username, full_name, role',
                [username, hashedPassword, full_name, role]
            );
            res.status(201).json(result.rows[0]);
        } catch (err) { res.status(500).json({ error: "Gagal membuat user. Cek apakah username (NIP/NISN) sudah terdaftar." }); }
    },

    // Penamaan Spesifik: importUsersExcel
    importUsersExcel: async (req, res) => {
        try {
            if (!req.files || !req.files.file) return res.status(400).json({ error: "File Excel tidak ditemukan" });
            const workbook = XLSX.read(req.files.file.data, { type: 'buffer' });
            const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            for (let row of data) {
                const hashed = await bcrypt.hash(row.password.toString(), saltRounds);
                await db.query(
                    'INSERT INTO users (username, password, full_name, role) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING',
                    [row.username, hashed, row.full_name, row.role.toLowerCase()]
                );
            }
            res.json({ message: `Berhasil memproses ${data.length} data user.` });
        } catch (err) { res.status(500).json({ error: "Format file Excel tidak sesuai atau corrupt." }); }
    },

    deleteUser: async (req, res) => {
        try {
            await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
            res.json({ message: "User berhasil dihapus dari sistem." });
        } catch (err) { res.status(500).json({ error: "Tidak bisa menghapus user yang sudah memiliki riwayat data akademik." }); }
    },


    toggleUserStatus: async (req, res) => {
        const { id } = req.params;
        const { is_active } = req.body; // Menerima status baru (true/false) dari frontend

        try {
            // 1. Jalankan query UPDATE untuk mengubah status kolom is_active
            const result = await db.query(
            'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, username, is_active',
            [is_active, id]
            );

            // 2. Jika ID tidak ditemukan di database
            if (result.rows.length === 0) {
            return res.status(404).json({ error: "User tidak ditemukan." });
            }

            // 3. Kirim respon sukses balik ke frontend
            res.json({
            message: `Status user berhasil diubah menjadi ${is_active ? 'Aktif' : 'Nonaktif'}.`,
            user: result.rows[0]
            });

        } catch (err) {
            console.error("Error pada toggleUserStatus:", err);
            res.status(500).json({ error: "Terjadi kesalahan internal pada server." });
        }
    },

    // =========================================================
    // 2. MANAJEMEN RUANGAN (ROOMS)
    // =========================================================
    
    getRooms: async (req, res) => {
        try {
            const result = await db.query('SELECT * FROM rooms ORDER BY room_name ASC');
            res.json(result.rows);
        } catch (err) { res.status(500).json({ error: err.message }); }
    },

    createRoom: async (req, res) => {
        const { room_name, capacity, room_type } = req.body;
        try {
            const result = await db.query(
                'INSERT INTO rooms (room_name, capacity, room_type) VALUES ($1, $2, $3) RETURNING *',
                [room_name, capacity, room_type]
            );
            res.status(201).json(result.rows[0]);
        } catch (err) { res.status(500).json({ error: "Gagal menambah ruangan." }); }
    },

    // Penamaan Spesifik: importRoomsExcel (Jika kedepan butuh import ruangan masal)
    importRoomsExcel: async (req, res) => {
        try {
            if (!req.files || !req.files.file) return res.status(400).json({ error: "File Excel tidak ditemukan" });
            const workbook = XLSX.read(req.files.file.data, { type: 'buffer' });
            const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            for (let row of data) {
                await db.query(
                    'INSERT INTO rooms (room_name, capacity, room_type) VALUES ($1, $2, $3)',
                    [row.room_name, row.capacity, row.room_type]
                );
            }
            res.json({ message: `Berhasil mengimpor ${data.length} ruangan.` });
        } catch (err) { res.status(500).json({ error: "Gagal impor data ruangan." }); }
    },

    // =========================================================
    // 3. MANAJEMEN TAHUN AJARAN & SEMESTER
    // =========================================================
    
    getAcademicYears: async (req, res) => {
        try {
            const result = await db.query('SELECT * FROM academic_years ORDER BY id DESC');
            res.json(result.rows);
        } catch (err) { res.status(500).json({ error: err.message }); }
    },

    createAcademicYear: async (req, res) => {
        const { year_name, semester } = req.body;
        try {
            const result = await db.query(
                'INSERT INTO academic_years (year_name, semester) VALUES ($1, $2) RETURNING *',
                [year_name, semester]
            );
            res.status(201).json(result.rows[0]);
        } catch (err) { res.status(500).json({ error: "Gagal menambah tahun ajaran." }); }
    },

    activateSemester: async (req, res) => {
        const { id } = req.params;
        try {
            await db.query('BEGIN');
            await db.query('UPDATE academic_years SET is_active = false');
            await db.query('UPDATE academic_years SET is_active = true WHERE id = $1', [id]);
            await db.query('COMMIT');
            res.json({ message: "Semester aktif telah diperbarui." });
        } catch (err) {
            await db.query('ROLLBACK');
            res.status(500).json({ error: "Gagal mengganti semester aktif." });
        }
    },

    // =========================================================
    // 4. MANAJEMEN MATA PELAJARAN (SUBJECTS)
    // =========================================================
    
    getSubjects: async (req, res) => {
        try {
            const result = await db.query('SELECT * FROM subjects ORDER BY subject_name ASC');
            res.json(result.rows);
        } catch (err) { res.status(500).json({ error: err.message }); }
    },

    createSubject: async (req, res) => {
        const { subject_name, subject_code } = req.body;
        try {
            const result = await db.query(
                'INSERT INTO subjects (subject_name, subject_code) VALUES ($1, $2) RETURNING *',
                [subject_name, subject_code]
            );
            res.status(201).json(result.rows[0]);
        } catch (err) { res.status(500).json({ error: "Kode Mapel sudah terdaftar." }); }
    }


    
};

module.exports = adminController;