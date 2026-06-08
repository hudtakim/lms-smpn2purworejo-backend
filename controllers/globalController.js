const db = require('../config/db');

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
    }
};

module.exports = globalController;
