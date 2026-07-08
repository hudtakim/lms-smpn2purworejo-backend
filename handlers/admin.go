package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"lms-backend-go/config"
	"lms-backend-go/middleware"
	"syscall"

	chilib "github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/xuri/excelize/v2"
	"golang.org/x/crypto/bcrypt"
)

// ---------- helper: scan rows to []map[string]interface{} ----------

func rowsToMaps(rows pgx.Rows) ([]map[string]interface{}, error) {
	defer rows.Close()
	fds := rows.FieldDescriptions()
	var result []map[string]interface{}
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		m := make(map[string]interface{})
		for i, fd := range fds {
			m[string(fd.Name)] = vals[i]
		}
		result = append(result, m)
	}
	return result, rows.Err()
}

func rowToMap(rows pgx.Rows) (map[string]interface{}, error) {
	defer rows.Close()
	fds := rows.FieldDescriptions()
	if rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		m := make(map[string]interface{})
		for i, fd := range fds {
			m[string(fd.Name)] = vals[i]
		}
		return m, nil
	}
	return nil, rows.Err()
}

// ---------- helper: read Excel rows as []map[string]string ----------

func readExcelRows(r *http.Request, fieldName string) ([]map[string]string, error) {
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		return nil, err
	}
	file, _, err := r.FormFile(fieldName)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	f, err := excelize.OpenReader(file)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return nil, fmt.Errorf("no sheets")
	}
	excelRowData, err := f.GetRows(sheets[0])
	if err != nil {
		return nil, err
	}
	if len(excelRowData) < 2 {
		return nil, nil
	}

	headers := excelRowData[0]
	var result []map[string]string
	for _, row := range excelRowData[1:] {
		m := make(map[string]string)
		for i, h := range headers {
			if i < len(row) {
				m[strings.TrimSpace(h)] = strings.TrimSpace(row[i])
			} else {
				m[strings.TrimSpace(h)] = ""
			}
		}
		result = append(result, m)
	}
	return result, nil
}

// ===== USERS =====

func GetUsers(w http.ResponseWriter, r *http.Request) {
	role := r.URL.Query().Get("role")
	search := r.URL.Query().Get("search")
	pageStr := r.URL.Query().Get("page")
	limitStr := r.URL.Query().Get("limit")

	page := 1
	limit := 10
	if p, err := strconv.Atoi(pageStr); err == nil && p > 0 {
		page = p
	}
	if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
		limit = l
	}

	baseQuery := "SELECT id, username, full_name, role, is_active, gender, religion FROM users WHERE 1=1"
	countQuery := "SELECT COUNT(*) FROM users WHERE 1=1"
	args := []interface{}{}
	argN := 1

	if role != "" && role != "all" {
		baseQuery += fmt.Sprintf(" AND role = $%d", argN)
		countQuery += fmt.Sprintf(" AND role = $%d", argN)
		args = append(args, role)
		argN++
	}
	if search != "" {
		baseQuery += fmt.Sprintf(" AND (full_name ILIKE $%d OR username ILIKE $%d)", argN, argN)
		countQuery += fmt.Sprintf(" AND (full_name ILIKE $%d OR username ILIKE $%d)", argN, argN)
		args = append(args, "%"+search+"%")
		argN++
	}

	var total int
	if err := config.Pool.QueryRow(context.Background(), countQuery, args...).Scan(&total); err != nil {
		serverError(w, r, err, "Internal server error")
		return
	}

	offset := (page - 1) * limit
	dataQuery := baseQuery + fmt.Sprintf(" ORDER BY full_name ASC LIMIT $%d OFFSET $%d", argN, argN+1)
	dataArgs := append(args, limit, offset)

	rows, err := config.Pool.Query(context.Background(), dataQuery, dataArgs...)
	if err != nil {
		serverError(w, r, err, "Internal server error")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Internal server error")
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}

	pages := int(math.Ceil(float64(total) / float64(limit)))

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"data":  data,
		"total": total,
		"pages": pages,
	})
}

func CreateUser(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		FullName string `json:"full_name"`
		Role     string `json:"role"`
		Gender   string `json:"gender"`
		Religion string `json:"religion"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(body.Password), 10)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}

	rows, err := config.Pool.Query(context.Background(),
		`INSERT INTO users (username, password, full_name, role, gender, religion, is_active)
		 VALUES ($1, $2, $3, $4, $5, $6, true)
		 RETURNING id, username, full_name, role, gender, religion`,
		body.Username, string(hashed), body.FullName, body.Role, body.Gender, body.Religion)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	row, err := rowToMap(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusCreated, row)
}

func UpdateUser(w http.ResponseWriter, r *http.Request) {
	idStr := chilib.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid ID")
		return
	}

	var body struct {
		Username string  `json:"username"`
		FullName string  `json:"full_name"`
		Role     string  `json:"role"`
		IsActive bool    `json:"is_active"`
		Password *string `json:"password"`
		Gender   string  `json:"gender"`
		Religion string  `json:"religion"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	var rows pgx.Rows
	if body.Password != nil && *body.Password != "" {
		hashed, err := bcrypt.GenerateFromPassword([]byte(*body.Password), 10)
		if err != nil {
			serverError(w, r, err, "Server error")
			return
		}
		rows, err = config.Pool.Query(context.Background(),
			`UPDATE users SET username=$1, full_name=$2, role=$3, is_active=$4, gender=$5, religion=$6, password=$7
			 WHERE id=$8
			 RETURNING id, username, full_name, role, is_active, gender, religion`,
			body.Username, body.FullName, body.Role, body.IsActive, body.Gender, body.Religion, string(hashed), id)
		if err != nil {
			serverError(w, r, err, "Server error")
			return
		}
	} else {
		rows, err = config.Pool.Query(context.Background(),
			`UPDATE users SET username=$1, full_name=$2, role=$3, is_active=$4, gender=$5, religion=$6
			 WHERE id=$7
			 RETURNING id, username, full_name, role, is_active, gender, religion`,
			body.Username, body.FullName, body.Role, body.IsActive, body.Gender, body.Religion, id)
		if err != nil {
			serverError(w, r, err, "Server error")
			return
		}
	}
	row, err := rowToMap(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusOK, row)
}

