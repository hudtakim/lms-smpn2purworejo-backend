// controllers/adminController.js
const db = require('../config/db');
const bcrypt = require('bcrypt');
const XLSX = require('xlsx');
const os = require('os');
const fs = require('fs');
const path = require('path');

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

    importUsersExcel: async (req, res) => {
        try {
            if (!req.files || !req.files.file) return res.status(400).json({ error: "File Excel tidak ditemukan" });
            const workbook = XLSX.read(req.files.file.data, { type: 'buffer' });
            const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            for (let row of data) {
                const username = row.username || row['Username'];
                const rawPassword = row.password || row['Password'];
                const full_name = row.full_name || row['Nama Lengkap'];
                const role = row.role || row['Role'];
                const gender = row.gender || row['Gender'] || null;
                const religion = row.religion || row['Agama'] || null;

                if (!username || !rawPassword || !full_name || !role) continue;

                const hashed = await bcrypt.hash(rawPassword.toString(), saltRounds);
                
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
        const { is_active } = req.body;
        try {
            const result = await db.query(
                'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, username, is_active',
                [is_active, id]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ error: "User tidak ditemukan." });
            }
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
            const query = 'SELECT * FROM academic_years ORDER BY id DESC';
            const limitQuery = req.user.role === 'admin' ? '' : ' LIMIT 6'; 
            const result = await db.query(query + limitQuery);

            res.json(result.rows);
        } catch (err) { 
            console.error("Error on getAcademicYears:", err);
            res.status(500).json({ error: err.message }); 
        }
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
        // Tangkap parameter filter dari frontend
        const { academic_year_id } = req.query; 
        try {
            let query = 'SELECT * FROM subjects';
            let params = [];

            if (academic_year_id) {
                query += ' WHERE academic_year_id = $1';
                params.push(academic_year_id);
            }
            
            query += ' ORDER BY subject_name ASC';
            const result = await db.query(query, params);
            
            return res.status(200).json(result.rows);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: "Internal server error" });
        }
    },

    createSubject: async (req, res) => {
        // Tambahkan target_jp ke payload
        const { academic_year_id, subject_code, subject_name, grade, kkm, target_jp } = req.body; 
        
        if (!academic_year_id || !subject_code || !subject_name || !grade) {
            return res.status(400).json({ error: "Data wajib diisi (termasuk Tahun Ajaran)!" });
        }
        
        try {
            const checkDuplicate = await db.query(
                'SELECT id FROM subjects WHERE UPPER(subject_code) = $1 AND academic_year_id = $2', 
                [subject_code.toUpperCase().trim(), academic_year_id]
            );
            if (checkDuplicate.rows.length > 0) return res.status(400).json({ error: "Kode sudah digunakan di tahun ajaran ini!" });

            const kkmValue = kkm ? parseFloat(kkm) : null; 
            const targetJpValue = target_jp ? parseInt(target_jp) : null; // Parsing integer

            const result = await db.query(
                'INSERT INTO subjects (academic_year_id, subject_code, subject_name, grade, kkm, target_jp, is_active) VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING *',
                [academic_year_id, subject_code.toUpperCase().trim(), subject_name.trim(), grade, kkmValue, targetJpValue]
            );
            return res.status(201).json(result.rows[0]);
        } catch (err) { 
            res.status(500).json({ error: "Internal server error" }); 
        }
    },

    updateSubject: async (req, res) => {
        const { id } = req.params;
        // Tambahkan target_jp ke payload update
        const { academic_year_id, subject_code, subject_name, grade, kkm, target_jp } = req.body; 
        try {
            const checkDuplicate = await db.query(
                'SELECT id FROM subjects WHERE UPPER(subject_code) = $1 AND academic_year_id = $2 AND id != $3', 
                [subject_code.toUpperCase().trim(), academic_year_id, id]
            );
            if (checkDuplicate.rows.length > 0) return res.status(400).json({ error: "Kode digunakan mapel lain di tahun ajaran ini!" });

            const kkmValue = kkm ? parseFloat(kkm) : null;
            const targetJpValue = target_jp ? parseInt(target_jp) : null; // Parsing integer

            const result = await db.query(
                'UPDATE subjects SET academic_year_id = $1, subject_code = $2, subject_name = $3, grade = $4, kkm = $5, target_jp = $6 WHERE id = $7 RETURNING *',
                [academic_year_id, subject_code.toUpperCase().trim(), subject_name.trim(), grade, kkmValue, targetJpValue, id]
            );
            return res.status(200).json(result.rows[0]);
        } catch (err) { 
            res.status(500).json({ error: "Internal server error" }); 
        }
    },

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

