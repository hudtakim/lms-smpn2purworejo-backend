const express = require('express');
const fileUpload = require('express-fileupload'); // Tambahkan ini
const cors = require('cors');
const adminRoutes = require('./routes/adminRoutes');
const authRoutes = require('./routes/authRoutes'); // Tambahkan ini
const classRoutes = require("./routes/classRoutes");
const academicYearRoutes = require("./routes/academicYearRoutes");

const app = express();

app.use(cors());
app.use(express.json());
app.use(fileUpload()); // Aktifkan middleware file upload

// Daftarkan rute auth dengan prefix /api/auth
app.use('/api/auth', authRoutes);

// Daftarkan rute dengan prefix /api/admin
app.use('/api/admin', adminRoutes);
app.use("/api/admin/classes", classRoutes);
app.use("/api/admin/academic-years", academicYearRoutes);

app.listen(5000, () => console.log('LMS SMPN2PWR Backend Running...'));