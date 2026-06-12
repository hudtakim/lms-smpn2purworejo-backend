const express = require("express");
const router = express.Router();
const globalController = require("../controllers/globalController");
const { verifyToken } = require("../src/middlewares/authMiddleware");

router.get("/active-academic-year", verifyToken, globalController.getActiveAcademicYear);
router.get("/session-duration-limit", globalController.getSessionDurationLimit)
router.get("/maintenance-status", globalController.getMaintenanceStatus);
router.get("/admin-whatsapp", verifyToken, globalController.getAdminWhatsapp);

router.get("/profile", verifyToken, globalController.getMyProfile);
router.put("/update-password", verifyToken, globalController.updateMyPassword);

module.exports = router;