getClassSubjects: async (req, res) => {
    const { academic_year_id } = req.query;

    if (!academic_year_id) {
        return res.status(400).json({ error: "Academic year ID (semester) wajib disertakan." });
    }

    try {
        const query = `
            SELECT 
                cs.id,
                cs.subject_id,
                cs.teacher_id,
                cs.academic_year_id,
                s.subject_name,
                s.subject_code,
                u.full_name as teacher_name
            FROM class_subjects cs
            JOIN subjects s ON cs.subject_id = s.id
            JOIN users u ON cs.teacher_id = u.id
            WHERE cs.academic_year_id = $1
            ORDER BY s.subject_name ASC
        `;
        
        const result = await db.query(query, [academic_year_id]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
},

    assignClassSubject: async (req, res) => {
        const { subject_id, teacher_id, academic_year_id } = req.body;
        
        if (!subject_id || !teacher_id || !academic_year_id) {
            return res.status(400).json({ error: "Semua field data plotting wajib diisi." });
        }

        try {
            const checkTeacher = await db.query('SELECT role FROM users WHERE id = $1', [teacher_id]);
            if (checkTeacher.rows.length === 0 || checkTeacher.rows[0].role === 'student') {
                return res.status(400).json({ error: "User yang dipilih harus merupakan seorang Guru/Pengajar." });
            }

            // 🔥 PERBAIKAN 1: Pengecekan kombinasi Guru + Mapel unik sebelum insert
            const checkDuplicate = await db.query(
                'SELECT id FROM class_subjects WHERE subject_id = $1 AND teacher_id = $2 AND academic_year_id = $3',
                [subject_id, teacher_id, academic_year_id]
            );
            
            if (checkDuplicate.rows.length > 0) {
                return res.status(400).json({ error: "Gagal! Guru tersebut sudah diplot untuk mata pelajaran ini di semester yang sama." });
            }

            const query = `
                INSERT INTO class_subjects (subject_id, teacher_id, academic_year_id)
                VALUES ($1, $2, $3)
                RETURNING *
            `;
            const result = await db.query(query, [subject_id, teacher_id, academic_year_id]);
            res.status(201).json({ message: "Mata pelajaran dan pengajar berhasil diplot.", data: result.rows[0] });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Gagal menyimpan data plotting pengajar." });
        }
    },

    removeClassSubject: async (req, res) => {
        const { id } = req.params;
        try {
            // 1. Cek apakah ID ini masih digunakan sebagai foreign key di tabel schedule
            const checkSchedule = await db.query(
                'SELECT id FROM schedules WHERE class_subject_id = $1 LIMIT 1', 
                [id]
            );

            // 2. Jika ditemukan di schedule, batalkan penghapusan dan kirim respon 400 (Bad Request)
            if (checkSchedule.rows.length > 0) {
                return res.status(400).json({ 
                    error: "Gagal menghapus! Pastikan tidak ada jadwal kelas yang masih menggunakan mapel ini, atau hapus jadwalnya di kalender terlebih dahulu." 
                });
            }

            // 3. Jika aman, lakukan proses penghapusan
            await db.query('DELETE FROM class_subjects WHERE id = $1', [id]);
            
            return res.json({ message: "Plotting mata pelajaran berhasil dihapus." });

        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: "Terjadi kesalahan internal pada server." });
        }
    },


    // =========================================================
    // 6. MANAJEMEN JADWAL PELAJARAN (schedules)
    // =========================================================

