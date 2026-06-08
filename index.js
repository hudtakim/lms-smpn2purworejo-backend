const express = require('express');
//const fileUpload = require('express-fileupload'); // Tambahkan ini
const cors = require('cors');
const globalRoutes = require('./routes/globalRoutes');
const adminRoutes = require('./routes/adminRoutes');
const authRoutes = require('./routes/authRoutes'); // Tambahkan ini
const classRoutes = require("./routes/classRoutes");
const academicYearRoutes = require("./routes/academicYearRoutes");
const teacherRoutes = require("./routes/teacherRoutes"); // Tambahkan ini
const studentRoutes = require("./routes/studentRoutes"); // Tambahkan ini
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
//app.use(fileUpload()); // Aktifkan middleware file upload


// Daftarkan rute auth dengan prefix /api/auth
app.use('/api/auth', authRoutes);

app.use('/api/global', globalRoutes); // Rute untuk data global seperti tahun akademik aktif

// Daftarkan rute dengan prefix /api/admin
app.use('/api/admin', adminRoutes);
app.use("/api/admin/classes", classRoutes);
app.use("/api/admin/academic-years", academicYearRoutes);
app.use("/api/teacher", teacherRoutes); // Rute untuk guru
app.use("/api/student", studentRoutes); // Rute untuk siswa

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.listen(5000, () => console.log('LMS SMPN2PWR Backend Running...'));