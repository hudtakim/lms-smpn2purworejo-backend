const db = require('../config/db');
const bcrypt = require('bcrypt');
const saltRounds = 10;

const globalController = {
    getActiveAcademicYear: async (req, res) => {
        try {
        const query = 'SELECT * FROM academic_years WHERE is_active = true LIMIT 1';
        const { rows } = await db.query(query);
        //console.log("Tahun akademik aktif yang diambil dari database:", rows[0]);
        res.json(rows[0]);
        } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
        }
    },

    getSessionDurationLimit: async (req,res) => {
        try{
            const query = `SELECT * FROM app_settings WHERE setting_key = 'session_time_limit'`;
            const {rows} = await db.query(query);
            res.json(rows[0]);
        }catch(err){
            console.error(err);
            res.status(500).json({error: 'Internal server error'});
        };
        
    },

    getMaintenanceStatus: async (req,res) => {
        try{
            const query = `SELECT * FROM app_settings WHERE setting_key = 'mode_maintenance'`;
            const {rows} = await db.query(query);
            res.json(rows[0]);
        }catch(err){
            console.error(err);
            res.status(500).json({error: 'Internal server error'});
        };
        
    },

    getAdminWhatsapp: async (req,res) => {
        try{
            const query = `SELECT * FROM app_settings WHERE setting_key = 'admin_wa'`;
            const {rows} = await db.query(query);
            res.json(rows[0]);
        }catch(err){
            console.error(err);
            res.status(500).json({error: 'Internal server error'});
        };
    },

    getMyProfile: async (req, res) => {
        try {
            const userId = req.user.id;
            // Ambil data profil, termasuk updated_at
            const result = await db.query(
                "SELECT username, full_name, role, gender, religion, updated_at FROM users WHERE id = $1",
                [userId]
            );
            
            if (result.rows.length === 0) return res.status(404).json({ error: "User tidak ditemukan" });
            res.json(result.rows[0]);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    },

    updateMyPassword: async (req, res) => {
        try {
            const userId = req.user.id;
            const { new_password } = req.body;

            if (!new_password || new_password.length < 6) {
                return res.status(400).json({ error: "Password baru minimal 6 karakter." });
            }

            // 1. Cek kapan terakhir kali user ini update profile/password
            const userRes = await db.query("SELECT updated_at FROM users WHERE id = $1", [userId]);
            const user = userRes.rows[0];

            if (user.updated_at) {
                const lastUpdate = new Date(user.updated_at);
                const now = new Date();
                
                // Hitung selisih hari
                const diffTime = Math.abs(now - lastUpdate);
                const diffDays = diffTime / (1000 * 60 * 60 * 24);

                // 2. Jika belum 7 hari (7 x 24 jam), tolak permintaan
                if (diffDays < 7) {
                    const sisaHari = Math.ceil(7 - diffDays);
                    return res.status(400).json({ 
                        error: `Anda sudah pernah mengubah password minggu ini. Silakan coba lagi dalam ${sisaHari} hari.` 
                    });
                }
            }

            // 3. Jika aman (> 7 hari atau updated_at masih null), proses hash dan update
            const hashedPassword = await bcrypt.hash(new_password, saltRounds);
            
            await db.query(
                "UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2",
                [hashedPassword, userId]
            );

            res.json({ message: "Password berhasil diperbarui! Gunakan password baru ini saat login berikutnya." });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
};

module.exports = globalController;
