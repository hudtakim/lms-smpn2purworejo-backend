package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"lms-backend-go/config"

	chilib "github.com/go-chi/chi/v5"
)

// GetClassesByAcademicYear - GET /api/admin/classes/:academic_year_id
func GetClassesByAcademicYear(w http.ResponseWriter, r *http.Request) {
	academicYearID := chilib.URLParam(r, "academic_year_id")

	var query string
	var args []interface{}

	if academicYearID != "" && academicYearID != "0" {
		query = `
			SELECT
				c.id,
				c.grade,
				c.name AS class_name,
				c.is_active,
				c.capacity,
				c.homeroom_teacher_id,
				ay.year_name AS academic_year,
				u.full_name AS homeroom_teacher_name,
				COUNT(cm.student_id)::INT AS student_count
			FROM classes c
			JOIN academic_years ay ON c.academic_year_id = ay.id
			LEFT JOIN users u ON c.homeroom_teacher_id = u.id
			LEFT JOIN class_members cm ON c.id = cm.class_id
			WHERE c.academic_year_id = $1
			GROUP BY c.id, c.grade, c.name, c.is_active, c.capacity, c.homeroom_teacher_id, ay.year_name, u.full_name
			ORDER BY c.grade ASC, c.name ASC
		`
		args = []interface{}{academicYearID}
	} else {
		query = `
			SELECT
				c.id,
				c.grade,
				c.name AS class_name,
				c.is_active,
				c.capacity,
				c.homeroom_teacher_id,
				ay.year_name AS academic_year,
				u.full_name AS homeroom_teacher_name,
				COUNT(cm.student_id)::INT AS student_count
			FROM classes c
			JOIN academic_years ay ON c.academic_year_id = ay.id
			LEFT JOIN users u ON c.homeroom_teacher_id = u.id
			LEFT JOIN class_members cm ON c.id = cm.class_id
			GROUP BY c.id, c.grade, c.name, c.is_active, c.capacity, c.homeroom_teacher_id, ay.year_name, u.full_name
			ORDER BY c.grade ASC, c.name ASC
		`
	}

	rows, err := config.Pool.Query(context.Background(), query, args...)
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
		"message": "Berhasil mengambil data kelas",
		"data":    data,
	})
}

// CreateClass - POST /api/admin/classes
func CreateClass(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AcademicYearID    int    `json:"academic_year_id"`
		RoomID            *int   `json:"room_id"`
		Grade             string `json:"grade"`
		Name              string `json:"name"`
		HomeroomTeacherID *int   `json:"homeroom_teacher_id"`
		Capacity          *int   `json:"capacity"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonResponse(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"message": "Invalid request body",
		})
		return
	}

	if body.AcademicYearID == 0 || body.Grade == "" || body.Name == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"message": "Tahun ajaran, tingkatan (grade), dan nama kelas wajib diisi",
		})
		return
	}

	capacity := 36
	if body.Capacity != nil {
		capacity = *body.Capacity
	}

	rows, err := config.Pool.Query(context.Background(),
		`INSERT INTO classes (academic_year_id, room_id, grade, name, homeroom_teacher_id, capacity)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING *`,
		body.AcademicYearID, body.RoomID, body.Grade, body.Name, body.HomeroomTeacherID, capacity)
	if err != nil {
		errStr := err.Error()
		if strings.Contains(errStr, "23505") || strings.Contains(errStr, "unique") {
			jsonResponse(w, http.StatusBadRequest, map[string]interface{}{
				"success": false,
				"message": fmt.Sprintf("Kelas %s %s sudah ada untuk tahun ajaran tersebut.", body.Grade, body.Name),
			})
			return
		}
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
		"message": "Kelas baru berhasil ditambahkan",
		"data":    row,
	})
}

// UpdateClass - PUT /api/admin/classes/:id
func UpdateClass(w http.ResponseWriter, r *http.Request) {
	idStr := chilib.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid ID")
		return
	}

	var body struct {
		Grade             string `json:"grade"`
		Name              string `json:"name"`
		Capacity          int    `json:"capacity"`
		HomeroomTeacherID *int   `json:"homeroom_teacher_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	rows, err := config.Pool.Query(context.Background(),
		`UPDATE classes SET grade=$1, name=$2, capacity=$3, homeroom_teacher_id=$4, updated_at=NOW()
		 WHERE id=$5 RETURNING *`,
		body.Grade, body.Name, body.Capacity, body.HomeroomTeacherID, id)
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"message": "Internal server error",
		})
		return
	}
	row, err := rowToMap(rows)
	if err != nil || row == nil {
		jsonResponse(w, http.StatusNotFound, map[string]interface{}{
			"success": false,
			"message": "Kelas tidak ditemukan",
		})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Berhasil memperbarui data kelas",
		"data":    row,
	})
}