func DeleteUser(w http.ResponseWriter, r *http.Request) {
	idStr := chilib.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid ID")
		return
	}

	_, err = config.Pool.Exec(context.Background(), "DELETE FROM users WHERE id = $1", id)
	if err != nil {
		serverError(w, r, err, "Tidak bisa menghapus user yang sudah memiliki riwayat data akademik.")
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{"message": "User berhasil dihapus dari sistem."})
}

func ToggleUserStatus(w http.ResponseWriter, r *http.Request) {
	idStr := chilib.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid ID")
		return
	}

	var body struct {
		IsActive bool `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	rows, err := config.Pool.Query(context.Background(),
		"UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, username, is_active",
		body.IsActive, id)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	row, err := rowToMap(rows)
	if err != nil || row == nil {
		jsonError(w, http.StatusNotFound, "User tidak ditemukan.")
		return
	}

	status := "Nonaktif"
	if body.IsActive {
		status = "Aktif"
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"message": fmt.Sprintf("Status user berhasil diubah menjadi %s.", status),
		"user":    row,
	})
}

func ImportUsers(w http.ResponseWriter, r *http.Request) {
	excelRows, err := readExcelRows(r, "file")
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Failed to read Excel file: "+err.Error())
		return
	}

	for _, row := range excelRows {
		username := getColValue(row, "username", "Username")
		password := getColValue(row, "password", "Password")
		fullName := getColValue(row, "full_name", "Full Name", "full name", "Nama Lengkap")
		role := strings.ToLower(getColValue(row, "role", "Role"))
		gender := getColValue(row, "gender", "Gender", "Jenis Kelamin")
		religion := strings.ToLower(getColValue(row, "religion", "Religion", "Agama"))

		if username == "" || password == "" || fullName == "" || role == "" {
			continue
		}

		hashed, err := bcrypt.GenerateFromPassword([]byte(password), 10)
		if err != nil {
			continue
		}

		config.Pool.Exec(context.Background(),
			`INSERT INTO users (username, password, full_name, role, gender, religion)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 ON CONFLICT (username) DO NOTHING`,
			username, string(hashed), fullName, role, nullableStr(gender), nullableStr(religion))
	}

	jsonResponse(w, http.StatusOK, map[string]string{
		"message": fmt.Sprintf("Berhasil memproses %d data user.", len(excelRows)),
	})
}

// ===== ROOMS =====

func GetRooms(w http.ResponseWriter, r *http.Request) {
	rows, err := config.Pool.Query(context.Background(),
		"SELECT * FROM rooms ORDER BY room_name ASC")
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, data)
}

func CreateRoom(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RoomName string `json:"room_name"`
		Capacity int    `json:"capacity"`
		RoomType string `json:"room_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	rows, err := config.Pool.Query(context.Background(),
		"INSERT INTO rooms (room_name, capacity, room_type) VALUES ($1, $2, $3) RETURNING *",
		body.RoomName, body.Capacity, body.RoomType)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	row, err := rowToMap(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusCreated, row)
}

func ImportRooms(w http.ResponseWriter, r *http.Request) {
	excelRows, err := readExcelRows(r, "file")
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Failed to read Excel file: "+err.Error())
		return
	}

	count := 0
	for _, row := range excelRows {
		roomName := getColValue(row, "room_name", "Room Name", "Nama Ruangan", "nama ruangan")
		capacityStr := getColValue(row, "capacity", "Capacity", "Kapasitas")
		roomType := getColValue(row, "room_type", "Room Type", "Tipe Ruangan")
		capacity := 0
		if c, err := strconv.Atoi(capacityStr); err == nil {
			capacity = c
		}
		if roomName == "" {
			continue
		}
		_, err := config.Pool.Exec(context.Background(),
			"INSERT INTO rooms (room_name, capacity, room_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
			roomName, capacity, roomType)
		if err == nil {
			count++
		}
	}

	jsonResponse(w, http.StatusOK, map[string]string{
		"message": fmt.Sprintf("Berhasil mengimpor %d ruangan.", count),
	})
}

// ===== ACADEMIC YEARS =====

func GetAcademicYears(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	query := "SELECT * FROM academic_years ORDER BY id DESC"
	if claims != nil && claims.Role != "admin" {
		query += " LIMIT 6"
	}

	rows, err := config.Pool.Query(context.Background(), query)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, data)
}

