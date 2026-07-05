package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"lms-backend-go/config"
	"lms-backend-go/middleware"

	chilib "github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/xuri/excelize/v2"
)

// ===== TEACHER SCHEDULE =====

func GetMySchedule(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	teacherID := claims.ID
	academicYearID := r.URL.Query().Get("academic_year_id")

	var rows pgx.Rows
	var err error
	if academicYearID != "" {
		rows, err = config.Pool.Query(context.Background(), `
			SELECT
				s.day_of_week,
				s.slot_number,
				sub.subject_name,
				sub.subject_code,
				sub.id as subject_id,
				c.id as classId,
				CONCAT(c.grade, '-', c.name) as class_name
			FROM schedules s
			JOIN class_subjects cs ON s.class_subject_id = cs.id
			JOIN subjects sub ON cs.subject_id = sub.id
			JOIN classes c ON s.class_id = c.id
			WHERE cs.teacher_id = $1 AND cs.academic_year_id = $2 AND s.academic_year_id = $2
		`, teacherID, academicYearID)
	} else {
		rows, err = config.Pool.Query(context.Background(), `
			SELECT
				s.day_of_week,
				s.slot_number,
				sub.subject_name,
				sub.subject_code,
				sub.id as subject_id,
				c.id as classId,
				CONCAT(c.grade, '-', c.name) as class_name
			FROM schedules s
			JOIN class_subjects cs ON s.class_subject_id = cs.id
			JOIN subjects sub ON cs.subject_id = sub.id
			JOIN classes c ON s.class_id = c.id
			WHERE cs.teacher_id = $1
		`, teacherID)
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

// ===== TEACHER CLASSES =====

func GetMyClasses(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	teacherID := claims.ID
	academicYearID := r.URL.Query().Get("academic_year_id")

	var rows pgx.Rows
	var err error
	if academicYearID != "" {
		rows, err = config.Pool.Query(context.Background(), `
			SELECT
				c.id as class_id,
				CONCAT(c.grade, '-', c.name) as class_name,
				COUNT(DISTINCT cm.student_id) as total_siswa,
				sub.id as subject_id,
				sub.subject_name,
				sub.subject_code,
				(
					(SELECT COUNT(*) FROM tasks t WHERE t.class_id = c.id AND t.subject_id = sub.id AND t.teacher_id = $1 AND t.due_date >= NOW()) +
					(SELECT COUNT(*) FROM quizzes q WHERE q.class_id = c.id AND q.subject_id = sub.id AND q.teacher_id = $1 AND q.exam_date >= NOW())
				)::INTEGER as tugas_aktif
			FROM schedules s
			JOIN class_subjects cs ON s.class_subject_id = cs.id
			JOIN subjects sub ON cs.subject_id = sub.id
			JOIN classes c ON s.class_id = c.id
			LEFT JOIN class_members cm ON c.id = cm.class_id
			WHERE cs.teacher_id = $1 AND cs.academic_year_id = $2
			GROUP BY c.id, c.grade, c.name, cs.id, sub.subject_name, sub.subject_code, sub.id
			ORDER BY c.grade, c.name, sub.subject_name
		`, teacherID, academicYearID)
	} else {
		rows, err = config.Pool.Query(context.Background(), `
			SELECT
				c.id as class_id,
				CONCAT(c.grade, '-', c.name) as class_name,
				COUNT(DISTINCT cm.student_id) as total_siswa,
				sub.id as subject_id,
				sub.subject_name,
				sub.subject_code,
				(
					(SELECT COUNT(*) FROM tasks t WHERE t.class_id = c.id AND t.subject_id = sub.id AND t.teacher_id = $1 AND t.due_date >= NOW()) +
					(SELECT COUNT(*) FROM quizzes q WHERE q.class_id = c.id AND q.subject_id = sub.id AND q.teacher_id = $1 AND q.exam_date >= NOW())
				)::INTEGER as tugas_aktif
			FROM schedules s
			JOIN class_subjects cs ON s.class_subject_id = cs.id
			JOIN subjects sub ON cs.subject_id = sub.id
			JOIN classes c ON s.class_id = c.id
			LEFT JOIN class_members cm ON c.id = cm.class_id
			WHERE cs.teacher_id = $1
			GROUP BY c.id, c.grade, c.name, cs.id, sub.subject_name, sub.subject_code, sub.id
			ORDER BY c.grade, c.name, sub.subject_name
		`, teacherID)
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

// ===== CLASS OVERVIEW =====

func GetClassOverview(w http.ResponseWriter, r *http.Request) {
	classID := chilib.URLParam(r, "classId")

	rows, err := config.Pool.Query(context.Background(), `
		SELECT u.id, u.full_name as name, u.religion
		FROM users u
		JOIN class_members cm ON u.id = cm.student_id
		JOIN classes c ON cm.class_id = c.id
		WHERE c.id = $1
		ORDER BY LOWER(u.full_name) ASC
	`, classID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	students, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	if students == nil {
		students = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{"students": students})
}

// ===== MATERIALS =====

func GetMaterials(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	classID := chilib.URLParam(r, "classId")
	subjectID := chilib.URLParam(r, "subjectId")

	rows, err := config.Pool.Query(context.Background(),
		`SELECT * FROM materials WHERE class_id = $1 AND subject_id = $2 AND teacher_id = $3 ORDER BY id DESC`,
		classID, subjectID, claims.ID)
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

func CreateMaterial(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	classID := chilib.URLParam(r, "classId")
	subjectID := chilib.URLParam(r, "subjectId")

	r.ParseMultipartForm(10 << 20)

	title := r.FormValue("title")
	description := r.FormValue("description")
	linkURL := r.FormValue("link_url")

	fileURL, err := saveUploadedFile(r, "file")
	if err != nil {
		serverError(w, r, err, "Failed to save file")
		return
	}

	_, err = config.Pool.Exec(context.Background(),
		`INSERT INTO materials (class_id, teacher_id, title, description, link_url, file_url, subject_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		classID, claims.ID, title, description, linkURL, nullableStr(fileURL), subjectID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusCreated, map[string]interface{}{
		"success": true,
		"message": "Materi berhasil dirilis",
	})
}

func UpdateMaterial(w http.ResponseWriter, r *http.Request) {
	materialID := chilib.URLParam(r, "id")

	r.ParseMultipartForm(10 << 20)

	var oldFileURL string
	config.Pool.QueryRow(context.Background(),
		"SELECT file_url FROM materials WHERE id = $1", materialID).Scan(&oldFileURL)

	title := r.FormValue("title")
	description := r.FormValue("description")
	linkURL := r.FormValue("link_url")

	fileURL := oldFileURL
	newFile, err := saveUploadedFile(r, "file")
	if err == nil && newFile != "" {
		if oldFileURL != "" {
			deleteFile(oldFileURL)
		}
		fileURL = newFile
	}

	_, err = config.Pool.Exec(context.Background(),
		`UPDATE materials SET title=$1, description=$2, link_url=$3, file_url=$4 WHERE id=$5`,
		title, description, linkURL, nullableStr(fileURL), materialID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"message": "Materi berhasil diperbarui"})
}

func DeleteMaterial(w http.ResponseWriter, r *http.Request) {
	materialID := chilib.URLParam(r, "id")

	var fileURL string
	config.Pool.QueryRow(context.Background(),
		"SELECT file_url FROM materials WHERE id = $1", materialID).Scan(&fileURL)

	if fileURL != "" {
		deleteFile(fileURL)
	}

	config.Pool.Exec(context.Background(), "DELETE FROM materials WHERE id = $1", materialID)

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Materi berhasil dihapus",
	})
}

// ===== TASKS =====

func GetTasks(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	classID := chilib.URLParam(r, "classId")
	subjectID := chilib.URLParam(r, "subjectId")

	rows, err := config.Pool.Query(context.Background(),
		`SELECT * FROM tasks WHERE class_id = $1 AND subject_id = $2 AND teacher_id = $3 ORDER BY id DESC`,
		classID, subjectID, claims.ID)
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

func CreateTask(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	classID := chilib.URLParam(r, "classId")
	subjectID := chilib.URLParam(r, "subjectId")

	r.ParseMultipartForm(10 << 20)

	title := r.FormValue("title")
	description := r.FormValue("description")
	linkURL := r.FormValue("link_url")
	dueDate := r.FormValue("due_date")

	fileURL, err := saveUploadedFile(r, "file")
	if err != nil {
		serverError(w, r, err, "Failed to save file")
		return
	}

	_, err = config.Pool.Exec(context.Background(),
		`INSERT INTO tasks (class_id, teacher_id, title, description, link_url, file_url, due_date, subject_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		classID, claims.ID, title, description, linkURL, nullableStr(fileURL), nullableStr(dueDate), subjectID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusCreated, map[string]interface{}{
		"success": true,
		"message": "Tugas berhasil dibuat",
	})
}

func UpdateTask(w http.ResponseWriter, r *http.Request) {
	taskID := chilib.URLParam(r, "id")

	r.ParseMultipartForm(10 << 20)

	var oldFileURL string
	config.Pool.QueryRow(context.Background(),
		"SELECT file_url FROM tasks WHERE id = $1", taskID).Scan(&oldFileURL)

	title := r.FormValue("title")
	description := r.FormValue("description")
	linkURL := r.FormValue("link_url")
	dueDate := r.FormValue("due_date")

	fileURL := oldFileURL
	newFile, err := saveUploadedFile(r, "file")
	if err == nil && newFile != "" {
		if oldFileURL != "" {
			deleteFile(oldFileURL)
		}
		fileURL = newFile
	}

	_, err = config.Pool.Exec(context.Background(),
		`UPDATE tasks SET title=$1, description=$2, link_url=$3, due_date=$4, file_url=$5 WHERE id=$6`,
		title, description, linkURL, nullableStr(dueDate), nullableStr(fileURL), taskID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Tugas berhasil diperbarui",
	})
}

func DeleteTask(w http.ResponseWriter, r *http.Request) {
	taskID := chilib.URLParam(r, "id")

	var fileURL string
	config.Pool.QueryRow(context.Background(),
		"SELECT file_url FROM tasks WHERE id = $1", taskID).Scan(&fileURL)

	if fileURL != "" {
		deleteFile(fileURL)
	}

	config.Pool.Exec(context.Background(), "DELETE FROM tasks WHERE id = $1", taskID)
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Tugas berhasil dihapus",
	})
}

// ===== JOURNALS =====

func GetJournals(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	classID := chilib.URLParam(r, "classId")
	subjectID := chilib.URLParam(r, "subjectId")

	rows, err := config.Pool.Query(context.Background(),
		`SELECT * FROM teaching_journals WHERE class_id = $1 AND subject_id = $2 AND teacher_id = $3 ORDER BY id DESC`,
		classID, subjectID, claims.ID)
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

func CreateJournal(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	classID := chilib.URLParam(r, "classId")
	subjectID := chilib.URLParam(r, "subjectId")

	var body struct {
		JournalDate      string  `json:"journal_date"`
		RealTimeRange    string  `json:"real_time_range"`
		SlotsTaught      string  `json:"slots_taught"`
		Notes            string  `json:"notes"`
		AbsentStudents   string  `json:"absent_students"`
		AbsentStudentIDs []int64 `json:"absent_student_ids"`
		IsSubstitute     bool    `json:"is_substitute"`
		SubstituteName   string  `json:"substitute_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	_, err := config.Pool.Exec(context.Background(),
		`INSERT INTO teaching_journals
		 (class_id, subject_id, teacher_id, journal_date, real_time_range, slots_taught, notes, absent_students, absent_student_ids, is_substitute, substitute_name)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		classID, subjectID, claims.ID,
		body.JournalDate, body.RealTimeRange, body.SlotsTaught, body.Notes,
		body.AbsentStudents, body.AbsentStudentIDs, body.IsSubstitute, body.SubstituteName)
	if err != nil {
		serverError(w, r, err, "Server error: "+err.Error())
		return
	}
	jsonResponse(w, http.StatusCreated, map[string]interface{}{
		"success": true,
		"message": "Jurnal berhasil disimpan",
	})
}

func UpdateJournal(w http.ResponseWriter, r *http.Request) {
	journalID := chilib.URLParam(r, "id")

	var body struct {
		JournalDate      string  `json:"journal_date"`
		RealTimeRange    string  `json:"real_time_range"`
		SlotsTaught      string  `json:"slots_taught"`
		Notes            string  `json:"notes"`
		AbsentStudents   string  `json:"absent_students"`
		AbsentStudentIDs []int64 `json:"absent_student_ids"`
		IsSubstitute     bool    `json:"is_substitute"`
		SubstituteName   string  `json:"substitute_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	_, err := config.Pool.Exec(context.Background(),
		`UPDATE teaching_journals
		 SET journal_date=$1, real_time_range=$2, slots_taught=$3, notes=$4, absent_students=$5, absent_student_ids=$6, is_substitute=$7, substitute_name=$8
		 WHERE id=$9`,
		body.JournalDate, body.RealTimeRange, body.SlotsTaught, body.Notes,
		body.AbsentStudents, body.AbsentStudentIDs, body.IsSubstitute, body.SubstituteName,
		journalID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Jurnal berhasil diperbarui",
	})
}

func DeleteJournal(w http.ResponseWriter, r *http.Request) {
	journalID := chilib.URLParam(r, "id")
	config.Pool.Exec(context.Background(), "DELETE FROM teaching_journals WHERE id = $1", journalID)
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Jurnal berhasil dihapus",
	})
}

// ===== ACTIVE SUBJECTS =====

func GetActiveSubjects(w http.ResponseWriter, r *http.Request) {
	academicYearID := r.URL.Query().Get("academic_year_id")

	var rows pgx.Rows
	var err error
	if academicYearID != "" {
		rows, err = config.Pool.Query(context.Background(),
			`SELECT id, subject_name, subject_code FROM subjects WHERE is_active = true AND academic_year_id = $1 ORDER BY subject_name ASC`,
			academicYearID)
	} else {
		rows, err = config.Pool.Query(context.Background(),
			`SELECT id, subject_name, subject_code FROM subjects WHERE is_active = true ORDER BY subject_name ASC`)
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

// ===== TEACHING DOCUMENTS =====

func GetTeachingDocuments(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	academicYearID := r.URL.Query().Get("academic_year_id")

	if academicYearID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"message": "Parameter academic_year_id diperlukan"})
		return
	}

	rows, err := config.Pool.Query(context.Background(), `
		SELECT td.*, s.subject_name, s.subject_code
		FROM teaching_documents td
		JOIN subjects s ON td.subject_id = s.id
		WHERE td.teacher_id = $1 AND td.academic_year_id = $2
		ORDER BY td.created_at DESC
	`, claims.ID, academicYearID)
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

func CreateTeachingDocument(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)

	r.ParseMultipartForm(10 << 20)

	academicYearID := r.FormValue("academic_year_id")
	subjectID := r.FormValue("subject_id")
	grade := r.FormValue("grade")
	title := r.FormValue("title")
	description := r.FormValue("description")
	linkURL := r.FormValue("link_url")

	fileURL, err := saveUploadedFile(r, "file")
	if err != nil {
		serverError(w, r, err, "Failed to save file")
		return
	}

	if fileURL == "" && linkURL == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{
			"message": "Silakan unggah file perangkat atau masukkan tautan eksternal",
		})
		return
	}

	_, err = config.Pool.Exec(context.Background(),
		`INSERT INTO teaching_documents (teacher_id, academic_year_id, subject_id, grade, title, description, file_url, link_url)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		claims.ID, academicYearID, subjectID, grade, title, description, nullableStr(fileURL), nullableStr(linkURL))
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusCreated, map[string]interface{}{
		"success": true,
		"message": "Perangkat pembelajaran berhasil disimpan",
	})
}

func UpdateTeachingDocument(w http.ResponseWriter, r *http.Request) {
	docID := chilib.URLParam(r, "id")

	var oldFileURL, oldLinkURL string
	err := config.Pool.QueryRow(context.Background(),
		"SELECT file_url, link_url FROM teaching_documents WHERE id = $1", docID).Scan(&oldFileURL, &oldLinkURL)
	if err != nil {
		jsonError(w, http.StatusNotFound, "Document not found")
		return
	}

	r.ParseMultipartForm(10 << 20)

	subjectID := r.FormValue("subject_id")
	grade := r.FormValue("grade")
	title := r.FormValue("title")
	description := r.FormValue("description")
	hapusFileLama := r.FormValue("hapus_file_lama")

	newLinkURL := r.FormValue("link_url")
	linkURL := newLinkURL
	if linkURL == "" {
		linkURL = oldLinkURL // preserve existing link_url if none submitted
	}

	fileURL := oldFileURL
	newFile, err2 := saveUploadedFile(r, "file")
	if err2 == nil && newFile != "" {
		if oldFileURL != "" {
			deleteFile(oldFileURL)
		}
		fileURL = newFile
		linkURL = "" // clear link when switching to a file upload (matches JS behavior)
	} else if newLinkURL != "" && (hapusFileLama == "true") {
		// Switch from file-only to link-only mode
		if oldFileURL != "" {
			deleteFile(oldFileURL)
		}
		fileURL = ""
	}

	if fileURL == "" && linkURL == "" {
		jsonError(w, http.StatusBadRequest, "Dokumen tidak boleh kosong. Sediakan file atau link eksternal.")
		return
	}

	_, err = config.Pool.Exec(context.Background(),
		`UPDATE teaching_documents SET subject_id=$1, grade=$2, title=$3, description=$4, file_url=$5, link_url=$6, updated_at=CURRENT_TIMESTAMP
		 WHERE id=$7`,
		subjectID, grade, title, description, nullableStr(fileURL), nullableStr(linkURL), docID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Perangkat pembelajaran berhasil diperbarui",
	})
}

func DeleteTeachingDocument(w http.ResponseWriter, r *http.Request) {
	docID := chilib.URLParam(r, "id")

	var fileURL string
	config.Pool.QueryRow(context.Background(),
		"SELECT file_url FROM teaching_documents WHERE id = $1", docID).Scan(&fileURL)

	if fileURL != "" {
		deleteFile(fileURL)
	}

	config.Pool.Exec(context.Background(), "DELETE FROM teaching_documents WHERE id = $1", docID)
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Perangkat pembelajaran berhasil dihapus",
	})
}

// ===== QUIZZES =====

func GetQuizzes(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	classID := chilib.URLParam(r, "classId")
	subjectID := chilib.URLParam(r, "subjectId")

	rows, err := config.Pool.Query(context.Background(), `
		SELECT id, class_id, teacher_id, title, instruction, embed_url,
			   TO_CHAR(exam_date, 'YYYY-MM-DD') as exam_date,
			   TO_CHAR(start_time, 'HH24:MI') as start_time,
			   TO_CHAR(end_time, 'HH24:MI') as end_time
		FROM quizzes
		WHERE class_id = $1 AND subject_id = $2 AND teacher_id = $3
		ORDER BY id DESC
	`, classID, subjectID, claims.ID)
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

func CreateQuiz(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	classID := chilib.URLParam(r, "classId")
	subjectID := chilib.URLParam(r, "subjectId")

	var body struct {
		Title       string `json:"title"`
		Instruction string `json:"instruction"`
		EmbedURL    string `json:"embed_url"`
		ExamDate    string `json:"exam_date"`
		StartTime   string `json:"start_time"`
		EndTime     string `json:"end_time"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	embedURL := extractEmbedURL(body.EmbedURL)

	_, err := config.Pool.Exec(context.Background(),
		`INSERT INTO quizzes (class_id, subject_id, teacher_id, title, instruction, embed_url, exam_date, start_time, end_time)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		classID, subjectID, claims.ID,
		body.Title, body.Instruction, embedURL,
		nullableStr(body.ExamDate), nullableStr(body.StartTime), nullableStr(body.EndTime))
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusCreated, map[string]interface{}{
		"success": true,
		"message": "Ulangan/Quiz berhasil dibuat",
	})
}

func UpdateQuiz(w http.ResponseWriter, r *http.Request) {
	quizID := chilib.URLParam(r, "id")

	var body struct {
		Title       string `json:"title"`
		Instruction string `json:"instruction"`
		EmbedURL    string `json:"embed_url"`
		ExamDate    string `json:"exam_date"`
		StartTime   string `json:"start_time"`
		EndTime     string `json:"end_time"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	embedURL := extractEmbedURL(body.EmbedURL)

	_, err := config.Pool.Exec(context.Background(),
		`UPDATE quizzes SET title=$1, instruction=$2, embed_url=$3, exam_date=$4, start_time=$5, end_time=$6 WHERE id=$7`,
		body.Title, body.Instruction, embedURL,
		nullableStr(body.ExamDate), nullableStr(body.StartTime), nullableStr(body.EndTime), quizID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Ulangan/Quiz berhasil diperbarui",
	})
}

func DeleteQuiz(w http.ResponseWriter, r *http.Request) {
	quizID := chilib.URLParam(r, "id")
	config.Pool.Exec(context.Background(), "DELETE FROM quizzes WHERE id = $1", quizID)
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Ulangan/Quiz berhasil dihapus",
	})
}

// ===== QUIZ SCORES =====

func GetQuizScores(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	classID := chilib.URLParam(r, "classId")
	quizID := chilib.URLParam(r, "id")

	var globalKKM float64 = 75
	config.Pool.QueryRow(context.Background(),
		`SELECT default_kkm FROM academic_year_kkm WHERE academic_year_id = (SELECT academic_year_id FROM classes WHERE id = $1) LIMIT 1`,
		classID).Scan(&globalKKM)
	if globalKKM == 0 {
		globalKKM = 75
	}

	// Get grade from classId (e.g. "7-A" => "7")
	gradeStr := strings.Split(classID, "-")[0]

	var subjectKKMPtr *float64
	err := config.Pool.QueryRow(context.Background(), `
		SELECT sub.kkm::float8 FROM class_subjects cs
		JOIN subjects sub ON cs.subject_id = sub.id
		WHERE cs.teacher_id = $1 AND sub.grade = $2
		LIMIT 1
	`, claims.ID, gradeStr).Scan(&subjectKKMPtr)
	kkm := globalKKM
	if err == nil && subjectKKMPtr != nil && *subjectKKMPtr > 0 {
		kkm = *subjectKKMPtr
	}

	rows, err := config.Pool.Query(context.Background(), `
		SELECT u.id as student_id, u.username, u.full_name as name, qs.score, u.religion
		FROM users u
		JOIN class_members cm ON u.id = cm.student_id
		JOIN classes c ON cm.class_id = c.id
		LEFT JOIN quiz_scores qs ON qs.quiz_id = $1 AND qs.student_id = u.id
		WHERE c.id = $2
		ORDER BY LOWER(u.full_name) ASC
	`, quizID, classID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	scores, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	if scores == nil {
		scores = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"scores": scores,
		"kkm":    kkm,
	})
}

func SaveQuizScoreManual(w http.ResponseWriter, r *http.Request) {
	quizID := chilib.URLParam(r, "id")

	var body struct {
		StudentID int64       `json:"student_id"`
		Score     json.Number `json:"score"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	score, _ := body.Score.Float64()

	_, err := config.Pool.Exec(context.Background(),
		`INSERT INTO quiz_scores (quiz_id, student_id, score)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (quiz_id, student_id) DO UPDATE SET score = EXCLUDED.score`,
		quizID, body.StudentID, score)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Nilai kuis manual berhasil disimpan!",
	})
}

