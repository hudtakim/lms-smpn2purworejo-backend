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

// Inisialisasi multer dengan limit 2MB
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 } // 2 MB
});

module.exports = upload;