func CreateAcademicYear(w http.ResponseWriter, r *http.Request) {
	var body struct {
		YearName string `json:"year_name"`
		Semester string `json:"semester"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	rows, err := config.Pool.Query(context.Background(),
		"INSERT INTO academic_years (year_name, semester) VALUES ($1, $2) RETURNING *",
		body.YearName, body.Semester)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	row, err := rowToMap(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusCreated, row)
}

func ActivateAcademicYear(w http.ResponseWriter, r *http.Request) {
	idStr := chilib.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid ID")
		return
	}

	tx, err := config.Pool.Begin(context.Background())
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	defer tx.Rollback(context.Background())

	if _, err = tx.Exec(context.Background(), "UPDATE academic_years SET is_active = false"); err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	if _, err = tx.Exec(context.Background(), "UPDATE academic_years SET is_active = true WHERE id = $1", id); err != nil {
		serverError(w, r, err, "Server error")
		return
	}

	if err = tx.Commit(context.Background()); err != nil {
		serverError(w, r, err, "Server error")
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{"message": "Semester aktif telah diperbarui."})
}

// ===== SUBJECTS =====

func GetSubjects(w http.ResponseWriter, r *http.Request) {
	academicYearID := r.URL.Query().Get("academic_year_id")

	var rows pgx.Rows
	var err error
	if academicYearID != "" {
		rows, err = config.Pool.Query(context.Background(),
			"SELECT * FROM subjects WHERE academic_year_id = $1 ORDER BY subject_name ASC", academicYearID)
	} else {
		rows, err = config.Pool.Query(context.Background(),
			"SELECT * FROM subjects ORDER BY subject_name ASC")
	}
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, data)
}

func CreateSubject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AcademicYearID int     `json:"academic_year_id"`
		SubjectCode    string  `json:"subject_code"`
		SubjectName    string  `json:"subject_name"`
		Grade          string  `json:"grade"`
		KKM            float64 `json:"kkm"`
		TargetJP       int     `json:"target_jp"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if body.AcademicYearID == 0 || body.SubjectCode == "" || body.SubjectName == "" || body.Grade == "" {
		jsonError(w, http.StatusBadRequest, "Data wajib diisi (termasuk Tahun Ajaran)!")
		return
	}

	body.SubjectCode = strings.ToUpper(strings.TrimSpace(body.SubjectCode))

	var existingID int
	err := config.Pool.QueryRow(context.Background(),
		"SELECT id FROM subjects WHERE UPPER(subject_code) = $1 AND academic_year_id = $2",
		body.SubjectCode, body.AcademicYearID).Scan(&existingID)
	if err == nil {
		jsonError(w, http.StatusBadRequest, "Kode sudah digunakan di tahun ajaran ini!")
		return
	}

	rows, err := config.Pool.Query(context.Background(),
		`INSERT INTO subjects (academic_year_id, subject_code, subject_name, grade, kkm, target_jp, is_active)
		 VALUES ($1, $2, $3, $4, $5, $6, TRUE)
		 RETURNING *`,
		body.AcademicYearID, body.SubjectCode, body.SubjectName, body.Grade, body.KKM, body.TargetJP)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	row, err := rowToMap(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusCreated, row)
}

func UpdateSubject(w http.ResponseWriter, r *http.Request) {
	idStr := chilib.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid ID")
		return
	}

	var body struct {
		AcademicYearID int     `json:"academic_year_id"`
		SubjectCode    string  `json:"subject_code"`
		SubjectName    string  `json:"subject_name"`
		Grade          string  `json:"grade"`
		KKM            float64 `json:"kkm"`
		TargetJP       int     `json:"target_jp"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	body.SubjectCode = strings.ToUpper(strings.TrimSpace(body.SubjectCode))

	var existingID int
	err = config.Pool.QueryRow(context.Background(),
		"SELECT id FROM subjects WHERE UPPER(subject_code) = $1 AND academic_year_id = $2 AND id != $3",
		body.SubjectCode, body.AcademicYearID, id).Scan(&existingID)
	if err == nil {
		jsonError(w, http.StatusBadRequest, "Kode digunakan mapel lain di tahun ajaran ini!")
		return
	}

	rows, err := config.Pool.Query(context.Background(),
		`UPDATE subjects SET academic_year_id=$1, subject_code=$2, subject_name=$3, grade=$4, kkm=$5, target_jp=$6
		 WHERE id=$7 RETURNING *`,
		body.AcademicYearID, body.SubjectCode, body.SubjectName, body.Grade, body.KKM, body.TargetJP, id)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	row, err := rowToMap(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusOK, row)
}

func ToggleSubject(w http.ResponseWriter, r *http.Request) {
	idStr := chilib.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid ID")
		return
	}

	var isActive bool
	err = config.Pool.QueryRow(context.Background(),
		"SELECT is_active FROM subjects WHERE id = $1", id).Scan(&isActive)
	if err != nil {
		jsonError(w, http.StatusNotFound, "Mata pelajaran tidak ditemukan")
		return
	}

	newState := !isActive
	_, err = config.Pool.Exec(context.Background(),
		"UPDATE subjects SET is_active = $1 WHERE id = $2", newState, id)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}

	msg := "dinonaktifkan"
	if newState {
		msg = "diaktifkan"
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Mata pelajaran berhasil %s", msg),
	})
}

func ImportSubjects(w http.ResponseWriter, r *http.Request) {
	excelRows, err := readExcelRows(r, "file")
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Failed to read Excel file: "+err.Error())
		return
	}

	academicYearIDStr := r.FormValue("academic_year_id")
	if academicYearIDStr == "" {
		jsonError(w, http.StatusBadRequest, "academic_year_id is required")
		return
	}
	academicYearID, err := strconv.Atoi(academicYearIDStr)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid academic_year_id")
		return
	}

	count := 0
	for _, row := range excelRows {
		subjectCode := getColValue(row, "Kode Mapel", "subject_code", "kode mapel", "kode_mapel")
		subjectName := getColValue(row, "Nama Mapel", "subject_name", "nama mapel", "nama_mapel")
		grade := getColValue(row, "Kelas", "grade", "kelas")
		targetJPStr := getColValue(row, "Target JP", "target_jp", "target jp")
		kkmStr := getColValue(row, "KKM", "kkm")

		if subjectCode == "" || subjectName == "" || grade == "" {
			continue
		}
		subjectCode = strings.ToUpper(strings.TrimSpace(subjectCode))

		var existingID int
		err := config.Pool.QueryRow(context.Background(),
			"SELECT id FROM subjects WHERE UPPER(subject_code) = $1 AND academic_year_id = $2",
			subjectCode, academicYearID).Scan(&existingID)
		if err == nil {
			continue
		}

		targetJP := 0
		if v, e := strconv.Atoi(targetJPStr); e == nil {
			targetJP = v
		}
		kkm := 75.0
		if v, e := strconv.ParseFloat(kkmStr, 64); e == nil {
			kkm = v
		}

		_, err = config.Pool.Exec(context.Background(),
			`INSERT INTO subjects (academic_year_id, subject_code, subject_name, grade, kkm, target_jp, is_active)
			 VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
			academicYearID, subjectCode, subjectName, grade, kkm, targetJP)
		if err == nil {
			count++
		}
	}

	jsonResponse(w, http.StatusOK, map[string]string{
		"message": fmt.Sprintf("Berhasil mengimpor %d mata pelajaran baru.", count),
	})
}

// ===== CLASS SUBJECTS =====

