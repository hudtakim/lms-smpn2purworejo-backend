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
            let query = 'SELECT id, username, full_name, role, is_active, gender, religion FROM users WHERE 1=1';
            let params = [];
            if (role && role !== 'all') { 
                params.push(role); 
                query += ` AND role = $${params.length}`; 
            }
            if (search) { 
                params.push(`%${search}%`); 
                query += ` AND (full_name ILIKE $${params.length} OR username ILIKE $${params.length})`; 
            }

            const totalRes = await db.query(query, params);
            
            params.push(limit, offset);
            query += ` ORDER BY full_name ASC LIMIT $${params.length - 1} OFFSET $${params.length}`;
            
            const rowsRes = await db.query(query, params);

            res.json({ 
                data: rowsRes.rows, 
                total: totalRes.rowCount, 
                pages: Math.ceil(totalRes.rowCount / limit) 
            });
        } catch (err) { 
            res.status(500).json({ error: err.message }); 
        }
    },

    createUser: async (req, res) => {
        const { username, password, full_name, role, gender, religion } = req.body;
        try {
            const hashedPassword = await bcrypt.hash(password, saltRounds);
            const result = await db.query(
                'INSERT INTO users (username, password, full_name, role, gender, religion, is_active) VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id, username, full_name, role, gender, religion',
                [username, hashedPassword, full_name, role, gender, religion]
            );
            res.status(201).json(result.rows[0]);
        } catch (err) { res.status(500).json({ error: err.message }); }
    },

    updateUser: async (req, res) => {
        const { id } = req.params;
        const { username, full_name, role, is_active, password, gender, religion } = req.body;
        try {
            let result;
            if (password) {
                const hashedPassword = await bcrypt.hash(password, saltRounds);
                result = await db.query(
                    'UPDATE users SET username = $1, full_name = $2, role = $3, is_active = $4, password = $5, gender = $6, religion = $7 WHERE id = $8 RETURNING id, username, full_name, role, is_active, gender, religion',
                    [username, full_name, role, is_active, hashedPassword, gender, religion, id]
                );
            } else {
                result = await db.query(
                    'UPDATE users SET username = $1, full_name = $2, role = $3, is_active = $4, gender = $5, religion = $6 WHERE id = $7 RETURNING id, username, full_name, role, is_active, gender, religion',
                    [username, full_name, role, is_active, gender, religion, id]
                );
            }
            res.json(result.rows[0]);
        } catch (err) { res.status(500).json({ error: err.message }); }
    },

    // Penamaan Spesifik: importUsersExcel
    importUsersExcel: async (req, res) => {
        try {
            if (!req.files || !req.files.file) return res.status(400).json({ error: "File Excel tidak ditemukan" });
            const workbook = XLSX.read(req.files.file.data, { type: 'buffer' });
            const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            for (let row of data) {
                // Memetakan mapping nama kolom Excel (antisipasi huruf kapital / spasi dari template)
                const username = row.username || row['Username'];
                const rawPassword = row.password || row['Password'];
                const full_name = row.full_name || row['Nama Lengkap'];
                const role = row.role || row['Role'];
                const gender = row.gender || row['Gender'] || null;
                const religion = row.religion || row['Agama'] || null;

                // Validasi data baris kosong
                if (!username || !rawPassword || !full_name || !role) continue;

                const hashed = await bcrypt.hash(rawPassword.toString(), saltRounds);
                
                // Tambahkan kolom gender dan religion ke query database agar tidak null/kosong
                await db.query(
                    'INSERT INTO users (username, password, full_name, role, gender, religion) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (username) DO NOTHING',
                    [username.toString().trim(), hashed, full_name, role.toLowerCase().trim(), gender, religion ? religion.toLowerCase().trim() : null]
                );
            }
            res.json({ message: `Berhasil memproses ${data.length} data user.` });
        } catch (err) {
            console.error("Error Import Excel Backend:", err);
            res.status(500).json({ error: "Format file Excel tidak sesuai atau terjadi kesalahan database." });
        }
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
        return res.status(200).json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error" });
    }
    },

    createSubject: async (req, res) => {
        const { subject_code, subject_name } = req.body;
        if (!subject_code || !subject_name) {
            return res.status(400).json({ error: "Kode dan Nama Mata Pelajaran wajib diisi!" });
        }
        try {
            const checkDuplicate = await db.query('SELECT id FROM subjects WHERE UPPER(subject_code) = $1', [subject_code.toUpperCase().trim()]);
            if (checkDuplicate.rows.length > 0) {
            return res.status(400).json({ error: "Kode mata pelajaran sudah digunakan!" });
            }

            const result = await db.query(
            'INSERT INTO subjects (subject_code, subject_name, is_active) VALUES ($1, $2, TRUE) RETURNING *',
            [subject_code.toUpperCase().trim(), subject_name.trim()]
            );
            return res.status(201).json(result.rows[0]);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: "Internal server error" });
        }
    },

    updateSubject: async (req, res) => {
        const { id } = req.params;
        const { subject_code, subject_name } = req.body;
        try {
            // Validasi duplikasi kode dengan ID lain
            const checkDuplicate = await db.query(
            'SELECT id FROM subjects WHERE UPPER(subject_code) = $1 AND id != $2', 
            [subject_code.toUpperCase().trim(), id]
            );
            if (checkDuplicate.rows.length > 0) {
            return res.status(400).json({ error: "Kode mata pelajaran sudah digunakan oleh mapel lain!" });
            }

            const result = await db.query(
            'UPDATE subjects SET subject_code = $1, subject_name = $2 WHERE id = $3 RETURNING *',
            [subject_code.toUpperCase().trim(), subject_name.trim(), id]
            );
            if (result.rows.length === 0) return res.status(404).json({ error: "Mata pelajaran tidak ditemukan" });
            return res.status(200).json(result.rows[0]);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: "Internal server error" });
        }
    },

    // 4. Toggle Status Aktif (Soft delete / penonaktifan agar histori nilai aman)
    toggleSubjectStatus: async (req, res) => {
        const { id } = req.params;
        try {
            const current = await db.query('SELECT is_active FROM subjects WHERE id = $1', [id]);
            if (current.rows.length === 0) return res.status(404).json({ error: "Mata pelajaran tidak ditemukan" });
            
            const newStatus = !current.rows[0].is_active;
            await db.query('UPDATE subjects SET is_active = $1 WHERE id = $2', [newStatus, id]);
            
            return res.status(200).json({ 
            success: true, 
            message: `Mata pelajaran berhasil ${newStatus ? 'diaktifkan' : 'dinonaktifkan'}` 
            });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: "Internal server error" });
        }
    },