// DeleteClass - DELETE /api/admin/classes/:id
func DeleteClass(w http.ResponseWriter, r *http.Request) {
	idStr := chilib.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid ID")
		return
	}

	var memberCount int
	config.Pool.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM class_members WHERE class_id = $1", id).Scan(&memberCount)
	if memberCount > 0 {
		jsonResponse(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"message": "Kelas gagal dihapus! Masih ada siswa yang terdaftar di kelas ini. Kosongkan data siswa terlebih dahulu.",
		})
		return
	}

	ct, err := config.Pool.Exec(context.Background(), "DELETE FROM classes WHERE id = $1", id)
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"message": "Internal server error",
		})
		return
	}
	if ct.RowsAffected() == 0 {
		jsonResponse(w, http.StatusNotFound, map[string]interface{}{
			"success": false,
			"message": "Kelas tidak ditemukan",
		})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Kelas berhasil dihapus secara permanen dari database",
	})
}

// GetAvailableHomeroomTeacher - GET /api/admin/classes/available-homeroom-teacher
func GetAvailableHomeroomTeacher(w http.ResponseWriter, r *http.Request) {
	academicYearID := r.URL.Query().Get("academic_year_id")
	if academicYearID == "" {
		jsonError(w, http.StatusBadRequest, "academic_year_id is required")
		return
	}

	rows, err := config.Pool.Query(context.Background(), `
		SELECT id, full_name AS name
		FROM users
		WHERE role = 'teacher' AND is_active = true
		AND id NOT IN (
			SELECT homeroom_teacher_id
			FROM classes
			WHERE academic_year_id = $1
			  AND homeroom_teacher_id IS NOT NULL
		)
		ORDER BY full_name ASC
	`, academicYearID)
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
		"message": "Daftar guru yang tersedia berhasil dimuat",
		"data":    data,
	})
}

// GetAvailableStudentsForClass - GET /api/admin/classes/available-students
func GetAvailableStudentsForClass(w http.ResponseWriter, r *http.Request) {
	academicYearID := r.URL.Query().Get("academic_year_id")
	if academicYearID == "" {
		jsonError(w, http.StatusBadRequest, "academic_year_id is required")
		return
	}

	rows, err := config.Pool.Query(context.Background(), `
		SELECT u.id, u.username, u.full_name, u.gender, u.religion
		FROM users u
		WHERE u.role = 'student'
		  AND u.is_active = true
		  AND NOT EXISTS (
			SELECT 1
			FROM class_members cm
			JOIN classes c ON cm.class_id = c.id
			WHERE c.academic_year_id = $1
			  AND cm.student_id = u.id
		  )
		ORDER BY u.full_name ASC
	`, academicYearID)
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
		"message": "Daftar siswa yang tersedia berhasil dimuat",
		"data":    data,
	})
}

// GetClassDetail - GET /api/admin/classes/:classId/detail
func GetClassDetail(w http.ResponseWriter, r *http.Request) {
	classID := chilib.URLParam(r, "classId")

	rows, err := config.Pool.Query(context.Background(), `
		SELECT c.id, c.grade, c.name AS class_name, c.homeroom_teacher_id, u.full_name AS homeroom_teacher_name
		FROM classes c
		LEFT JOIN users u ON c.homeroom_teacher_id = u.id AND u.role = 'teacher'
		WHERE c.id = $1
	`, classID)
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"message": "Internal server error",
		})
		return
	}
	row, err := rowToMap(rows)
	if err != nil || row == nil {
		jsonResponse(w, http.StatusNotFound, map[string]interface{}{
			"success": false,
			"message": "Ruang kelas tidak ditemukan",
		})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"data":    row,
	})
}

// GetClassMembers - GET /api/admin/classes/:classId/members
func GetClassMembers(w http.ResponseWriter, r *http.Request) {
	classID := chilib.URLParam(r, "classId")

	rows, err := config.Pool.Query(context.Background(), `
		SELECT u.id, u.username, u.full_name, u.religion, u.gender, u.nis
		FROM class_members cm
		JOIN users u ON cm.student_id = u.id
		WHERE cm.class_id = $1 AND u.role = 'student'
		ORDER BY u.full_name ASC
	`, classID)
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
		"data":    data,
	})
}

// AddClassMembers - POST /api/admin/classes/:classId/members
func AddClassMembers(w http.ResponseWriter, r *http.Request) {
	classID := chilib.URLParam(r, "classId")

	var body struct {
		StudentIDs []int64 `json:"student_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	var capacity int
	config.Pool.QueryRow(context.Background(),
		"SELECT capacity FROM classes WHERE id = $1", classID).Scan(&capacity)

	var currentCount int
	config.Pool.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM class_members WHERE class_id = $1", classID).Scan(&currentCount)

	if capacity > 0 && currentCount+len(body.StudentIDs) > capacity {
		jsonResponse(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"message": fmt.Sprintf("Kapasitas kelas penuh (%d/%d).", currentCount, capacity),
		})
		return
	}

	inserted := 0
	for _, studentID := range body.StudentIDs {
		ct, err := config.Pool.Exec(context.Background(),
			`INSERT INTO class_members (class_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			classID, studentID)
		if err == nil && ct.RowsAffected() > 0 {
			inserted++
		}
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Berhasil memploting %d siswa ke dalam kelas.", inserted),
	})
}