func GetClassSubjects(w http.ResponseWriter, r *http.Request) {
	academicYearID := r.URL.Query().Get("academic_year_id")

	if academicYearID == "" {
		jsonError(w, http.StatusBadRequest, "Academic year ID (semester) wajib disertakan.")
		return
	}

	rows, err := config.Pool.Query(context.Background(), `
		SELECT
			cs.id,
			cs.subject_id,
			cs.teacher_id,
			cs.academic_year_id,
			s.subject_name,
			s.subject_code,
			u.full_name as teacher_name
		FROM class_subjects cs
		JOIN subjects s ON cs.subject_id = s.id
		JOIN users u ON cs.teacher_id = u.id
		WHERE cs.academic_year_id = $1
		ORDER BY s.subject_name ASC
	`, academicYearID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, data)
}

func CreateClassSubject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SubjectID      int `json:"subject_id"`
		TeacherID      int `json:"teacher_id"`
		AcademicYearID int `json:"academic_year_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if body.SubjectID == 0 || body.TeacherID == 0 || body.AcademicYearID == 0 {
		jsonError(w, http.StatusBadRequest, "Semua field data plotting wajib diisi.")
		return
	}

	var role string
	err := config.Pool.QueryRow(context.Background(),
		"SELECT role FROM users WHERE id = $1", body.TeacherID).Scan(&role)
	if err != nil || role == "student" {
		jsonError(w, http.StatusBadRequest, "User yang dipilih harus merupakan seorang Guru/Pengajar.")
		return
	}

	var existingID int
	err = config.Pool.QueryRow(context.Background(),
		"SELECT id FROM class_subjects WHERE subject_id=$1 AND teacher_id=$2 AND academic_year_id=$3",
		body.SubjectID, body.TeacherID, body.AcademicYearID).Scan(&existingID)
	if err == nil {
		jsonError(w, http.StatusBadRequest, "Gagal! Guru tersebut sudah diplot untuk mata pelajaran ini di semester yang sama.")
		return
	}

	rows, err := config.Pool.Query(context.Background(),
		`INSERT INTO class_subjects (subject_id, teacher_id, academic_year_id)
		 VALUES ($1, $2, $3)
		 RETURNING *`,
		body.SubjectID, body.TeacherID, body.AcademicYearID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	row, err := rowToMap(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusCreated, map[string]interface{}{
		"message": "Mata pelajaran dan pengajar berhasil diplot.",
		"data":    row,
	})
}

func DeleteClassSubject(w http.ResponseWriter, r *http.Request) {
	idStr := chilib.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid ID")
		return
	}

	var scheduleID int
	err = config.Pool.QueryRow(context.Background(),
		"SELECT id FROM schedules WHERE class_subject_id = $1 LIMIT 1", id).Scan(&scheduleID)
	if err == nil {
		jsonError(w, http.StatusBadRequest, "Gagal menghapus! Pastikan tidak ada jadwal kelas yang masih menggunakan mapel ini, atau hapus jadwalnya di kalender terlebih dahulu.")
		return
	}

	_, err = config.Pool.Exec(context.Background(), "DELETE FROM class_subjects WHERE id = $1", id)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"message": "Plotting mata pelajaran berhasil dihapus."})
}

// ===== SCHEDULES =====

func GetClassSchedules(w http.ResponseWriter, r *http.Request) {
	academicYearID := r.URL.Query().Get("academic_year_id")
	if academicYearID == "" {
		jsonResponse(w, http.StatusOK, []interface{}{})
		return
	}

	rows, err := config.Pool.Query(context.Background(), `
		SELECT
			sch.id as schedule_id,
			sch.day_of_week,
			sch.slot_number,
			cs.id as class_subject_id,
			cs.teacher_id,
			s.subject_name,
			s.subject_code,
			u.full_name as teacher_name,
			sch.class_id
		FROM schedules sch
		JOIN class_subjects cs ON sch.class_subject_id = cs.id
		JOIN subjects s ON cs.subject_id = s.id
		JOIN users u ON cs.teacher_id = u.id
		WHERE cs.academic_year_id = $1
		ORDER BY
		CASE sch.day_of_week
			WHEN 'Senin' THEN 1
			WHEN 'Selasa' THEN 2
			WHEN 'Rabu' THEN 3
			WHEN 'Kamis' THEN 4
			WHEN 'Jumat' THEN 5
			WHEN 'Sabtu' THEN 6
			ELSE 7
		END, sch.slot_number ASC
	`, academicYearID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, data)
}

func CreateSchedule(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ClassID        int    `json:"class_id"`
		ClassSubjectID int    `json:"class_subject_id"`
		DayOfWeek      string `json:"day_of_week"`
		SlotNumber     int    `json:"slot_number"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if body.ClassSubjectID == 0 || body.DayOfWeek == "" || body.SlotNumber == 0 {
		jsonError(w, http.StatusBadRequest, "Semua data komponen jadwal (Mapel, Hari, dan Slot) wajib diisi.")
		return
	}

	var teacherID, academicYearID int
	err := config.Pool.QueryRow(context.Background(),
		"SELECT teacher_id, academic_year_id FROM class_subjects WHERE id = $1",
		body.ClassSubjectID).Scan(&teacherID, &academicYearID)
	if err != nil {
		jsonError(w, http.StatusNotFound, "Data pengampu mata pelajaran tidak ditemukan.")
		return
	}

	var conflictSubject, conflictGrade, conflictClass string
	err = config.Pool.QueryRow(context.Background(), `
		SELECT
			sub.subject_name,
			c.grade,
			c.name AS class_name
		FROM schedules s
		JOIN class_subjects cs ON s.class_subject_id = cs.id
		JOIN subjects sub ON cs.subject_id = sub.id
		JOIN classes c ON s.class_id = c.id
		WHERE cs.teacher_id = $1
		  AND cs.academic_year_id = $2
		  AND s.day_of_week = $3
		  AND s.slot_number = $4
	`, teacherID, academicYearID, body.DayOfWeek, body.SlotNumber).Scan(
		&conflictSubject, &conflictGrade, &conflictClass)
	if err == nil {
		jsonError(w, http.StatusBadRequest, fmt.Sprintf(
			"Gagal! Guru tersebut sudah mengajar mapel [%s] di KELAS %s %s pada hari %s (Slot ke-%d).",
			conflictSubject, conflictGrade, conflictClass, body.DayOfWeek, body.SlotNumber))
		return
	}

	rows, err := config.Pool.Query(context.Background(),
		`INSERT INTO schedules (class_id, class_subject_id, day_of_week, slot_number, academic_year_id)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING *`,
		body.ClassID, body.ClassSubjectID, body.DayOfWeek, body.SlotNumber, academicYearID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	row, err := rowToMap(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusCreated, map[string]interface{}{
		"message": "Jadwal pelajaran berhasil ditambahkan.",
		"data":    row,
	})
}