getClassSchedules: async (req, res) => {
    const { academic_year_id } = req.query;

    if (!academic_year_id) {
        return res.status(400).json({ error: "Academic year ID wajib disertakan." });
    }

    try {
        const query = `
            SELECT 
                sch.id as schedule_id,
                sch.day_of_week,
                sch.slot_number,
                cs.id as class_subject_id,
                cs.teacher_id,
                s.subject_name,
                s.subject_code,
                u.full_name as teacher_name,
                sch.class_id
            FROM schedules sch
            JOIN class_subjects cs ON sch.class_subject_id = cs.id
            JOIN subjects s ON cs.subject_id = s.id
            JOIN users u ON cs.teacher_id = u.id
            WHERE cs.academic_year_id = $1
            ORDER BY 
            CASE sch.day_of_week
                WHEN 'Senin' THEN 1
                WHEN 'Selasa' THEN 2
                WHEN 'Rabu' THEN 3
                WHEN 'Kamis' THEN 4
                WHEN 'Jumat' THEN 5
                WHEN 'Sabtu' THEN 6
                ELSE 7
            END, sch.slot_number ASC
        `;
            
        const result = await db.query(query, [academic_year_id]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
},

createSchedule: async (req, res) => {
    const { class_id, class_subject_id, day_of_week, slot_number } = req.body;

    if (!class_id || !class_subject_id || !day_of_week || !slot_number) {
        return res.status(400).json({ error: "Semua data komponen jadwal (Mapel, Hari, dan Slot) wajib diisi." });
    }

    try {
        // 1. Ambil data guru (dan semester jika masih terikat)
        const currentPlotRes = await db.query(
            'SELECT teacher_id, academic_year_id FROM class_subjects WHERE id = $1',
            [class_subject_id]
        );
        
        if (currentPlotRes.rows.length === 0) {
            return res.status(404).json({ error: "Data pengampu mata pelajaran tidak ditemukan." });
        }
        
        const { teacher_id, academic_year_id } = currentPlotRes.rows[0];

        // 2. Cek konflik guru pada slot yang sama
        // 🌟 PERBAIKAN: Tambahkan JOIN ke tabel classes untuk mengambil info kelas
        const checkConflictQuery = `
            SELECT 
                sub.subject_name,
                c.grade,
                c.name AS class_name
            FROM schedules s
            JOIN class_subjects cs ON s.class_subject_id = cs.id
            JOIN subjects sub ON cs.subject_id = sub.id
            JOIN classes c ON s.class_id = c.id
            WHERE cs.teacher_id = $1 
              AND cs.academic_year_id = $2 
              AND s.day_of_week = $3 
              AND s.slot_number = $4
        `;
        const conflictRes = await db.query(checkConflictQuery, [teacher_id, academic_year_id, day_of_week, parseInt(slot_number)]);

        if (conflictRes.rows.length > 0) {
            const conflict = conflictRes.rows[0];
            // 🌟 PERBAIKAN: Susun nama kelas (Misal: "7 A" atau "VIII B")
            const conflictClassInfo = `${conflict.grade || ''} ${conflict.class_name || ''}`.trim();
            
            // 🌟 PERBAIKAN: Pesan error jadi sangat informatif
            return res.status(400).json({ 
                error: `Gagal! Guru tersebut sudah mengajar mapel [${conflict.subject_name}] di KELAS ${conflictClassInfo} pada hari ${day_of_week} (Slot ke-${slot_number}).` 
            });
        }

        // 3. Jika aman, lakukan penyimpanan
        const insertQuery = `
            INSERT INTO schedules (class_id, class_subject_id, day_of_week, slot_number, academic_year_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;
        const result = await db.query(insertQuery, [class_id, class_subject_id, day_of_week, slot_number, academic_year_id]);
        res.status(201).json({ message: "Jadwal pelajaran berhasil ditambahkan.", data: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Gagal menyimpan jadwal pelajaran." });
    }
},
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

    getGlobalTimeSlots: async (req, res) => {
        const { academic_year_id } = req.query; 
        try {
            const result = await db.query(`SELECT * FROM global_time_slots WHERE academic_year_id = $1 ORDER BY day_of_week ASC, slot_number ASC`, [academic_year_id]);
            res.json(result.rows);
        } catch (err) {
            res.status(500).json({ error: "Gagal mengambil master data slot waktu harian." });
        }
    },

    createGlobalTimeSlot: async (req, res) => {
        const { day_of_week, slot_number, slot_type, label_name, custom_duration_minutes, academic_year_id } = req.body;
        if (!day_of_week || !slot_number || !slot_type || !label_name) {
            return res.status(400).json({ error: "Field utama rangka acuan wajib diisi." });
        }
        try {
            // SINKRONISASI SCHEMA: Menggunakan kombinasi UNIQUE KEY (day_of_week, slot_number)
            const result = await db.query(
                `INSERT INTO global_time_slots (day_of_week, slot_number, slot_type, label_name, custom_duration_minutes, academic_year_id) 
                VALUES ($1, $2, $3, $4, $5, $6) 
                ON CONFLICT (day_of_week, slot_number, academic_year_id) 
                DO UPDATE SET slot_type = $3, label_name = $4, custom_duration_minutes = $5 
                RETURNING *`,
                [parseInt(day_of_week), parseInt(slot_number), slot_type, label_name, slot_type === 'custom' ? parseInt(custom_duration_minutes) : null, parseInt(academic_year_id)]
            );
            res.json(result.rows[0]);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Gagal memproses pengaturan slot waktu harian." });
        }
    },

    deleteGlobalTimeSlot: async (req, res) => {
        const { id } = req.params;
        const { academic_year_id } = req.body;

        try {
            const checkSlot = await db.query('SELECT * FROM global_time_slots WHERE id = $1', [id]);
            if (checkSlot.rows.length === 0) {
                return res.status(404).json({ error: "Slot waktu harian tidak ditemukan." });
            }

            const { slot_number, day_of_week } = checkSlot.rows[0];
            let usedDayOfWeek = {
                1: 'Senin',
                2: 'Selasa',
                3: 'Rabu',
                4: 'Kamis',
                5: 'Jumat',
                6: 'Sabtu'
             }

            const checkSchedule = await db.query(
                'SELECT id FROM schedules WHERE slot_number = $1 AND day_of_week = $2 AND academic_year_id = $3 LIMIT 1', 
                [slot_number, usedDayOfWeek[day_of_week], academic_year_id]
            );

            // 2. Jika ditemukan di schedule, batalkan penghapusan dan kirim respon 400 (Bad Request)
            if (checkSchedule.rows.length > 0) {
                return res.status(400).json({ 
                    error: "Gagal menghapus! Pastikan tidak ada jadwal kelas yang masih menggunakan slot ini, atau hapus jadwalnya di kalender terlebih dahulu." 
                });
            }

            await db.query('DELETE FROM global_time_slots WHERE id = $1', [id]);
            res.json({ message: "Slot waktu harian berhasil dihapus dari acuan dasar." });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    },
    
    getClasses: async (req, res) => {
        try {
            const query = `
                SELECT id, CONCAT(grade, ' ', name) AS class_name 
                FROM classes 
                ORDER BY grade ASC, name ASC
            `;
            const result = await db.query(query);
            res.json(result.rows); 
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Gagal mengambil data master kelas." });
        }
    },

    getSchedulesByClass: async (req, res) => {
        return adminController.getClassSchedules(req, res);
    },

    updateDaySettings: async (req, res) => {
        const { day_of_week, start_time_school, kbm_duration_minutes } = req.body;

        try {
            // 1. Update kbm_duration_minutes untuk SEMUA hari (tanpa filter WHERE)
            if (kbm_duration_minutes !== undefined) {
                await db.query(`
                    UPDATE day_var_global 
                    SET 
                        kbm_duration_minutes = $1,
                        updated_at = CURRENT_TIMESTAMP
                `, [kbm_duration_minutes]);
            }

            // 2. Update start_time_school HANYA untuk hari yang dipilih
            const query = `
                UPDATE day_var_global 
                SET 
                    start_time_school = $1, 
                    updated_at = CURRENT_TIMESTAMP
                WHERE day_of_week = $2
                RETURNING *;
            `;
            const values = [start_time_school, day_of_week];
            const result = await db.query(query, values);

            if (result.rowCount === 0) {
                return res.status(404).json({ message: "Hari tidak valid." });
            }

            res.status(200).json({ 
                message: "Pengaturan berhasil diperbarui!", 
                data: result.rows[0] 
            });
        } catch (error) {
            console.error("Error update day settings:", error);
            res.status(500).json({ message: "Gagal memperbarui pengaturan." });
        }
    },

    // Tambahkan di adminController.js
    getDaySettings: async (req, res) => {
        try {
            const result = await db.query("SELECT day_of_week, start_time_school, kbm_duration_minutes FROM day_var_global ORDER BY day_of_week ASC");
            res.status(200).json(result.rows);
        } catch (error) {
            res.status(500).json({ message: "Gagal ambil data settings" });
        }
    },

    // --- TAMBAHAN: FUNGSI KKM GLOBAL ---
    getGlobalKkmX: async (req, res) => {
        try {
            const result = await db.query("SELECT setting_value FROM app_settings WHERE setting_key = 'default_kkm'");
            res.json({ default_kkm: result.rows.length > 0 ? parseFloat(result.rows[0].setting_value) : 75 });
        } catch (err) { res.status(500).json({ error: err.message }); }
    },

    getGlobalKkm: async (req, res) => {
        // Tangkap input dari luar (via query string: ?academic_year_id=...)
        const { academic_year_id } = req.query; 

        try {
            if (!academic_year_id) {
                return res.status(400).json({ error: "Parameter academic_year_id diperlukan." });
            }

            const result = await db.query(
                "SELECT default_kkm FROM academic_year_kkm WHERE academic_year_id = $1 LIMIT 1",
                [academic_year_id]
            );

            // Jika belum diset di tabel, fallback ke nilai default 75
            const defaultKkm = result.rows.length > 0 ? parseFloat(result.rows[0].default_kkm) : 75;
            
            // Output JSON tetap sama persis
            res.json({ default_kkm: defaultKkm });
        } catch (err) { 
            res.status(500).json({ error: err.message }); 
        }
    },

    updateGlobalKkm: async (req, res) => {
        // Tangkap input dari luar (via body JSON)
        const { default_kkm, academic_year_id } = req.body; 

        try {
            if (!academic_year_id) {
                return res.status(400).json({ error: "Parameter academic_year_id diperlukan." });
            }

            // Simpan atau update KKM untuk tahun ajaran yang dikirim dari luar (UPSERT)
            await db.query(`
                INSERT INTO academic_year_kkm (academic_year_id, default_kkm, updated_at) 
                VALUES ($1, $2, NOW()) 
                ON CONFLICT (academic_year_id) 
                DO UPDATE SET default_kkm = EXCLUDED.default_kkm, updated_at = NOW()
            `, [academic_year_id, default_kkm]);

            // Output JSON tetap sama persis
            res.json({ message: "Default KKM berhasil diperbarui!" });
        } catch (err) { 
            res.status(500).json({ error: err.message }); 
        }
    },
    
// =========================================================
    // SYSTEM TELEMETRY & BACKUP ENGINE (FULLY MAPPED)
    // =========================================================
    
    getSystemTelemetry: async (req, res) => {
        try {
            // 1. Hitung total akun aktif (is_active = true) dikelompokkan per role
            const roleQuery = `
                SELECT role, COUNT(*) as active_count 
                FROM users 
                WHERE is_active = true 
                GROUP BY role
            `;
            const roleRes = await db.query(roleQuery);
            
            let roleStats = { student: 0, teacher: 0, admin: 0 };
            let totalActiveUsers = 0;

            roleRes.rows.forEach(r => {
                const roleName = r.role;
                const count = parseInt(r.active_count || 0);
                
                roleStats[roleName] = count;
                totalActiveUsers += count;
            });

            const classRes = await db.query("SELECT COUNT(*) FROM classes");

            // 2. Infrastruktur Server
            const sizeRes = await db.query("SELECT pg_database_size(current_database()) AS size_bytes");
            const dbSizeBytes = parseInt(sizeRes.rows[0].size_bytes || 0);
            const dbSizeMB = (dbSizeBytes / (1024 * 1024)).toFixed(2); 

            // --- HITUNG UKURAN FOLDER UPLOADS (TANPA PROMISES) ---
            const uploadsPath = path.join(__dirname, '../uploads'); 
            const uploadsSizeBytes = getFolderSizeSync(uploadsPath); // <--- Tanpa await, langsung panggil
            const uploadsSizeMB = (uploadsSizeBytes / (1024 * 1024)).toFixed(2);
            // ----------------------------------------------------

            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const ramUsagePct = Math.round(((totalMem - freeMem) / totalMem) * 100);
            const cpuLoadPct = Math.min(Math.round(os.loadavg()[0] * 100), 100);

            res.status(200).json({
                totalActiveUsers,
                roleStats,
                totalClasses: parseInt(classRes.rows[0].count || 0),
                dbSize: `${dbSizeMB} MB`,
                uploadsSize: `${uploadsSizeMB} MB`,
                ramUsage: ramUsagePct,
                cpuLoad: cpuLoadPct || 12 
            });
        } catch (err) {
            res.status(500).json({ error: "Gagal memuat telemetri server: " + err.message });
        }
    },

    getSystemBackup: async (req, res) => {
        try {
            // Urutan 17 tabel lengkap sesuai diagram & relasi database Spero LMS kamu
            const tables = [
                'academic_year_kkm',
                'academic_years',
                'app_settings',
                'class_members',
                'class_subjects',
                'classes',
                'day_var_global',
                'global_time_slots',
                'materials',
                'quiz_scores',
                'quizzes',
                'rooms',
                'schedules',
                'subjects',
                'task_scores',
                'tasks',
                'teaching_documents',
                'teaching_journals',
                'teaching_schedules',
                'time_slots',
                'users'
            ];

            let backupSnapshot = {
                backup_metadata: {
                    exported_at: new Date().toISOString(),
                    database_name: "spero_lms_db",
                    total_tables_backed_up: tables.length,
                    system_version: "SMPN2_Purworejo LMS v1.0-Production"
                }
            };
            
            // Loop & inject semua data dari ke-17 tabel tanpa ada yang terlewat
            for (const table of tables) {
                const result = await db.query(`SELECT * FROM ${table}`);
                backupSnapshot[table] = result.rows;
            }
            
            const jsonString = JSON.stringify(backupSnapshot, null, 2);
            const filename = `DB_SMPN2-PWRJ_LMS_FULL_Backup_${new Date().toISOString().split('T')[0]}.json`;
            
            // Set headers agar langsung memicu download file .json di browser admin
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Type', 'application/json');
            res.status(200).send(jsonString);
        } catch (err) {
            res.status(500).json({ error: "Gagal memproses full-backup basis data: " + err.message });
        }
    },

// Helper untuk menghapus file fisik di server (Menggunakan fs Standar)
    deletePhysicalFiles: async (fileUrls) => {
        for (const url of fileUrls) {
            if (!url) continue;
            try {
                // 1. Deklarasikan filePath di luar if agar terbaca oleh seluruh blok try
                const filePath = path.join(__dirname, "..", url.replace(/^\/+/, ""));
                
                // 2. Cek apakah file ada, lalu hapus secara synchronous (Sinkron)
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    //console.log(`[BERHASIL] File fisik terhapus: ${filePath}`);
                } else {
                    //console.warn(`[AMAN] File fisik sudah tidak ada di direktori: ${filePath}`);
                }
            } catch (error) {
                console.error(`[GAGAL] Tidak bisa menghapus file ${url} | Detail:`, error.message);
            }
        }
    },

    // 1. Fungsi Hapus Data Berdasarkan Tahun Ajaran
    deleteByAcademicYear: async (req, res) => {
        const { academic_year_id } = req.body;

        if (!academic_year_id) {
            return res.status(400).json({ message: "ID Tahun Ajaran wajib diisi!" });
        }

        const client = await db.connect();

        try {
            await client.query('BEGIN');

            // a. Proteksi: Tolak penghapusan jika tahun ajaran sedang aktif
            const checkStatus = await client.query(`SELECT year_name, is_active FROM academic_years WHERE id = $1`, [academic_year_id]);
            if (checkStatus.rows.length === 0) throw new Error("Tahun ajaran tidak ditemukan.");
            if (checkStatus.rows[0].is_active) {
                throw new Error(`Tahun ajaran ${checkStatus.rows[0].year_name} sedang AKTIF! Nonaktifkan terlebih dahulu.`);
            }

            // b. Kumpulkan file_url HANYA dari materials, tasks, dan teaching_documents
            const filesQuery = `
                SELECT file_url FROM materials m JOIN classes c ON m.class_id = c.id WHERE c.academic_year_id = $1 AND m.file_url IS NOT NULL AND m.file_url != ''
                UNION
                SELECT file_url FROM tasks t JOIN classes c ON t.class_id = c.id WHERE c.academic_year_id = $1 AND t.file_url IS NOT NULL AND t.file_url != ''
                UNION
                SELECT file_url FROM teaching_documents WHERE academic_year_id = $1 AND file_url IS NOT NULL AND file_url != ''
            `;
            const { rows: files } = await client.query(filesQuery, [academic_year_id]);
            const fileUrlsToDelete = files.map(row => row.file_url);

            // c. Eksekusi Hapus Rantai Tabel (Dari Anak -> Induk)
            await client.query(`DELETE FROM classes WHERE academic_year_id = $1`, [academic_year_id]);
            
            await client.query(`DELETE FROM teaching_documents WHERE academic_year_id = $1`, [academic_year_id]);
            await client.query(`DELETE FROM schedules WHERE class_id IN (SELECT id FROM classes WHERE academic_year_id = $1)`, [academic_year_id]);
            await client.query(`DELETE FROM class_subjects WHERE academic_year_id = $1`, [academic_year_id]);
            await client.query(`DELETE FROM class_members WHERE class_id IN (SELECT id FROM classes WHERE academic_year_id = $1)`, [academic_year_id]);
            
            await client.query(`DELETE FROM classes WHERE academic_year_id = $1`, [academic_year_id]);
            await client.query(`DELETE FROM academic_years WHERE id = $1`, [academic_year_id]);

            await client.query('COMMIT'); 

            // d. Hapus file fisik setelah database dipastikan aman
            if (typeof adminController.deletePhysicalFiles === 'function') {
                await adminController.deletePhysicalFiles(fileUrlsToDelete);
            }

            res.status(200).json({ 
                message: "Seluruh data tahun ajaran dan file terkait berhasil dihapus bersih.",
                deleted_files_count: fileUrlsToDelete.length 
            });

        } catch (error) {
            await client.query('ROLLBACK'); 
            const statusCode = error.message.includes("sedang AKTIF") ? 400 : 500;
            res.status(statusCode).json({ message: error.message || "Terjadi kesalahan sistem saat menghapus data." });
        } finally {
            client.release();
        }
    },

    // 2. Fungsi Hapus User Berdasarkan Role & Tanggal (Tanpa Hapus File Profile)
    deleteUsersByRoleAndDate: async (req, res) => {
        const { role, max_date } = req.body;

        if (!role || !max_date) {
            return res.status(400).json({ message: "Role dan Tanggal Batas (max_date) wajib diisi!" });
        }

        const client = await db.connect();

        try {
            await client.query('BEGIN');

            const getTargetUsers = await client.query(`SELECT id FROM users WHERE role = $1 AND created_at < $2`, [role, max_date]);
            const targetUsers = getTargetUsers.rows;
            
            if (targetUsers.length === 0) {
                await client.query('ROLLBACK');
                return res.status(200).json({ message: "Tidak ada user yang memenuhi kriteria untuk dihapus." });
            }

            const userIds = targetUsers.map(u => u.id);

            // Proteksi Aset Pembelajaran jika yang dihapus adalah Guru
            if (role === 'teacher') {
                const checkTeacherAssets = await client.query(`SELECT COUNT(*) as count FROM materials WHERE teacher_id = ANY($1::int[])`, [userIds]);
                const checkTeacherDocs = await client.query(`SELECT COUNT(*) as count FROM teaching_documents WHERE teacher_id = ANY($1::int[])`, [userIds]);
                
                if (parseInt(checkTeacherAssets.rows[0].count) > 0 || parseInt(checkTeacherDocs.rows[0].count) > 0) {
                    throw new Error("Dibatalkan! Guru yang ditargetkan masih memiliki Materi, Tugas, atau Dokumen. Hapus aset mereka terlebih dahulu.");
                }
                
                await client.query(`DELETE FROM schedules WHERE class_subject_id IN (SELECT id FROM class_subjects WHERE teacher_id = ANY($1::int[]))`, [userIds]);
                await client.query(`DELETE FROM class_subjects WHERE teacher_id = ANY($1::int[])`, [userIds]);
                await client.query(`DELETE FROM teaching_journals WHERE teacher_id = ANY($1::int[])`, [userIds]);

            // Pembersihan Nilai jika yang dihapus adalah Siswa
            } else if (role === 'student') {
                await client.query(`DELETE FROM task_scores WHERE student_id = ANY($1::int[])`, [userIds]);
                await client.query(`DELETE FROM quiz_scores WHERE student_id = ANY($1::int[])`, [userIds]);
                await client.query(`DELETE FROM class_members WHERE student_id = ANY($1::int[])`, [userIds]);
            }

            // Hapus target users
            const { rowCount } = await client.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [userIds]);

            await client.query('COMMIT');

            res.status(200).json({ 
                message: `Berhasil menghapus ${rowCount} user dengan role ${role}.`
            });

        } catch (error) {
            await client.query('ROLLBACK');
            const statusCode = error.message.includes("Dibatalkan!") ? 400 : 500;
            res.status(statusCode).json({ message: error.message || "Terjadi kesalahan saat menghapus user." });
        } finally {
            client.release();
        }
    },

// =========================================================
    // 7. MANAJEMEN PENGATURAN APLIKASI GLOBAL
    // =========================================================
    getAppSettings: async (req, res) => {
        try {
            const result = await db.query('SELECT setting_key, setting_value FROM app_settings');
            
            // Ubah array of object dari DB menjadi satu Object utuh agar mudah dibaca Frontend
            const settings = {};
            result.rows.forEach(row => {
                settings[row.setting_key] = row.setting_value;
            });
            
            res.json(settings);
        } catch (err) { 
            res.status(500).json({ error: err.message }); 
        }
    },

    updateAppSettings: async (req, res) => {
        const updates = req.body; 
        try {
            // Gunakan Transaction (BEGIN-COMMIT) karena kita akan update banyak baris sekaligus
            await db.query('BEGIN');
            
            for (const [key, value] of Object.entries(updates)) {
                await db.query(
                    'UPDATE app_settings SET setting_value = $1 WHERE setting_key = $2',
                    [String(value), key]
                );
            }
            
            await db.query('COMMIT');
            res.json({ message: "Pengaturan sistem berhasil diperbarui!" });
        } catch (err) {
            await db.query('ROLLBACK');
            res.status(500).json({ error: err.message });
        }
    },

    // Mengambil daftar semua user dengan role 'parent'
    getParentsList: async (req, res) => {
        try {
            const result = await db.query("SELECT id, username, full_name, gender FROM users WHERE role = 'parent' AND is_active = true ORDER BY full_name ASC");
            res.json({ success: true, data: result.rows });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    },

    // Mengambil daftar siswa yang parent_id-nya merujuk ke orang tua ini
    getStudentsByParent: async (req, res) => {
        const { parentId } = req.params;
        try {
            const query = `
                SELECT id, username, full_name, gender, religion 
                FROM users 
                WHERE role = 'student' AND parent_id = $1
                ORDER BY full_name ASC
            `;
            const result = await db.query(query, [parentId]);
            res.json({ success: true, data: result.rows });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    },

    // Mengambil bursa siswa yang BELUM memiliki orang tua (parent_id IS NULL)
    getAvailableStudentsForParent: async (req, res) => {
        try {
            const query = `
                SELECT id, username, full_name, gender, religion 
                FROM users 
                WHERE role = 'student' 
                AND is_active = true
                AND parent_id IS NULL
                ORDER BY full_name ASC
            `;
            const result = await db.query(query);
            res.json({ success: true, data: result.rows });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    },

    // Proses multi-plot: Update parent_id pada siswa terpilih
    assignStudentsToParent: async (req, res) => {
        const { parentId } = req.params;
        const { student_ids } = req.body;

        if (!student_ids || !Array.isArray(student_ids) || student_ids.length === 0) {
            return res.status(400).json({ success: false, message: "Pilih minimal satu siswa." });
        }

        try {
            // Update parent_id siswa yang ID-nya ada di dalam array student_ids
            await db.query(
                `UPDATE users SET parent_id = $1 WHERE id = ANY($2::int[]) AND role = 'student'`,
                [parentId, student_ids]
            );
            res.json({ success: true, message: "Berhasil memploting siswa ke orang tua." });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    },

    // Cabut siswa dari orang tua (set parent_id menjadi NULL)
    removeStudentFromParent: async (req, res) => {
        const { parentId, studentId } = req.params;
        try {
            await db.query(
                `UPDATE users SET parent_id = NULL WHERE id = $1 AND parent_id = $2 AND role = 'student'`, 
                [studentId, parentId]
            );
            res.json({ success: true, message: "Berhasil mencabut akses orang tua dari siswa." });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    },

    // Import Excel: Update parent_id berdasarkan username
    importParentStudentExcel: async (req, res) => {
        try {
            if (!req.files || !req.files.file) return res.status(400).json({ error: "File Excel tidak ditemukan" });
            const workbook = XLSX.read(req.files.file.data, { type: 'buffer' });
            const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            let successCount = 0;

            for (let row of data) {
                const parentUsername = row['Username Orang Tua'];
                const studentUsername = row['Username Siswa'];

                if (!parentUsername || !studentUsername) continue;

                // Cari ID Parent
                const parentRes = await db.query("SELECT id FROM users WHERE username = $1 AND role = 'parent' LIMIT 1", [parentUsername.toString().trim()]);
                
                if (parentRes.rows.length > 0) {
                    const parentId = parentRes.rows[0].id;
                    // Update siswa langsung jika username cocok
                    const updateRes = await db.query(
                        `UPDATE users SET parent_id = $1 WHERE username = $2 AND role = 'student' RETURNING id`,
                        [parentId, studentUsername.toString().trim()]
                    );
                    if (updateRes.rowCount > 0) successCount++;
                }
            }
            res.json({ success: true, message: `Berhasil mengimpor relasi untuk ${successCount} siswa.` });
        } catch (err) {
            console.error("Error Import Relasi Excel:", err);
            res.status(500).json({ success: false, error: "Gagal memproses file Excel." });
        }
    },

    // Auto Generate Akun Orang Tua
    autoGenerateParents: async (req, res) => {
        // Gunakan client khusus dari pool untuk transaction
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            
            // 1. Cari siswa yang belum punya relasi parent_id
            const studentsQuery = `SELECT id, username, full_name FROM users WHERE role = 'student' AND parent_id IS NULL AND is_active = true`;
            const { rows: students } = await client.query(studentsQuery);

            if (students.length === 0) {
                await client.query('ROLLBACK');
                return res.status(200).json({ success: true, message: "Sempurna! Semua siswa aktif saat ini sudah memiliki relasi akun orang tua." });
            }

            let successCount = 0;

            // 2. Looping pembuatan akun
            for (let student of students) {
                const parentUsername = `${student.username}_ortu`;
                const parentFullName = `Orang Tua ${student.full_name}`;
                // Default password disamakan dengan username orang tua
                const hashedPassword = await bcrypt.hash(parentUsername, 10); // saltRounds = 10

                // 3. Insert parent baru (ON CONFLICT untuk jaga-jaga kalau username ortu kebetulan sudah pernah dibuat manual)
                const insertParentQuery = `
                    INSERT INTO users (username, password, full_name, role, is_active) 
                    VALUES ($1, $2, $3, 'parent', true) 
                    ON CONFLICT (username) DO NOTHING 
                    RETURNING id
                `;
                const parentRes = await client.query(insertParentQuery, [parentUsername, hashedPassword, parentFullName]);
                
                let parentId;
                if (parentRes.rows.length > 0) {
                    parentId = parentRes.rows[0].id;
                } else {
                    // Jika username sudah ada di DB, ambil ID-nya
                    const existingParent = await client.query(`SELECT id FROM users WHERE username = $1 AND role = 'parent'`, [parentUsername]);
                    if (existingParent.rows.length > 0) parentId = existingParent.rows[0].id;
                }

                // 4. Update parent_id di data siswa
                if (parentId) {
                    await client.query(`UPDATE users SET parent_id = $1 WHERE id = $2`, [parentId, student.id]);
                    successCount++;
                }
            }

            await client.query('COMMIT');
            res.json({ success: true, message: `Berhasil membuat dan menautkan ${successCount} akun orang tua baru secara otomatis.` });
        } catch (err) {
            await client.query('ROLLBACK');
            console.error("Error Auto-Generate Parents:", err);
            res.status(500).json({ success: false, message: "Gagal memproses auto-generate akun orang tua." });
        } finally {
            client.release();
        }
    },

// Di dalam adminController.js
    copyGlobalTimeSlotsFromPrevious: async (req, res) => {
        try {
            const { to_academic_year_id } = req.body;

            if (!to_academic_year_id) {
            return res.status(400).json({ error: "Tahun ajaran tujuan harus diisi." });
            }

            // 1. Pastikan target memang masih kosong
            const checkTarget = await db.query(
            `SELECT id FROM global_time_slots WHERE academic_year_id = $1 LIMIT 1`,
            [to_academic_year_id]
            );
            if (checkTarget.rows.length > 0) {
            return res.status(400).json({ error: "Tahun ajaran ini sudah memiliki data slot." });
            }

            // 2. Cari academic_year_id terbesar (terbaru) di tabel global_time_slots
            // yang BUKAN tahun ajaran tujuan
            const findSource = await db.query(
            `SELECT DISTINCT academic_year_id 
            FROM global_time_slots 
            WHERE academic_year_id != $1 
            ORDER BY academic_year_id DESC 
            LIMIT 1`,
            [to_academic_year_id]
            );

            if (findSource.rows.length === 0) {
            return res.status(404).json({ error: "Tidak ada data urutan aktivitas dari semester sebelumnya untuk disalin." });
            }

            const from_academic_year_id = findSource.rows[0].academic_year_id;

            // 3. Eksekusi salin data dengan SEMUA kolom yang diminta
            const copyQuery = `
            INSERT INTO global_time_slots (
                slot_number, 
                slot_type, 
                label_name, 
                custom_duration_minutes, 
                day_of_week, 
                end_time, 
                academic_year_id
            )
            SELECT 
                slot_number, 
                slot_type, 
                label_name, 
                custom_duration_minutes, 
                day_of_week, 
                end_time, 
                $1 
            FROM global_time_slots
            WHERE academic_year_id = $2
            `;
            
            const result = await db.query(copyQuery, [to_academic_year_id, from_academic_year_id]);

            res.json({ message: `Berhasil menyalin ${result.rowCount} urutan aktivitas dari semester sebelumnya.` });

        } catch (err) {
            console.error("Error copy global time slots:", err.message);
            res.status(500).json({ error: `Gagal menyalin data: ${err.message}` });
        }
    },
    importSubjectsExcel: async (req, res) => {
        try {
            if (!req.files || !req.files.file) return res.status(400).json({ error: "File Excel tidak ditemukan" });
            const { academic_year_id } = req.body;
            
            if (!academic_year_id) return res.status(400).json({ error: "Parameter tahun ajaran diperlukan." });

            const workbook = XLSX.read(req.files.file.data, { type: 'buffer' });
            const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            let successCount = 0;

            for (let row of data) {
                // Mendukung penamaan kolom fleksibel
                const subject_code = row['Kode Mapel'] || row.subject_code;
                const subject_name = row['Nama Mapel'] || row.subject_name;
                const grade = row['Kelas'] || row.grade;
                const target_jp = row['Target JP'] || row.target_jp || null;
                const kkm = row['KKM'] || row.kkm || null;

                // Skip jika data vital kosong
                if (!subject_code || !subject_name || !grade) continue;

                // Cek duplikasi manual berdasarkan kode mapel di tahun ajaran yang sama
                const checkDuplicate = await db.query(
                    'SELECT id FROM subjects WHERE UPPER(subject_code) = $1 AND academic_year_id = $2', 
                    [subject_code.toString().toUpperCase().trim(), academic_year_id]
                );

                if (checkDuplicate.rows.length === 0) {
                    await db.query(
                        'INSERT INTO subjects (academic_year_id, subject_code, subject_name, grade, kkm, target_jp, is_active) VALUES ($1, $2, $3, $4, $5, $6, TRUE)',
                        [
                            academic_year_id, 
                            subject_code.toString().toUpperCase().trim(), 
                            subject_name.toString().trim(), 
                            grade.toString().trim(), 
                            kkm ? parseFloat(kkm) : null, 
                            target_jp ? parseInt(target_jp) : null
                        ]
                    );
                    successCount++;
                }
            }
            res.json({ message: `Berhasil mengimpor ${successCount} mata pelajaran baru.` });
        } catch (err) {
            console.error("Error Import Mapel Excel:", err);
            res.status(500).json({ error: "Format file Excel tidak sesuai atau terjadi kesalahan database." });
        }
    },
};

module.exports = adminController;

const getFolderSizeSync = (dirPath) => {
    let totalSize = 0;
    try {
        const files = fs.readdirSync(dirPath, { withFileTypes: true });
        
        files.forEach(file => {
            const resPath = path.join(dirPath, file.name);
            if (file.isDirectory()) {
                totalSize += getFolderSizeSync(resPath); // Rekursif jika ada folder di dalam folder
            } else {
                const stat = fs.statSync(resPath);
                totalSize += stat.size;
            }
        });
    } catch (err) {
        // Jika folder tidak ditemukan, biarkan mengembalikan 0
        console.error("Gagal membaca folder:", err.message);
    }
    return totalSize;
};