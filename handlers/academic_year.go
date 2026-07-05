package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"lms-backend-go/config"

	chilib "github.com/go-chi/chi/v5"
)

// GetAcademicYearsList - GET /api/admin/academic-years/
func GetAcademicYearsList(w http.ResponseWriter, r *http.Request) {
	rows, err := config.Pool.Query(context.Background(),
		"SELECT id, year_name, semester, is_active FROM academic_years ORDER BY id DESC")
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"message": "Internal server error",
		})
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"message": "Internal server error",
		})
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Daftar tahun ajaran berhasil dimuat",
		"data":    data,
	})
}

// CreateAcademicYearFull - POST /api/admin/academic-years/
func CreateAcademicYearFull(w http.ResponseWriter, r *http.Request) {
	var body struct {
		YearName string `json:"year_name"`
		Semester string `json:"semester"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonResponse(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"message": "Invalid request body",
		})
		return
	}

	if body.YearName == "" || body.Semester == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"message": "Tahun ajaran dan semester wajib diisi",
		})
		return
	}

	var existingID int
	err := config.Pool.QueryRow(context.Background(),
		"SELECT id FROM academic_years WHERE year_name = $1 AND semester = $2",
		body.YearName, body.Semester).Scan(&existingID)
	if err == nil {
		jsonResponse(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("Gagal! Sesi %s - %s sudah terdaftar.", body.YearName, body.Semester),
		})
		return
	}

	rows, err := config.Pool.Query(context.Background(),
		"INSERT INTO academic_years (year_name, semester, is_active) VALUES ($1, $2, false) RETURNING *",
		body.YearName, body.Semester)
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"message": "Internal server error",
		})
		return
	}
	row, err := rowToMap(rows)
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"message": "Internal server error",
		})
		return
	}
	jsonResponse(w, http.StatusCreated, map[string]interface{}{
		"success": true,
		"message": "Tahun ajaran baru berhasil disimpan",
		"data":    row,
	})
}

// ActivateAcademicYearFull - PATCH /api/admin/academic-years/:id/activate
func ActivateAcademicYearFull(w http.ResponseWriter, r *http.Request) {
	idStr := chilib.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid ID")
		return
	}

	var yearName, semester string
	err = config.Pool.QueryRow(context.Background(),
		"SELECT year_name, semester FROM academic_years WHERE id = $1", id).Scan(&yearName, &semester)
	if err != nil {
		jsonResponse(w, http.StatusNotFound, map[string]interface{}{
			"success": false,
			"message": "Tahun ajaran tidak ditemukan",
		})
		return
	}

	tx, err := config.Pool.Begin(context.Background())
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Server error")
		return
	}
	defer tx.Rollback(context.Background())

	tx.Exec(context.Background(), "UPDATE academic_years SET is_active = false")
	tx.Exec(context.Background(), "UPDATE academic_years SET is_active = true WHERE id = $1", id)

	if err = tx.Commit(context.Background()); err != nil {
		jsonError(w, http.StatusInternalServerError, "Server error")
		return
	}

	rows, err := config.Pool.Query(context.Background(),
		"SELECT * FROM academic_years WHERE id = $1", id)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Server error")
		return
	}
	row, _ := rowToMap(rows)

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Sesi %s (%s) kini aktif digunakan sistem", yearName, semester),
		"data":    row,
	})
}

// DeleteAcademicYear - DELETE /api/admin/academic-years/:id
func DeleteAcademicYear(w http.ResponseWriter, r *http.Request) {
	idStr := chilib.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid ID")
		return
	}

	var isActive bool
	err = config.Pool.QueryRow(context.Background(),
		"SELECT is_active FROM academic_years WHERE id = $1", id).Scan(&isActive)
	if err != nil {
		jsonResponse(w, http.StatusNotFound, map[string]interface{}{
			"success": false,
			"message": "Tahun ajaran tidak ditemukan",
		})
		return
	}

	if isActive {
		jsonResponse(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"message": "Gagal! Sesi aktif utama tidak bisa dihapus.",
		})
		return
	}

	var classCount int
	config.Pool.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM classes WHERE academic_year_id = $1", id).Scan(&classCount)
	if classCount > 0 {
		jsonResponse(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"message": "Gagal menghapus! Periode akademik ini sudah terpakai di manajemen unit kelas.",
		})
		return
	}

	_, err = config.Pool.Exec(context.Background(),
		"DELETE FROM academic_years WHERE id = $1", id)
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"message": "Internal server error",
		})
		return
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Periode akademik berhasil dihapus",
	})
}