func DeleteSchedule(w http.ResponseWriter, r *http.Request) {
	idStr := chilib.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid ID")
		return
	}

	_, err = config.Pool.Exec(context.Background(), "DELETE FROM schedules WHERE id = $1", id)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"message": "Jadwal pelajaran berhasil dihapus."})
}

// ===== TIME SLOTS =====

func GetTimeSlots(w http.ResponseWriter, r *http.Request) {
	academicYearID := r.URL.Query().Get("academic_year_id")
	if academicYearID == "" {
		jsonResponse(w, http.StatusOK, []interface{}{})
		return
	}

	rows, err := config.Pool.Query(context.Background(),
		`SELECT * FROM global_time_slots WHERE academic_year_id = $1
		 ORDER BY day_of_week ASC, slot_number ASC`, academicYearID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, data)
}

func CreateTimeSlot(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DayOfWeek             string `json:"day_of_week"`
		SlotNumber            int    `json:"slot_number"`
		SlotType              string `json:"slot_type"`
		LabelName             string `json:"label_name"`
		CustomDurationMinutes *int   `json:"custom_duration_minutes"`
		AcademicYearID        int    `json:"academic_year_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if body.DayOfWeek == "" || body.SlotNumber == 0 || body.SlotType == "" || body.AcademicYearID == 0 {
		jsonError(w, http.StatusBadRequest, "Field utama rangka acuan wajib diisi.")
		return
	}

	var customDur *int
	if body.SlotType == "custom" {
		customDur = body.CustomDurationMinutes
	}

	rows, err := config.Pool.Query(context.Background(), `
		INSERT INTO global_time_slots (day_of_week, slot_number, slot_type, label_name, custom_duration_minutes, academic_year_id)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (day_of_week, slot_number, academic_year_id)
		DO UPDATE SET slot_type = $3, label_name = $4, custom_duration_minutes = $5
		RETURNING *
	`, body.DayOfWeek, body.SlotNumber, body.SlotType, body.LabelName, customDur, body.AcademicYearID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	row, err := rowToMap(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusOK, row)
}

func DeleteTimeSlot(w http.ResponseWriter, r *http.Request) {
	idStr := chilib.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid ID")
		return
	}

	var body struct {
		AcademicYearID int `json:"academic_year_id"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	rows, err := config.Pool.Query(context.Background(),
		"SELECT * FROM global_time_slots WHERE id = $1", id)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	slot, err := rowToMap(rows)
	if err != nil || slot == nil {
		jsonError(w, http.StatusNotFound, "Time slot not found")
		return
	}

	dayName := ""
	switch v := slot["day_of_week"].(type) {
	case int64:
		dayName = dayIntToName(int(v))
	case int32:
		dayName = dayIntToName(int(v))
	case string:
		dayName = v
	}

	slotNumber := int64(0)
	switch v := slot["slot_number"].(type) {
	case int64:
		slotNumber = v
	case int32:
		slotNumber = int64(v)
	}

	academicYearID := body.AcademicYearID
	if academicYearID == 0 {
		if v, ok := slot["academic_year_id"].(int64); ok {
			academicYearID = int(v)
		}
	}

	var scheduleID int
	err = config.Pool.QueryRow(context.Background(),
		`SELECT id FROM schedules WHERE slot_number = $1 AND day_of_week = $2 AND academic_year_id = $3 LIMIT 1`,
		slotNumber, dayName, academicYearID).Scan(&scheduleID)
	if err == nil {
		jsonError(w, http.StatusBadRequest, "Gagal menghapus! Pastikan tidak ada jadwal kelas yang masih menggunakan slot ini, atau hapus jadwalnya di kalender terlebih dahulu.")
		return
	}

	_, err = config.Pool.Exec(context.Background(), "DELETE FROM global_time_slots WHERE id = $1", id)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{
		"message": "Slot waktu harian berhasil dihapus dari acuan dasar.",
	})
}

// ===== DAY SETTINGS =====

func GetDaySettings(w http.ResponseWriter, r *http.Request) {
	rows, err := config.Pool.Query(context.Background(),
		"SELECT day_of_week, TO_CHAR(start_time_school, 'HH24:MI:SS') as start_time_school, kbm_duration_minutes FROM day_var_global ORDER BY day_of_week ASC")
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, data)
}

func UpdateDaySettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DayOfWeek          int    `json:"day_of_week"`
		StartTimeSchool    string `json:"start_time_school"`
		KBMDurationMinutes *int   `json:"kbm_duration_minutes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if body.KBMDurationMinutes != nil {
		_, _ = config.Pool.Exec(context.Background(),
			"UPDATE day_var_global SET kbm_duration_minutes = $1, updated_at = CURRENT_TIMESTAMP",
			*body.KBMDurationMinutes)
	}

	rows, err := config.Pool.Query(context.Background(),
		`UPDATE day_var_global SET start_time_school = $1, updated_at = CURRENT_TIMESTAMP
		 WHERE day_of_week = $2 RETURNING *`,
		body.StartTimeSchool, body.DayOfWeek)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	row, err := rowToMap(rows)
	if err != nil || row == nil {
		jsonResponse(w, http.StatusNotFound, map[string]string{"message": "Hari tidak valid."})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"message": "Pengaturan berhasil diperbarui!",
		"data":    row,
	})
}

// ===== KKM SETTINGS =====

func GetKKMSettings(w http.ResponseWriter, r *http.Request) {
	academicYearID := r.URL.Query().Get("academic_year_id")
	if academicYearID == "" {
		jsonError(w, http.StatusBadRequest, "Parameter academic_year_id diperlukan.")
		return
	}

	var defaultKKM float64
	err := config.Pool.QueryRow(context.Background(),
		"SELECT default_kkm FROM academic_year_kkm WHERE academic_year_id = $1 LIMIT 1",
		academicYearID).Scan(&defaultKKM)
	if err != nil {
		defaultKKM = 75.0
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{"default_kkm": defaultKKM})
}

func UpdateKKMSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DefaultKKM     json.Number `json:"default_kkm"`
		AcademicYearID int         `json:"academic_year_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if body.AcademicYearID == 0 {
		jsonError(w, http.StatusBadRequest, "Parameter academic_year_id diperlukan.")
		return
	}
	defaultKKM, _ := body.DefaultKKM.Float64()

	_, err := config.Pool.Exec(context.Background(), `
		INSERT INTO academic_year_kkm (academic_year_id, default_kkm, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (academic_year_id)
		DO UPDATE SET default_kkm = EXCLUDED.default_kkm, updated_at = NOW()
	`, body.AcademicYearID, defaultKKM)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"message": "Default KKM berhasil diperbarui!"})
}

