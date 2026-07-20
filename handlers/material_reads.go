package handlers

import (
	"context"
	"net/http"
	"strconv"

	"lms-backend-go/config"
	"lms-backend-go/middleware"

	chilib "github.com/go-chi/chi/v5"
)

// MarkMaterialAsRead - POST /api/student/materials/{materialId}/mark-read
// Catat siswa sudah membaca materi
func MarkMaterialAsRead(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	materialID := chilib.URLParam(r, "materialId")

	if materialID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "Material ID diperlukan"})
		return
	}

	// Validasi: pastikan siswa punya akses ke materi ini (ada di kelas yang sama)
	var classID int64
	err := config.Pool.QueryRow(context.Background(), `
		SELECT m.class_id
		FROM materials m
		JOIN class_members cm ON m.class_id = cm.class_id
		WHERE m.id = $1 AND cm.student_id = $2
		LIMIT 1
	`, materialID, claims.ID).Scan(&classID)

	if err != nil {
		jsonResponse(w, http.StatusForbidden, map[string]string{"error": "Akses ditolak atau materi tidak ditemukan"})
		return
	}

	// Insert ke material_reads (jika sudah ada, UNIQUE constraint akan mencegah duplikat)
	_, err = config.Pool.Exec(context.Background(), `
		INSERT INTO material_reads (material_id, student_id, read_at)
		VALUES ($1, $2, CURRENT_TIMESTAMP)
		ON CONFLICT (material_id, student_id) DO NOTHING
	`, materialID, claims.ID)

	if err != nil {
		serverError(w, r, err, "Gagal mencatat pembacaan materi")
		return
	}

	jsonResponse(w, http.StatusOK, map[string]bool{"success": true})
}

// MarkTaskAsRead - POST /api/student/tasks/{taskId}/mark-read
// Catat siswa sudah membaca tugas
func MarkTaskAsRead(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	taskID := chilib.URLParam(r, "taskId")

	if taskID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "Task ID diperlukan"})
		return
	}

	// Validasi: pastikan siswa punya akses ke tugas ini (ada di kelas yang sama)
	var classID int64
	err := config.Pool.QueryRow(context.Background(), `
		SELECT t.class_id
		FROM tasks t
		JOIN class_members cm ON t.class_id = cm.class_id
		WHERE t.id = $1 AND cm.student_id = $2
		LIMIT 1
	`, taskID, claims.ID).Scan(&classID)

	if err != nil {
		jsonResponse(w, http.StatusForbidden, map[string]string{"error": "Akses ditolak atau tugas tidak ditemukan"})
		return
	}

	// Insert ke task_reads (jika sudah ada, UNIQUE constraint akan mencegah duplikat)
	_, err = config.Pool.Exec(context.Background(), `
		INSERT INTO task_reads (task_id, student_id, read_at)
		VALUES ($1, $2, CURRENT_TIMESTAMP)
		ON CONFLICT (task_id, student_id) DO NOTHING
	`, taskID, claims.ID)

	if err != nil {
		serverError(w, r, err, "Gagal mencatat pembacaan tugas")
		return
	}

	jsonResponse(w, http.StatusOK, map[string]bool{"success": true})
}