func ImportQuizScores(w http.ResponseWriter, r *http.Request) {
	quizID := chilib.URLParam(r, "id")

	excelRows, err := readExcelRows(r, "file")
	if err != nil {
		jsonError(w, http.StatusBadRequest, "Failed to read Excel: "+err.Error())
		return
	}

	saved := 0
	for _, row := range excelRows {
		username := getColValue(row, "Username LMS", "username lms", "username", "Username")
		nameVal := getColValue(row, "Nama", "Nama Lengkap", "nama", "nama lengkap")
		scoreStr := getColValue(row, "Score", "Skor", "score", "skor")

		if scoreStr == "" {
			continue
		}

		// Handle "80 / 100" fraction
		scoreStr = strings.TrimSpace(scoreStr)
		if idx := strings.Index(scoreStr, "/"); idx != -1 {
			parts := strings.SplitN(scoreStr, "/", 2)
			num, _ := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
			den, _ := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
			if den > 0 {
				scoreStr = fmt.Sprintf("%f", num/den*100)
			}
		}
		score, err := strconv.ParseFloat(scoreStr, 64)
		if err != nil {
			continue
		}

		var studentID int64
		if username != "" {
			config.Pool.QueryRow(context.Background(),
				"SELECT id FROM users WHERE username = $1 AND role = 'student'", username).Scan(&studentID)
		}
		if studentID == 0 && nameVal != "" {
			config.Pool.QueryRow(context.Background(),
				"SELECT id FROM users WHERE full_name = $1 AND role = 'student'", nameVal).Scan(&studentID)
		}
		if studentID == 0 {
			continue
		}

		_, err = config.Pool.Exec(context.Background(),
			`INSERT INTO quiz_scores (quiz_id, student_id, score)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (quiz_id, student_id) DO UPDATE SET score = EXCLUDED.score`,
			quizID, studentID, score)
		if err == nil {
			saved++
		}
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Data nilai Google Form berhasil di-import!",
	})
}