// ===== SYSTEM TELEMETRY =====

func GetSystemTelemetry(w http.ResponseWriter, r *http.Request) {
	rows, err := config.Pool.Query(context.Background(),
		"SELECT role, COUNT(*) as active_count FROM users WHERE is_active = true GROUP BY role")
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	roleStats := make(map[string]int64)
	totalActiveUsers := int64(0)
	for rows.Next() {
		var role string
		var count int64
		rows.Scan(&role, &count)
		roleStats[role] = count
		totalActiveUsers += count
	}
	rows.Close()

	var totalClasses int64
	config.Pool.QueryRow(context.Background(), "SELECT COUNT(*) FROM classes").Scan(&totalClasses)

	var dbSizeBytes int64
	config.Pool.QueryRow(context.Background(),
		"SELECT pg_database_size(current_database()) AS size_bytes").Scan(&dbSizeBytes)

	var uploadsSizeBytes int64
	filepath.Walk("./uploads", func(path string, info fs.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			uploadsSizeBytes += info.Size()
		}
		return nil
	})

	var sysInfo syscall.Sysinfo_t
	syscall.Sysinfo(&sysInfo)
	totalMem := float64(sysInfo.Totalram) * float64(sysInfo.Unit)
	freeMem := float64(sysInfo.Freeram) * float64(sysInfo.Unit)
	ramUsagePct := int(math.Round((totalMem - freeMem) / totalMem * 100))

	cpuLoadPct := 12
	if data, err := os.ReadFile("/proc/loadavg"); err == nil {
		fields := strings.Fields(string(data))
		if len(fields) > 0 {
			if load, err := strconv.ParseFloat(fields[0], 64); err == nil {
				calc := int(math.Min(math.Round(load*100), 100))
				if calc > 0 {
					cpuLoadPct = calc
				}
			}
		}
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"totalActiveUsers": totalActiveUsers,
		"roleStats":        roleStats,
		"totalClasses":     totalClasses,
		"dbSize":           formatFileSize(dbSizeBytes),
		"uploadsSize":      formatFileSize(uploadsSizeBytes),
		"ramUsage":         ramUsagePct,
		"cpuLoad":          cpuLoadPct,
	})
}

// ===== SYSTEM BACKUP =====

func GetSystemBackup(w http.ResponseWriter, r *http.Request) {
	tables := []string{
		"academic_year_kkm", "academic_years", "app_settings", "class_members",
		"class_subjects", "classes", "day_var_global", "global_time_slots",
		"materials", "quiz_scores", "quizzes", "rooms", "schedules", "subjects",
		"task_scores", "tasks", "teaching_documents", "teaching_journals",
		"teaching_schedules", "time_slots", "users",
	}

	backup := map[string]interface{}{
		"backup_metadata": map[string]interface{}{
			"exported_at":            time.Now().Format(time.RFC3339),
			"database_name":          "spero_lms_db",
			"total_tables_backed_up": len(tables),
			"system_version":         "SMPN2_Purworejo LMS v1.0-Production",
		},
	}

	for _, table := range tables {
		rows, err := config.Pool.Query(context.Background(), fmt.Sprintf("SELECT * FROM %s", table))
		if err != nil {
			backup[table] = []interface{}{}
			continue
		}
		data, err := rowsToMaps(rows)
		if err != nil || data == nil {
			backup[table] = []interface{}{}
		} else {
			backup[table] = data
		}
	}

	dateStr := time.Now().Format("2006-01-02")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="DB_SMPN2-PWRJ_LMS_FULL_Backup_%s.json"`, dateStr))

	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.Encode(backup)
}

// ===== MAINTENANCE =====

func DeleteAcademicYearData(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AcademicYearID int `json:"academic_year_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.AcademicYearID == 0 {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"message": "ID Tahun Ajaran wajib diisi!"})
		return
	}

	var yearName string
	var isActive bool
	err := config.Pool.QueryRow(context.Background(),
		"SELECT year_name, is_active FROM academic_years WHERE id = $1",
		body.AcademicYearID).Scan(&yearName, &isActive)
	if err != nil {
		jsonError(w, http.StatusNotFound, "Academic year not found")
		return
	}
	if isActive {
		jsonResponse(w, http.StatusBadRequest, map[string]string{
			"message": fmt.Sprintf("Tahun ajaran %s sedang AKTIF! Nonaktifkan terlebih dahulu.", yearName),
		})
		return
	}

	fileURLRows, _ := config.Pool.Query(context.Background(), `
		SELECT file_url FROM materials m JOIN classes c ON m.class_id = c.id WHERE c.academic_year_id = $1 AND m.file_url IS NOT NULL AND m.file_url != ''
		UNION
		SELECT file_url FROM tasks t JOIN classes c ON t.class_id = c.id WHERE c.academic_year_id = $1 AND t.file_url IS NOT NULL AND t.file_url != ''
		UNION
		SELECT file_url FROM teaching_documents WHERE academic_year_id = $1 AND file_url IS NOT NULL AND file_url != ''
	`, body.AcademicYearID)

	var fileURLs []string
	if fileURLRows != nil {
		for fileURLRows.Next() {
			var url string
			fileURLRows.Scan(&url)
			fileURLs = append(fileURLs, url)
		}
		fileURLRows.Close()
	}

	tx, err := config.Pool.Begin(context.Background())
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	defer tx.Rollback(context.Background())

	tx.Exec(context.Background(), `DELETE FROM classes WHERE academic_year_id = $1`, body.AcademicYearID)
	tx.Exec(context.Background(), `DELETE FROM teaching_documents WHERE academic_year_id = $1`, body.AcademicYearID)
	tx.Exec(context.Background(), `DELETE FROM schedules WHERE class_id IN (SELECT id FROM classes WHERE academic_year_id = $1)`, body.AcademicYearID)
	tx.Exec(context.Background(), `DELETE FROM class_subjects WHERE academic_year_id = $1`, body.AcademicYearID)
	tx.Exec(context.Background(), `DELETE FROM class_members WHERE class_id IN (SELECT id FROM classes WHERE academic_year_id = $1)`, body.AcademicYearID)
	tx.Exec(context.Background(), `DELETE FROM classes WHERE academic_year_id = $1`, body.AcademicYearID)
	tx.Exec(context.Background(), `DELETE FROM academic_years WHERE id = $1`, body.AcademicYearID)

	if err = tx.Commit(context.Background()); err != nil {
		serverError(w, r, err, "Server error")
		return
	}

	deletedCount := 0
	for _, url := range fileURLs {
		os.Remove("." + url)
		deletedCount++
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"message":             "Seluruh data tahun ajaran dan file terkait berhasil dihapus bersih.",
		"deleted_files_count": deletedCount,
	})
}

