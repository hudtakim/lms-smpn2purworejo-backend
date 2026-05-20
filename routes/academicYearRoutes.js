const express = require("express");
const router = express.Router();
const { 
  getAcademicYears, 
  createAcademicYear, 
  toggleActivePeriod, 
  deleteAcademicYear 
} = require("../controllers/academicYearController");
const { verifyToken, isAdmin } = require("../src/middlewares/authMiddleware");

router.get("/", verifyToken, getAcademicYears);
router.post("/", verifyToken, isAdmin, createAcademicYear);
router.patch("/:id/activate", verifyToken, isAdmin, toggleActivePeriod);
router.delete("/:id", verifyToken, isAdmin, deleteAcademicYear);

module.exports = router;