// GetMaterialReadStats - GET /api/teacher/kelas/{classId}/materials/{materialId}/read-stats
// Ambil statistik pembacaan materi (hanya untuk guru yang mengajar kelas ini)
func GetMaterialReadStats(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	classIDStr := chilib.URLParam(r, "classId")
	materialIDStr := chilib.URLParam(r, "materialId")

	classID, _ := strconv.ParseInt(classIDStr, 10, 64)
	materialID, _ := strconv.ParseInt(materialIDStr, 10, 64)

	// Validasi: pastikan guru mengajar kelas ini dan materi ini milik guru tersebut
	var teacherID int64
	err := config.Pool.QueryRow(context.Background(), `
		SELECT m.teacher_id
		FROM materials m
		WHERE m.id = $1 AND m.class_id = $2
	`, materialID, classID).Scan(&teacherID)

	if err != nil || teacherID != int64(claims.ID) {
		jsonResponse(w, http.StatusForbidden, map[string]string{"error": "Akses ditolak"})
		return
	}

	// Ambil total siswa di kelas
	var totalStudents int64
	config.Pool.QueryRow(context.Background(), `
		SELECT COUNT(DISTINCT student_id)
		FROM class_members
		WHERE class_id = $1
	`, classID).Scan(&totalStudents)

	// Ambil data pembacaan materi
	rows, err := config.Pool.Query(context.Background(), `
		SELECT 
			u.id as student_id,
			u.full_name as student_name,
			mr.read_at
		FROM class_members cm
		JOIN users u ON cm.student_id = u.id
		LEFT JOIN material_reads mr ON mr.material_id = $1 AND mr.student_id = cm.student_id
		WHERE cm.class_id = $2
		ORDER BY mr.read_at DESC NULLS LAST, u.full_name ASC
	`, materialID, classID)

	if err != nil {
		serverError(w, r, err, "Gagal mengambil statistik pembacaan materi")
		return
	}

	details, _ := rowsToMaps(rows)
	if details == nil {
		details = []map[string]interface{}{}
	}

	// Pisahkan menjadi yang sudah baca dan belum baca
	var readBy []map[string]interface{}
	var notReadBy []map[string]interface{}
	for _, detail := range details {
		if detail["read_at"] != nil {
			readBy = append(readBy, detail)
		} else {
			notReadBy = append(notReadBy, detail)
		}
	}
	if readBy == nil {
		readBy = []map[string]interface{}{}
	}
	if notReadBy == nil {
		notReadBy = []map[string]interface{}{}
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"total_students": totalStudents,
		"read_count":     len(readBy),
		"not_read_count": len(notReadBy),
		"read_by":        readBy,
		"not_read_by":    notReadBy,
	})
}

// GetTaskReadStats - GET /api/teacher/kelas/{classId}/tasks/{taskId}/read-stats
// Ambil statistik pembacaan tugas (hanya untuk guru yang mengajar kelas ini)
func GetTaskReadStats(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	classIDStr := chilib.URLParam(r, "classId")
	taskIDStr := chilib.URLParam(r, "taskId")

	classID, _ := strconv.ParseInt(classIDStr, 10, 64)
	taskID, _ := strconv.ParseInt(taskIDStr, 10, 64)

	// Validasi: pastikan guru mengajar kelas ini dan tugas ini milik guru tersebut
	var teacherID int64
	err := config.Pool.QueryRow(context.Background(), `
		SELECT t.teacher_id
		FROM tasks t
		WHERE t.id = $1 AND t.class_id = $2
	`, taskID, classID).Scan(&teacherID)

	if err != nil || teacherID != int64(claims.ID) {
		jsonResponse(w, http.StatusForbidden, map[string]string{"error": "Akses ditolak"})
		return
	}

	// Ambil total siswa di kelas
	var totalStudents int64
	config.Pool.QueryRow(context.Background(), `
		SELECT COUNT(DISTINCT student_id)
		FROM class_members
		WHERE class_id = $1
	`, classID).Scan(&totalStudents)

	// Ambil data pembacaan tugas
	rows, err := config.Pool.Query(context.Background(), `
		SELECT 
			u.id as student_id,
			u.full_name as student_name,
			tr.read_at
		FROM class_members cm
		JOIN users u ON cm.student_id = u.id
		LEFT JOIN task_reads tr ON tr.task_id = $1 AND tr.student_id = cm.student_id
		WHERE cm.class_id = $2
		ORDER BY tr.read_at DESC NULLS LAST, u.full_name ASC
	`, taskID, classID)

	if err != nil {
		serverError(w, r, err, "Gagal mengambil statistik pembacaan tugas")
		return
	}

	details, _ := rowsToMaps(rows)
	if details == nil {
		details = []map[string]interface{}{}
	}

	// Pisahkan menjadi yang sudah baca dan belum baca
	var readBy []map[string]interface{}
	var notReadBy []map[string]interface{}
	for _, detail := range details {
		if detail["read_at"] != nil {
			readBy = append(readBy, detail)
		} else {
			notReadBy = append(notReadBy, detail)
		}
	}
	if readBy == nil {
		readBy = []map[string]interface{}{}
	}
	if notReadBy == nil {
		notReadBy = []map[string]interface{}{}
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"total_students": totalStudents,
		"read_count":     len(readBy),
		"not_read_count": len(notReadBy),
		"read_by":        readBy,
		"not_read_by":    notReadBy,
	})
}