func DeleteUsersData(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Role    string `json:"role"`
		MaxDate string `json:"max_date"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Role == "" || body.MaxDate == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"message": "Role dan Tanggal Batas (max_date) wajib diisi!"})
		return
	}

	rows, err := config.Pool.Query(context.Background(),
		"SELECT id FROM users WHERE role = $1 AND created_at < $2",
		body.Role, body.MaxDate)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}

	var userIDs []int64
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		userIDs = append(userIDs, id)
	}
	rows.Close()

	if len(userIDs) == 0 {
		jsonResponse(w, http.StatusOK, map[string]string{
			"message": "Tidak ada user yang memenuhi kriteria untuk dihapus.",
		})
		return
	}

	tx, err := config.Pool.Begin(context.Background())
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	defer tx.Rollback(context.Background())

	if body.Role == "teacher" {
		var materialCount, docCount int
		tx.QueryRow(context.Background(),
			`SELECT COUNT(*) FROM materials WHERE teacher_id = ANY($1::int[])`, userIDs).Scan(&materialCount)
		tx.QueryRow(context.Background(),
			`SELECT COUNT(*) FROM teaching_documents WHERE teacher_id = ANY($1::int[])`, userIDs).Scan(&docCount)
		if materialCount > 0 || docCount > 0 {
			jsonResponse(w, http.StatusBadRequest, map[string]string{
				"message": "Dibatalkan! Guru yang ditargetkan masih memiliki Materi, Tugas, atau Dokumen. Hapus aset mereka terlebih dahulu.",
			})
			return
		}
		tx.Exec(context.Background(), `DELETE FROM schedules WHERE class_subject_id IN (SELECT id FROM class_subjects WHERE teacher_id = ANY($1::int[]))`, userIDs)
		tx.Exec(context.Background(), `DELETE FROM class_subjects WHERE teacher_id = ANY($1::int[])`, userIDs)
		tx.Exec(context.Background(), `DELETE FROM teaching_journals WHERE teacher_id = ANY($1::int[])`, userIDs)
	} else if body.Role == "student" {
		tx.Exec(context.Background(), `DELETE FROM quiz_scores WHERE student_id = ANY($1::int[])`, userIDs)
		tx.Exec(context.Background(), `DELETE FROM task_scores WHERE student_id = ANY($1::int[])`, userIDs)
		tx.Exec(context.Background(), `DELETE FROM class_members WHERE student_id = ANY($1::int[])`, userIDs)
	}

	ct, err := tx.Exec(context.Background(),
		`DELETE FROM users WHERE id = ANY($1::int[])`, userIDs)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}

	if err = tx.Commit(context.Background()); err != nil {
		serverError(w, r, err, "Server error")
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{
		"message": fmt.Sprintf("Berhasil menghapus %d user dengan role %s.", ct.RowsAffected(), body.Role),
	})
}

// ===== APP SETTINGS =====

func GetAppSettings(w http.ResponseWriter, r *http.Request) {
	rows, err := config.Pool.Query(context.Background(),
		"SELECT setting_key, setting_value FROM app_settings")
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	defer rows.Close()

	result := make(map[string]interface{})
	for rows.Next() {
		var key, value string
		rows.Scan(&key, &value)
		result[key] = value
	}
	jsonResponse(w, http.StatusOK, result)
}

func UpdateAppSettings(w http.ResponseWriter, r *http.Request) {
	var body map[string]string
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	tx, err := config.Pool.Begin(context.Background())
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	defer tx.Rollback(context.Background())

	for key, value := range body {
		tx.Exec(context.Background(),
			"UPDATE app_settings SET setting_value = $1 WHERE setting_key = $2",
			value, key)
	}

	if err = tx.Commit(context.Background()); err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"message": "Pengaturan sistem berhasil diperbarui!"})
}

// ===== PARENTS =====

func GetParentsList(w http.ResponseWriter, r *http.Request) {
	rows, err := config.Pool.Query(context.Background(),
		`SELECT id, username, full_name, gender FROM users
		 WHERE role = 'parent' AND is_active = true
		 ORDER BY full_name ASC`)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
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

func GetParentStudents(w http.ResponseWriter, r *http.Request) {
	parentID := chilib.URLParam(r, "parentId")

	rows, err := config.Pool.Query(context.Background(),
		`SELECT id, username, full_name, gender, religion FROM users
		 WHERE role = 'student' AND parent_id = $1
		 ORDER BY full_name ASC`, parentID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
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

func GetAvailableStudentsForParent(w http.ResponseWriter, r *http.Request) {
	rows, err := config.Pool.Query(context.Background(),
		`SELECT id, username, full_name, gender, religion FROM users
		 WHERE role = 'student' AND is_active = true AND parent_id IS NULL
		 ORDER BY full_name ASC`)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
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

func AssignStudentsToParent(w http.ResponseWriter, r *http.Request) {
	parentID := chilib.URLParam(r, "parentId")

	var body struct {
		StudentIDs []int64 `json:"student_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.StudentIDs) == 0 {
		jsonResponse(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"message": "Pilih minimal satu siswa.",
		})
		return
	}

	_, err := config.Pool.Exec(context.Background(),
		`UPDATE users SET parent_id = $1 WHERE id = ANY($2::int[]) AND role = 'student'`,
		parentID, body.StudentIDs)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Berhasil memploting siswa ke orang tua.",
	})
}