// ===== TASK SCORES =====

func GetTaskScores(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	classID := chilib.URLParam(r, "classId")
	taskID := chilib.URLParam(r, "id")

	var globalKKM float64 = 75
	config.Pool.QueryRow(context.Background(),
		`SELECT default_kkm FROM academic_year_kkm WHERE academic_year_id = (SELECT academic_year_id FROM classes WHERE id = $1) LIMIT 1`,
		classID).Scan(&globalKKM)
	if globalKKM == 0 {
		globalKKM = 75
	}

	gradeStr := strings.Split(classID, "-")[0]

	var subjectKKMPtr *float64
	err := config.Pool.QueryRow(context.Background(), `
		SELECT sub.kkm::float8 FROM class_subjects cs
		JOIN subjects sub ON cs.subject_id = sub.id
		WHERE cs.teacher_id = $1 AND sub.grade = $2
		LIMIT 1
	`, claims.ID, gradeStr).Scan(&subjectKKMPtr)
	kkm := globalKKM
	if err == nil && subjectKKMPtr != nil && *subjectKKMPtr > 0 {
		kkm = *subjectKKMPtr
	}

	rows, err := config.Pool.Query(context.Background(), `
		SELECT u.id as student_id, u.username, u.full_name as name, ts.score, ts.task_url, u.religion
		FROM users u
		JOIN class_members cm ON u.id = cm.student_id
		JOIN classes c ON cm.class_id = c.id
		LEFT JOIN task_scores ts ON ts.task_id = $1 AND ts.student_id = u.id
		WHERE c.id = $2
		ORDER BY LOWER(u.full_name) ASC
	`, taskID, classID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	scores, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	if scores == nil {
		scores = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"scores": scores,
		"kkm":    kkm,
	})
}