// RemoveClassMember - DELETE /api/admin/classes/:classId/members/:studentId
func RemoveClassMember(w http.ResponseWriter, r *http.Request) {
	classID := chilib.URLParam(r, "classId")
	studentID := chilib.URLParam(r, "studentId")

	rows, err := config.Pool.Query(context.Background(),
		`DELETE FROM class_members WHERE class_id = $1 AND student_id = $2 RETURNING *`,
		classID, studentID)
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"message": "Internal server error",
		})
		return
	}
	row, err := rowToMap(rows)
	if err != nil || row == nil {
		jsonResponse(w, http.StatusNotFound, map[string]interface{}{
			"success": false,
			"message": "Hubungan data siswa dan kelas tidak ditemukan",
		})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Siswa berhasil dikeluarkan dari ruang kelas",
	})
}

// AssignStudentsToClass - POST /api/admin/classes/:classId/assign-students
func AssignStudentsToClass(w http.ResponseWriter, r *http.Request) {
	classID := chilib.URLParam(r, "classId")

	var body struct {
		StudentIDs []int64 `json:"student_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	inserted := 0
	for _, studentID := range body.StudentIDs {
		ct, err := config.Pool.Exec(context.Background(),
			`INSERT INTO class_members (class_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			classID, studentID)
		if err == nil && ct.RowsAffected() > 0 {
			inserted++
		}
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Berhasil memasukkan %d siswa ke dalam kelas.", inserted),
	})
}

// ImportClasses - POST /api/admin/classes/import
func ImportClasses(w http.ResponseWriter, r *http.Request) {
	excelRows, err := readExcelRows(r, "file")
	if err != nil {
		jsonResponse(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"message": "Failed to read Excel file: " + err.Error(),
		})
		return
	}

	academicYearIDStr := r.FormValue("academic_year_id")
	if academicYearIDStr == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"message": "academic_year_id is required",
		})
		return
	}
	academicYearID, err := strconv.Atoi(academicYearIDStr)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid academic_year_id")
		return
	}

	imported := 0
	skipped := 0
	for _, row := range excelRows {
		grade := getColValue(row, "Tingkat", "tingkat", "grade")
		name := getColValue(row, "Nama Kelas", "nama kelas", "name")
		capacityStr := getColValue(row, "Kapasitas", "kapasitas", "capacity")

		if grade == "" || name == "" {
			continue
		}

		capacity := 36
		if c, e := strconv.Atoi(capacityStr); e == nil {
			capacity = c
		}

		// Check duplicate
		var existingID int
		err := config.Pool.QueryRow(context.Background(),
			"SELECT id FROM classes WHERE grade = $1 AND name = $2 AND academic_year_id = $3",
			grade, name, academicYearID).Scan(&existingID)
		if err == nil {
			skipped++
			continue
		}

		_, err = config.Pool.Exec(context.Background(),
			"INSERT INTO classes (academic_year_id, grade, name, capacity) VALUES ($1, $2, $3, $4)",
			academicYearID, grade, name, capacity)
		if err == nil {
			imported++
		}
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Berhasil mengimpor %d kelas. Dilewati: %d kelas duplikat.", imported, skipped),
	})
}

// ImportClassMembers - POST /api/admin/classes/import-members
func ImportClassMembers(w http.ResponseWriter, r *http.Request) {
	excelRows, err := readExcelRows(r, "file")
	if err != nil {
		jsonResponse(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"message": "Failed to read Excel file: " + err.Error(),
		})
		return
	}

	academicYearIDStr := r.FormValue("academic_year_id")
	if academicYearIDStr == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"message": "academic_year_id is required",
		})
		return
	}

	plotted := 0
	skipped := 0
	for _, row := range excelRows {
		grade := getColValue(row, "Tingkat Kelas", "grade")
		className := getColValue(row, "Nama Kelas", "class_name")
		username := getColValue(row, "Username Siswa", "username")

		if grade == "" || className == "" || username == "" {
			continue
		}

		var classID int64
		err := config.Pool.QueryRow(context.Background(),
			"SELECT id FROM classes WHERE grade = $1 AND name = $2 AND academic_year_id = $3",
			grade, className, academicYearIDStr).Scan(&classID)
		if err != nil {
			skipped++
			continue
		}

		var studentID int64
		err = config.Pool.QueryRow(context.Background(),
			"SELECT id FROM users WHERE username = $1 AND role = 'student'", username).Scan(&studentID)
		if err != nil {
			skipped++
			continue
		}

		// Check if already assigned
		var existingClassID int64
		err = config.Pool.QueryRow(context.Background(), `
			SELECT cm.class_id FROM class_members cm
			JOIN classes c ON cm.class_id = c.id
			WHERE cm.student_id = $1 AND c.academic_year_id = $2
		`, studentID, academicYearIDStr).Scan(&existingClassID)
		if err == nil {
			skipped++
			continue
		}

		ct, err := config.Pool.Exec(context.Background(),
			"INSERT INTO class_members (class_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
			classID, studentID)
		if err == nil && ct.RowsAffected() > 0 {
			plotted++
		} else {
			skipped++
		}
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Berhasil plotting %d siswa. Dilewati: %d siswa (Sudah punya kelas).", plotted, skipped),
	})
}

// suppress unused import warning
var _ = strings.Contains
