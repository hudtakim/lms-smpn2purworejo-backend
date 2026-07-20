// middlewares/upload.js
const multer = require('multer');
const path = require('path');

// Atur tempat penyimpanan dan nama file
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // File akan disimpan di folder 'uploads/'
  },
  filename: function (req, file, cb) {
    // Format nama file: timestamp-randomangka.ekstensi (agar nama tidak bentrok)
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// Inisialisasi multer dengan limit 10MB
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

module.exports = upload;