func SaveTaskScore(w http.ResponseWriter, r *http.Request) {
	taskID := chilib.URLParam(r, "id")

	var body struct {
		StudentID int64       `json:"student_id"`
		Score     json.Number `json:"score"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	score, _ := body.Score.Float64()

	_, err := config.Pool.Exec(context.Background(),
		`INSERT INTO task_scores (task_id, student_id, score)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (task_id, student_id) DO UPDATE SET score = EXCLUDED.score, updated_at = CURRENT_TIMESTAMP`,
		taskID, body.StudentID, score)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Nilai tugas berhasil disimpan!",
	})
}

// ===== GRADEBOOK =====

func GetGradebook(w http.ResponseWriter, r *http.Request) {
	classID := chilib.URLParam(r, "classId")
	subjectID := chilib.URLParam(r, "subjectId")

	var globalKKM float64 = 75
	config.Pool.QueryRow(context.Background(),
		`SELECT default_kkm FROM academic_year_kkm WHERE academic_year_id = (SELECT academic_year_id FROM classes WHERE id = $1) LIMIT 1`,
		classID).Scan(&globalKKM)
	if globalKKM == 0 {
		globalKKM = 75
	}

	var subjectKKM *float64
	err := config.Pool.QueryRow(context.Background(),
		"SELECT kkm FROM subjects WHERE id = $1", subjectID).Scan(&subjectKKM)
	kkm := globalKKM
	if err == nil && subjectKKM != nil && *subjectKKM > 0 {
		kkm = *subjectKKM
	}

	// Get students (filtered by religion vs subject name)
	studentRows, err := config.Pool.Query(context.Background(), `
		SELECT u.id as student_id, u.username, u.full_name as name, u.religion
		FROM users u
		JOIN class_members cm ON u.id = cm.student_id
		JOIN classes c ON cm.class_id = c.id
		CROSS JOIN (SELECT subject_name FROM subjects WHERE id = $2) s
		WHERE c.id = $1
		AND (
			s.subject_name NOT ILIKE ALL(ARRAY['%Islam%', '%Kristen%', '%Katolik%', '%Hindu%', '%Budha%', '%Konghucu%'])
			OR s.subject_name ILIKE '%' || u.religion || '%'
		)
		ORDER BY LOWER(u.full_name) ASC
	`, classID, subjectID)
	if err != nil {
		serverError(w, r, err, "Server error")
		return
	}
	studentList, _ := rowsToMaps(studentRows)

	// Get tasks
	taskRows, _ := config.Pool.Query(context.Background(),
		`SELECT id, title, 'task' as type FROM tasks WHERE class_id = $1 AND subject_id = $2 ORDER BY created_at ASC`,
		classID, subjectID)
	taskList, _ := rowsToMaps(taskRows)

	// Get quizzes
	quizRows, _ := config.Pool.Query(context.Background(),
		`SELECT id, title, 'quiz' as type FROM quizzes WHERE class_id = $1 AND subject_id = $2 ORDER BY created_at ASC`,
		classID, subjectID)
	quizList, _ := rowsToMaps(quizRows)

	// Combine assessments and add uid field
	var assessments []map[string]interface{}
	for _, t := range taskList {
		uid := fmt.Sprintf("task_%v", t["id"])
		t["uid"] = uid
		assessments = append(assessments, t)
	}
	for _, q := range quizList {
		uid := fmt.Sprintf("quiz_%v", q["id"])
		q["uid"] = uid
		assessments = append(assessments, q)
	}
	if assessments == nil {
		assessments = []map[string]interface{}{}
	}

	// Get scores — store as formatted "%.2f" strings to match original API
	taskScoreMap := make(map[string]string)
	taskScoreRows, _ := config.Pool.Query(context.Background(),
		`SELECT student_id, task_id, score FROM task_scores WHERE task_id IN (SELECT id FROM tasks WHERE subject_id = $1)`,
		subjectID)
	if taskScoreRows != nil {
		for taskScoreRows.Next() {
			var sid, tid int64
			var score *float64
			taskScoreRows.Scan(&sid, &tid, &score)
			if score != nil {
				taskScoreMap[fmt.Sprintf("%d_task_%d", sid, tid)] = fmt.Sprintf("%.2f", *score)
			}
		}
		taskScoreRows.Close()
	}

	quizScoreMap := make(map[string]string)
	quizScoreRows, _ := config.Pool.Query(context.Background(),
		`SELECT student_id, quiz_id, score FROM quiz_scores WHERE quiz_id IN (SELECT id FROM quizzes WHERE subject_id = $1)`,
		subjectID)
	if quizScoreRows != nil {
		for quizScoreRows.Next() {
			var sid, qid int64
			var score *float64
			quizScoreRows.Scan(&sid, &qid, &score)
			if score != nil {
				quizScoreMap[fmt.Sprintf("%d_quiz_%d", sid, qid)] = fmt.Sprintf("%.2f", *score)
			}
		}
		quizScoreRows.Close()
	}

	// Build student data with scores
	for i, student := range studentList {
		sid := fmt.Sprintf("%v", student["student_id"])
		scores := make(map[string]interface{})
		for _, t := range taskList {
			tid := fmt.Sprintf("%v", t["id"])
			if v, ok := taskScoreMap[sid+"_task_"+tid]; ok {
				scores["task_"+tid] = v
			}
		}
		for _, q := range quizList {
			qid := fmt.Sprintf("%v", q["id"])
			if v, ok := quizScoreMap[sid+"_quiz_"+qid]; ok {
				scores["quiz_"+qid] = v
			}
		}
		studentList[i]["scores"] = scores
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"assessments": assessments,
		"students":    studentList,
		"kkm":         kkm,
	})
}

func ExportGradebook(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	classID := chilib.URLParam(r, "classId")
	subjectID := chilib.URLParam(r, "subjectId")

	// Get students
	studentRows, _ := config.Pool.Query(context.Background(), `
		SELECT u.id as student_id, u.username, u.full_name as name
		FROM users u
		JOIN class_members cm ON u.id = cm.student_id
		JOIN classes c ON cm.class_id = c.id
		WHERE c.id = $1
		ORDER BY u.full_name ASC
	`, classID)
	studentList, _ := rowsToMaps(studentRows)

	taskRows, _ := config.Pool.Query(context.Background(),
		`SELECT id, title FROM tasks WHERE class_id = $1 AND subject_id = $2 ORDER BY created_at ASC`,
		classID, subjectID)
	taskList, _ := rowsToMaps(taskRows)

	quizRows, _ := config.Pool.Query(context.Background(),
		`SELECT id, title FROM quizzes WHERE class_id = $1 AND subject_id = $2 ORDER BY created_at ASC`,
		classID, subjectID)
	quizList, _ := rowsToMaps(quizRows)

	f := excelize.NewFile()
	sheet := "Gradebook"
	f.NewSheet(sheet)
	f.DeleteSheet("Sheet1")

	headers := []string{"No", "Nama Siswa", "NIS/Username"}
	if taskList != nil {
		for _, t := range taskList {
			headers = append(headers, fmt.Sprintf("Tugas: %v", t["title"]))
		}
	}
	if quizList != nil {
		for _, q := range quizList {
			headers = append(headers, fmt.Sprintf("Quiz: %v", q["title"]))
		}
	}

	for i, h := range headers {
		col, _ := excelize.ColumnNumberToName(i + 1)
		f.SetCellValue(sheet, col+"1", h)
	}

	for rowIdx, student := range studentList {
		sid := fmt.Sprintf("%v", student["student_id"])
		rowNum := rowIdx + 2
		colIdx := 1

		colName, _ := excelize.ColumnNumberToName(colIdx)
		f.SetCellValue(sheet, fmt.Sprintf("%s%d", colName, rowNum), rowIdx+1)
		colIdx++

		colName, _ = excelize.ColumnNumberToName(colIdx)
		f.SetCellValue(sheet, fmt.Sprintf("%s%d", colName, rowNum), student["name"])
		colIdx++

		colName, _ = excelize.ColumnNumberToName(colIdx)
		f.SetCellValue(sheet, fmt.Sprintf("%s%d", colName, rowNum), student["username"])
		colIdx++

		if taskList != nil {
			for _, t := range taskList {
				tid := fmt.Sprintf("%v", t["id"])
				var score *float64
				config.Pool.QueryRow(context.Background(),
					"SELECT score FROM task_scores WHERE task_id = $1 AND student_id = $2", tid, sid).Scan(&score)
				colName, _ = excelize.ColumnNumberToName(colIdx)
				if score != nil {
					f.SetCellValue(sheet, fmt.Sprintf("%s%d", colName, rowNum), *score)
				} else {
					f.SetCellValue(sheet, fmt.Sprintf("%s%d", colName, rowNum), "Belum")
				}
				colIdx++
			}
		}

		if quizList != nil {
			for _, q := range quizList {
				qid := fmt.Sprintf("%v", q["id"])
				var score *float64
				config.Pool.QueryRow(context.Background(),
					"SELECT score FROM quiz_scores WHERE quiz_id = $1 AND student_id = $2", qid, sid).Scan(&score)
				colName, _ = excelize.ColumnNumberToName(colIdx)
				if score != nil {
					f.SetCellValue(sheet, fmt.Sprintf("%s%d", colName, rowNum), *score)
				} else {
					f.SetCellValue(sheet, fmt.Sprintf("%s%d", colName, rowNum), "Belum")
				}
				colIdx++
			}
		}
	}

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		serverError(w, r, err, "Failed to generate Excel")
		return
	}

	fileName := fmt.Sprintf("Rekap_Nilai_%s.xlsx", classID)
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, fileName))
	w.Write(buf.Bytes())

	_ = claims
}

// ===== PENDING GRADINGS =====

func GetPendingGradings(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	academicYearID := r.URL.Query().Get("academic_year_id")

	if academicYearID == "" {
		jsonError(w, http.StatusBadRequest, "Parameter academic_year_id diperlukan")
		return
	}

	taskRows, _ := config.Pool.Query(context.Background(), `
		SELECT * FROM (
			SELECT
				'Tugas' AS type,
				t.id,
				t.title,
				c.id AS class_id,
				CONCAT(c.grade, '-', c.name) as class_name,
				t.due_date,
				t.subject_id,
				sub.subject_name,
				EXTRACT(DAY FROM NOW() - t.due_date)::INTEGER AS days_overdue,
				(
					SELECT COUNT(cm.student_id)
					FROM class_members cm
					JOIN classes c2 ON cm.class_id = c2.id
					JOIN users u ON cm.student_id = u.id
					WHERE c2.id = t.class_id
					  AND cm.student_id NOT IN (
					    SELECT ts.student_id FROM task_scores ts WHERE ts.task_id = t.id AND ts.score IS NOT NULL
					  ) AND (
					    NOT (
					      sub.subject_name ILIKE '%islam%' OR sub.subject_name ILIKE '%katolik%' OR
					      sub.subject_name ILIKE '%kristen%' OR sub.subject_name ILIKE '%hindu%' OR
					      sub.subject_name ILIKE '%buddha%' OR sub.subject_name ILIKE '%konghucu%'
					    )
					    OR (u.religion IS NOT NULL AND sub.subject_name ILIKE '%' || u.religion || '%')
					  )
				) AS unsubmitted_count
			FROM tasks t
			JOIN subjects sub ON t.subject_id = sub.id
			JOIN classes c ON c.id = t.class_id
			WHERE t.teacher_id = $1
			  AND c.academic_year_id = $2
			  AND t.due_date < NOW()
		) tasks_overdue
		WHERE unsubmitted_count > 0
	`, claims.ID, academicYearID)

	quizRows, _ := config.Pool.Query(context.Background(), `
		SELECT * FROM (
			SELECT
				'Kuis' AS type,
				q.id,
				q.title,
				c.id AS class_id,
				CONCAT(c.grade, '-', c.name) as class_name,
				q.exam_date AS due_date,
				q.subject_id,
				sub.subject_name,
				EXTRACT(DAY FROM NOW() - q.exam_date)::INTEGER AS days_overdue,
				(
					SELECT COUNT(cm.student_id)
					FROM class_members cm
					JOIN classes c2 ON cm.class_id = c2.id
					JOIN users u ON cm.student_id = u.id
					WHERE c2.id = q.class_id
					  AND cm.student_id NOT IN (
					    SELECT qs.student_id FROM quiz_scores qs WHERE qs.quiz_id = q.id AND qs.score IS NOT NULL
					  ) AND (
					    NOT (
					      sub.subject_name ILIKE '%islam%' OR sub.subject_name ILIKE '%katolik%' OR
					      sub.subject_name ILIKE '%kristen%' OR sub.subject_name ILIKE '%hindu%' OR
					      sub.subject_name ILIKE '%buddha%' OR sub.subject_name ILIKE '%konghucu%'
					    )
					    OR (u.religion IS NOT NULL AND sub.subject_name ILIKE '%' || u.religion || '%')
					  )
				) AS unsubmitted_count
			FROM quizzes q
			JOIN subjects sub ON q.subject_id = sub.id
			JOIN classes c ON c.id = q.class_id
			WHERE q.teacher_id = $1
			  AND c.academic_year_id = $2
			  AND q.exam_date < NOW()
		) quizzes_overdue
		WHERE unsubmitted_count > 0
	`, claims.ID, academicYearID)

	var result []map[string]interface{}
	if taskList, err := rowsToMaps(taskRows); err == nil && taskList != nil {
		result = append(result, taskList...)
	}
	if quizList, err := rowsToMaps(quizRows); err == nil && quizList != nil {
		result = append(result, quizList...)
	}
	if result == nil {
		result = []map[string]interface{}{}
	}
	sort.Slice(result, func(i, j int) bool {
		return toIntIface(result[i]["days_overdue"]) > toIntIface(result[j]["days_overdue"])
	})
	jsonResponse(w, http.StatusOK, result)
}

// ===== CLASS NAME =====

func GetClassName(w http.ResponseWriter, r *http.Request) {
	classID := r.URL.Query().Get("classId")

	var grade, name string
	err := config.Pool.QueryRow(context.Background(),
		"SELECT grade, name FROM classes WHERE id = $1", classID).Scan(&grade, &name)
	if err != nil {
		jsonError(w, http.StatusNotFound, "Kelas tidak ditemukan")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{
		"className": grade + "-" + name,
	})
}

// ===== UPLOAD LIMIT =====

func GetUploadLimit(w http.ResponseWriter, r *http.Request) {
	rows, err := config.Pool.Query(context.Background(),
		"SELECT * FROM app_settings WHERE setting_key = 'upload_limit'")
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

// ===== HELPERS =====

// nullableStr returns nil if s is empty, else &s
func nullableStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// suppress unused import warnings
var _ = regexp.MustCompile
