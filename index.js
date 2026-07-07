const express = require('express');
const Sentry = require('@sentry/node');
//const fileUpload = require('express-fileupload'); // Tambahkan ini
const cors = require('cors');
const globalRoutes = require('./routes/globalRoutes');
const adminRoutes = require('./routes/adminRoutes');
const authRoutes = require('./routes/authRoutes'); // Tambahkan ini
const classRoutes = require("./routes/classRoutes");
const academicYearRoutes = require("./routes/academicYearRoutes");
const teacherRoutes = require("./routes/teacherRoutes"); // Tambahkan ini
const studentRoutes = require("./routes/studentRoutes"); // Tambahkan ini
const supervisorRoutes = require("./routes/supervisorRoutes");
const parentRoutes = require("./routes/parentRoutes");
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
//app.use(fileUpload()); // Aktifkan middleware file upload

Sentry.init({ dsn: "https://c012d5084e3be5a04e6e4a459539a253@o4511654702809088.ingest.us.sentry.io/4511654773850112" });


// Daftarkan rute auth dengan prefix /api/auth
app.use('/api/auth', authRoutes);

app.use('/api/global', globalRoutes); // Rute untuk data global seperti tahun akademik aktif

// Daftarkan rute dengan prefix /api/admin
app.use('/api/admin', adminRoutes);
app.use("/api/admin/classes", classRoutes);
app.use("/api/admin/academic-years", academicYearRoutes);
app.use("/api/teacher", teacherRoutes); // Rute untuk guru
app.use("/api/student", studentRoutes); // Rute untuk siswa
app.use("/api/supervisor", supervisorRoutes);
app.use("/api/parent", parentRoutes);

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

Sentry.setupExpressErrorHandler(app);

app.listen(5000, () => console.log('LMS SMPN2PWR Backend Running...'));