// =========================================================
    // 5. PLOTTING MAPEL & GURU KE KELAS (class_subjects)
    // =========================================================

    // Mengambil semua daftar mapel + guru pengampu di kelas tertentu berdasarkan semester aktif
    getClassSubjects: async (req, res) => {
        const { classId } = req.params;
        const { academic_year_id } = req.query; // Wajib dikirim dari frontend biar ganjil/genap pisah

        if (!academic_year_id) {
            return res.status(400).json({ error: "Academic year ID (semester) wajib disertakan." });
        }

        try {
            const query = `
                SELECT 
                    cs.id,
                    cs.class_id,
                    cs.subject_id,
                    cs.teacher_id,
                    cs.academic_year_id,
                    s.subject_name,
                    s.subject_code,
                    u.full_name as teacher_name
                FROM class_subjects cs
                JOIN subjects s ON cs.subject_id = s.id
                JOIN users u ON cs.teacher_id = u.id
                WHERE cs.class_id = $1 AND cs.academic_year_id = $2
                ORDER BY s.subject_name ASC
            `;
            const result = await db.query(query, [classId, academic_year_id]);
            res.json(result.rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    },

    // Aksi plotting guru mengajar mapel apa di kelas mana pada semester tertentu
    assignClassSubject: async (req, res) => {
        const { class_id, subject_id, teacher_id, academic_year_id } = req.body;
        
        if (!class_id || !subject_id || !teacher_id || !academic_year_id) {
            return res.status(400).json({ error: "Semua field data plotting wajib diisi." });
        }

        try {
            // Validasi apakah guru yang diplot benar-benar memiliki role 'teacher' atau 'curriculum'
            const checkTeacher = await db.query('SELECT role FROM users WHERE id = $1', [teacher_id]);
            if (checkTeacher.rows.length === 0 || checkTeacher.rows[0].role === 'student') {
                return res.status(400).json({ error: "User yang dipilih harus merupakan seorang Guru/Pengajar." });
            }

            const query = `
                INSERT INTO class_subjects (class_id, subject_id, teacher_id, academic_year_id)
                VALUES ($1, $2, $3, $4)
                RETURNING *
            `;
            const result = await db.query(query, [class_id, subject_id, teacher_id, academic_year_id]);
            res.status(201).json({ message: "Mata pelajaran dan pengajar berhasil diplot ke kelas ini.", data: result.rows[0] });
        } catch (err) {
            console.error(err);
            if (err.code === '23505') { // Code error PG untuk unique constraint violation
                return res.status(400).json({ error: "Mata pelajaran ini sudah diplot di kelas ini untuk semester yang sama!" });
            }
            res.status(500).json({ error: "Gagal menyimpan data plotting pengajar." });
        }
    },

    // Menghapus plotting mapel di kelas (otomatis menghapus jadwal terkait karena CASCADE)
    removeClassSubject: async (req, res) => {
        const { id } = req.params;
        try {
            await db.query('DELETE FROM class_subjects WHERE id = $1', [id]);
            res.json({ message: "Plotting mata pelajaran berhasil dihapus dari kelas." });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    },

    // =========================================================
    // 6. MANAJEMEN JADWAL PELAJARAN (schedules)
    // =========================================================

    // Mengambil jadwal pelajaran harian untuk satu kelas berdasarkan semester aktif
    getClassSchedules: async (req, res) => {
        const { classId } = req.params;
        const { academic_year_id } = req.query;

        if (!academic_year_id) {
            return res.status(400).json({ error: "Academic year ID wajib disertakan." });
        }

        try {
            const query = `
                SELECT 
                    sch.id as schedule_id,
                    sch.day_of_week,
                    sch.start_time,
                    sch.end_time,
                    cs.id as class_subject_id,
                    s.subject_name,
                    s.subject_code,
                    u.full_name as teacher_name
                FROM schedules sch
                JOIN class_subjects cs ON sch.class_subject_id = cs.id
                JOIN subjects s ON cs.subject_id = s.id
                JOIN users u ON cs.teacher_id = u.id
                WHERE cs.class_id = $1 AND cs.academic_year_id = $2
                ORDER BY 
                    CASE sch.day_of_week
                        WHEN 'Senin' THEN 1
                        WHEN 'Selasa' THEN 2
                        WHEN 'Rabu' THEN 3
                        WHEN 'Kamis' THEN 4
                        WHEN 'Jumat' THEN 5
                        WHEN 'Sabtu' THEN 6
                        ELSE 7
                    END, sch.start_time ASC
            `;
            const result = await db.query(query, [classId, academic_year_id]);
            res.json(result.rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    },

    createSchedule: async (req, res) => {
        // 🌟 Ubah destructuring agar membaca slot_number
        const { class_subject_id, day_of_week, slot_number } = req.body;

        if (!class_subject_id || !day_of_week || !slot_number) {
            return res.status(400).json({ error: "Semua data komponen jadwal (Mapel, Hari, dan Slot) wajib diisi." });
        }

        try {
            // 🌟 Sesuaikan query SQL dengan kolom database Mas
            const query = `
                INSERT INTO schedules (class_subject_id, day_of_week, slot_number)
                VALUES ($1, $2, $3)
                RETURNING *
            `;
            const result = await db.query(query, [class_subject_id, day_of_week, slot_number]);
            res.status(201).json({ message: "Jadwal pelajaran berhasil ditambahkan ke kalender kelas.", data: result.rows[0] });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Gagal menyimpan jadwal pelajaran." });
        }
    },

    // Menghapus item jam pelajaran tertentu di kalender jadwal
    deleteSchedule: async (req, res) => {
        const { id } = req.params;
        try {
            await db.query('DELETE FROM schedules WHERE id = $1', [id]);
            res.json({ message: "Jadwal pelajaran berhasil dihapus." });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    },

        // Ambil semua susunan master slot waktu harian sekolah
    getGlobalTimeSlots: async (req, res) => {
        try {
            const result = await db.query('SELECT * FROM global_time_slots ORDER BY slot_number ASC');
            res.json(result.rows);
        } catch (err) {
            res.status(500).json({ error: "Gagal mengambil master data slot waktu harian." });
        }
    },

    // Tambah atau Update Rangka Slot Waktu Harian
    createGlobalTimeSlot: async (req, res) => {
        const { slot_number, slot_type, label_name, custom_duration_minutes } = req.body;
        try {
            const result = await db.query(
                `INSERT INTO global_time_slots (slot_number, slot_type, label_name, custom_duration_minutes) 
                VALUES ($1, $2, $3, $4) 
                ON CONFLICT (slot_number) 
                DO UPDATE SET slot_type = $2, label_name = $3, custom_duration_minutes = $4 
                RETURNING *`,
                [slot_number, slot_type, label_name, slot_type === 'custom' ? parseInt(custom_duration_minutes) : null]
            );
            res.json(result.rows[0]);
        } catch (err) {
            res.status(500).json({ error: "Gagal memproses pengaturan slot waktu harian." });
        }
    },

    // Hapus satu baris dari rangka slot waktu
    deleteGlobalTimeSlot: async (req, res) => {
        const { id } = req.params;
        try {
            await db.query('DELETE FROM global_time_slots WHERE id = $1', [id]);
            res.json({ message: "Slot waktu harian berhasil dihapus dari acuan dasar." });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    },
    
    // Mengambil data rombel/kelas (Contoh: 7A, 7B, 8A, dsb)
    getClasses: async (req, res) => {
        try {
            // Menggabungkan grade dan class_name langsung dari database
            const query = `
            SELECT id, CONCAT(grade, ' ', name) AS class_name 
            FROM classes 
            ORDER BY grade ASC, class_name ASC
            `;
            const result = await db.query(query);
            res.json(result.rows); 
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Gagal mengambil data master kelas." });
        }
    },

    getClassSubjects: async (req, res) => {
        const { class_id } = req.params;
        const { academic_year_id } = req.query;
        try {
            const query = `
            SELECT cs.id, s.subject_name, s.subject_code, u.full_name AS teacher_name
            FROM class_subjects cs
            JOIN subjects s ON cs.subject_id = s.id
            JOIN users u ON cs.teacher_id = u.id
            WHERE cs.class_id = $1 AND cs.academic_year_id = $2
            `;
            const result = await db.query(query, [parseInt(class_id), parseInt(academic_year_id)]);
            res.json(result.rows);
        } catch (err) {
            res.status(500).json({ error: "Gagal mengambil pengampu kelas." });
        }
    },

    getSchedulesByClass: async (req, res) => {
        const { class_id } = req.params;
        const { academic_year_id } = req.query;
        try {
            const query = `
            SELECT 
                s.id AS schedule_id,
                s.day_of_week,
                s.slot_number,
                sub.subject_name,
                sub.subject_code,
                u.full_name AS teacher_name
            FROM schedules s
            JOIN class_subjects cs ON s.class_subject_id = cs.id
            JOIN subjects sub ON cs.subject_id = sub.id
            JOIN users u ON cs.teacher_id = u.id
            WHERE cs.class_id = $1 AND cs.academic_year_id = $2
            ORDER BY s.slot_number ASC
            `;
            const result = await db.query(query, [parseInt(class_id), parseInt(academic_year_id)]);
            res.json(result.rows);
        } catch (err) {
            res.status(500).json({ error: "Gagal mengambil kalender jadwal kelas." });
        }
    },
};

module.exports = adminController;