func RemoveStudentFromParent(w http.ResponseWriter, r *http.Request) {
	parentID := chilib.URLParam(r, "parentId")
	studentID := chilib.URLParam(r, "studentId")

	_, err := config.Pool.Exec(context.Background(),
		`UPDATE users SET parent_id = NULL WHERE id = $1 AND parent_id = $2 AND role = 'student'`,
		studentID, parentID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Berhasil mencabut akses orang tua dari siswa.",
	})
}

func ImportParentMapping(w http.ResponseWriter, r *http.Request) {
	excelRows, err := readExcelRows(r, "file")
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Failed to read Excel file: "+err.Error())
		return
	}

	count := 0
	for _, row := range excelRows {
		parentUsername := getColValue(row, "Username Orang Tua", "username orang tua", "parent_username")
		studentUsername := getColValue(row, "Username Siswa", "username siswa", "student_username")
		if parentUsername == "" || studentUsername == "" {
			continue
		}

		var parentID int64
		err := config.Pool.QueryRow(context.Background(),
			"SELECT id FROM users WHERE username = $1 AND role = 'parent'", parentUsername).Scan(&parentID)
		if err != nil {
			continue
		}

		ct, err := config.Pool.Exec(context.Background(),
			"UPDATE users SET parent_id = $1 WHERE username = $2 AND role = 'student'",
			parentID, studentUsername)
		if err == nil && ct.RowsAffected() > 0 {
			count++
		}
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Berhasil mengimpor relasi untuk %d siswa.", count),
	})
}

func AutoGenerateParents(w http.ResponseWriter, r *http.Request) {
	rows, err := config.Pool.Query(context.Background(),
		`SELECT id, username, full_name FROM users WHERE role = 'student' AND parent_id IS NULL AND is_active = true`)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	type student struct {
		ID       int64
		Username string
		FullName string
	}
	var students []student
	for rows.Next() {
		var s student
		rows.Scan(&s.ID, &s.Username, &s.FullName)
		students = append(students, s)
	}
	rows.Close()

	if len(students) == 0 {
		jsonResponse(w, http.StatusOK, map[string]interface{}{
			"success": true,
			"message": "Sempurna! Semua siswa aktif saat ini sudah memiliki relasi akun orang tua.",
		})
		return
	}

	count := 0
	for _, s := range students {
		parentUsername := s.Username + "_ortu"
		hashed, err := bcrypt.GenerateFromPassword([]byte(parentUsername), 10)
		if err != nil {
			continue
		}

		var parentID int64
		err = config.Pool.QueryRow(context.Background(),
			`INSERT INTO users (username, password, full_name, role, is_active)
			 VALUES ($1, $2, $3, 'parent', true)
			 ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
			 RETURNING id`,
			parentUsername, string(hashed), "Orang Tua "+s.FullName).Scan(&parentID)
		if err != nil {
			continue
		}

		config.Pool.Exec(context.Background(),
			"UPDATE users SET parent_id = $1 WHERE id = $2", parentID, s.ID)
		count++
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Berhasil membuat dan menautkan %d akun orang tua baru secara otomatis.", count),
	})
}

// ===== COPY PREVIOUS GLOBAL TIME SLOTS =====

func CopyPreviousTimeSlots(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ToAcademicYearID int `json:"to_academic_year_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ToAcademicYearID == 0 {
		jsonError(w, http.StatusBadRequest, "Tahun ajaran tujuan harus diisi.")
		return
	}

	var existingID int
	err := config.Pool.QueryRow(context.Background(),
		"SELECT id FROM global_time_slots WHERE academic_year_id = $1 LIMIT 1",
		body.ToAcademicYearID).Scan(&existingID)
	if err == nil {
		jsonError(w, http.StatusBadRequest, "Tahun ajaran ini sudah memiliki data slot.")
		return
	}

	var fromID int
	err = config.Pool.QueryRow(context.Background(),
		`SELECT DISTINCT academic_year_id FROM global_time_slots
		 WHERE academic_year_id != $1 ORDER BY academic_year_id DESC LIMIT 1`,
		body.ToAcademicYearID).Scan(&fromID)
	if err != nil {
		jsonError(w, http.StatusNotFound, "Tidak ada data urutan aktivitas dari semester sebelumnya untuk disalin.")
		return
	}

	ct, err := config.Pool.Exec(context.Background(),
		`INSERT INTO global_time_slots (day_of_week, slot_number, slot_type, label_name, custom_duration_minutes, end_time, academic_year_id)
		 SELECT day_of_week, slot_number, slot_type, label_name, custom_duration_minutes, end_time, $1
		 FROM global_time_slots WHERE academic_year_id = $2`,
		body.ToAcademicYearID, fromID)
	if err != nil {
		serverError(w, r, err, "Server error: "+err.Error())
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{
		"message": fmt.Sprintf("Berhasil menyalin %d urutan aktivitas dari semester sebelumnya.", ct.RowsAffected()),
	})
}

// ===== CLASSES LIST (simple) =====

func GetClassesList(w http.ResponseWriter, r *http.Request) {
	rows, err := config.Pool.Query(context.Background(),
		`SELECT id, CONCAT(grade, ' ', name) AS class_name FROM classes ORDER BY grade ASC, name ASC`)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, data)
}

// suppress unused import warning
var _ = bytes.NewBuffer
