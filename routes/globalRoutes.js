const express = require("express");
const router = express.Router();
const globalController = require("../controllers/globalController");
const { verifyToken } = require("../src/middlewares/authMiddleware");

router.get("/active-academic-year", verifyToken, globalController.getActiveAcademicYear);

module.exports = router;