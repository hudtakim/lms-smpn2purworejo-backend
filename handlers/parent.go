package handlers

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strings"

	"lms-backend-go/config"
	"lms-backend-go/middleware"
)

// GetMyChildren - GET /api/parent/my-children
func GetMyChildren(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)

	rows, err := config.Pool.Query(context.Background(), `
		SELECT id as student_id, full_name, username, gender, religion
		FROM users
		WHERE role = 'student' AND parent_id = $1
		ORDER BY full_name ASC
	`, claims.ID)
	if err != nil {
		serverError(w, r, err, "Gagal mengambil data anak")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Gagal mengambil data anak")
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, data)
}

// GetParentDashboardMeta - GET /api/parent/dashboard-meta
func GetParentDashboardMeta(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	studentID := r.URL.Query().Get("student_id")
	academicYearID := r.URL.Query().Get("academic_year_id")

	if studentID == "" || academicYearID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "student_id dan academic_year_id diperlukan"})
		return
	}

	// Security check: ensure student belongs to this parent
	var existingID int64
	err := config.Pool.QueryRow(context.Background(),
		"SELECT id FROM users WHERE id = $1 AND parent_id = $2",
		studentID, claims.ID).Scan(&existingID)
	if err != nil {
		jsonResponse(w, http.StatusForbidden, map[string]string{"error": "Akses ditolak. Ini bukan data anak Anda."})
		return
	}

	// Class lookup with className and homeroomTeacher
	var classID int64
	var className string
	var homeroomTeacher *string
	err = config.Pool.QueryRow(context.Background(), `
		SELECT c.id as class_id, CONCAT(c.grade, '-', c.name) as class_name, u.full_name as homeroom_teacher
		FROM class_members cm
		JOIN classes c ON cm.class_id = c.id
		LEFT JOIN users u ON c.homeroom_teacher_id = u.id
		WHERE cm.student_id = $1 AND c.academic_year_id = $2 LIMIT 1
	`, studentID, academicYearID).Scan(&classID, &className, &homeroomTeacher)
	if err != nil {
		jsonResponse(w, http.StatusOK, map[string]interface{}{
			"tasks":                []interface{}{},
			"quizzes":              []interface{}{},
			"attendancePercentage": 100,
			"className":            "Belum ada kelas",
			"homeRoomTeacher":      nil,
			"todayAttendance":      []interface{}{},
		})
		return
	}

	// Tasks (today and future)
	taskRows, _ := config.Pool.Query(context.Background(), `
		SELECT t.id, t.title, t.due_date, sub.subject_name,
			CASE WHEN ts.student_id IS NOT NULL THEN true ELSE false END as is_submitted,
			ts.score
		FROM tasks t
		JOIN subjects sub ON t.subject_id = sub.id
		LEFT JOIN task_scores ts ON ts.task_id = t.id AND ts.student_id = $1
		WHERE t.class_id = $2 AND DATE(t.due_date) >= CURRENT_DATE
		ORDER BY t.due_date ASC
	`, studentID, classID)
	tasks, _ := rowsToMaps(taskRows)
	if tasks == nil {
		tasks = []map[string]interface{}{}
	}

	// Quizzes (today and future)
	quizRows, _ := config.Pool.Query(context.Background(), `
		SELECT q.id, q.title, q.exam_date as due_date,
			TO_CHAR(q.start_time, 'HH24:MI:SS') as start_time,
			TO_CHAR(q.end_time, 'HH24:MI:SS') as end_time,
			sub.subject_name,
			CASE WHEN qs.student_id IS NOT NULL THEN true ELSE false END as is_attempted,
			qs.score
		FROM quizzes q
		JOIN subjects sub ON q.subject_id = sub.id
		LEFT JOIN quiz_scores qs ON qs.quiz_id = q.id AND qs.student_id = $1
		WHERE q.class_id = $2 AND DATE(q.exam_date) >= CURRENT_DATE
		ORDER BY q.exam_date ASC
	`, studentID, classID)
	quizzes, _ := rowsToMaps(quizRows)
	if quizzes == nil {
		quizzes = []map[string]interface{}{}
	}

	// Today's attendance journals
	todayRows, _ := config.Pool.Query(context.Background(), `
		SELECT
			COALESCE($1::int = ANY(tj.absent_student_ids), false) as is_absent,
			tj.slots_taught,
			COALESCE(sub.subject_name, 'Umum') as subject_name,
			COALESCE(u.full_name, 'Guru Tidak Diketahui') as teacher_name
		FROM teaching_journals tj
		LEFT JOIN subjects sub ON tj.subject_id = sub.id
		LEFT JOIN users u ON tj.teacher_id = u.id
		WHERE tj.class_id = $2 AND DATE(tj.journal_date) = CURRENT_DATE
		ORDER BY tj.journal_date ASC
	`, studentID, classID)
	todayJournals, _ := rowsToMaps(todayRows)

	todayAttendance := []map[string]interface{}{}
	for _, j := range todayJournals {
		isAbsent, _ := j["is_absent"].(bool)
		slotsRaw := fmt.Sprintf("%v", j["slots_taught"])
		formattedSlots := "-"
		if slotsRaw != "" && slotsRaw != "<nil>" {
			parts := strings.Split(slotsRaw, ",")
			for i := range parts {
				parts[i] = strings.TrimSpace(parts[i])
			}
			formattedSlots = strings.Join(parts, ", ")
		}
		status := "Hadir"
		if isAbsent {
			status = "Absen"
		}
		todayAttendance = append(todayAttendance, map[string]interface{}{
			"subject": j["subject_name"],
			"teacher": j["teacher_name"],
			"slots":   formattedSlots,
			"status":  status,
		})
	}

	// Global attendance calculation (full semester)
	var totalMeetings int
	config.Pool.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM teaching_journals WHERE class_id = $1", classID).Scan(&totalMeetings)

	var totalAbsences int
	config.Pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM teaching_journals
		WHERE class_id = $1 AND $2::int = ANY(absent_student_ids)
	`, classID, studentID).Scan(&totalAbsences)

	attendancePct := 100.0
	if totalMeetings > 0 {
		attendancePct = float64(totalMeetings-totalAbsences) / float64(totalMeetings) * 100
	}
	attendancePct = math.Round(attendancePct*10) / 10

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"className":            className,
		"homeroomTeacher":      homeroomTeacher,
		"tasks":                tasks,
		"quizzes":              quizzes,
		"attendancePercentage": attendancePct,
		"totalAbsences":        totalAbsences,
		"totalMeetings":        totalMeetings,
		"todayAttendance":      todayAttendance,
	})
}

// GetParentGrades - GET /api/parent/grades
func GetParentGrades(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	studentID := r.URL.Query().Get("student_id")
	academicYearID := r.URL.Query().Get("academic_year_id")

	if studentID == "" || academicYearID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"message": "student_id dan academic_year_id diperlukan."})
		return
	}

	// Security check
	var existingID int64
	err := config.Pool.QueryRow(context.Background(),
		"SELECT id FROM users WHERE id = $1 AND parent_id = $2",
		studentID, claims.ID).Scan(&existingID)
	if err != nil {
		jsonResponse(w, http.StatusForbidden, map[string]string{"error": "Akses ditolak."})
		return
	}

	// 1. Subjects via schedules join (same as student grades)
	subjectRows, _ := config.Pool.Query(context.Background(), `
		SELECT DISTINCT sub.id as subject_id, sub.subject_name, u.full_name as teacher_name,
			COALESCE(sub.kkm::float8, apset.setting_value::float8) as kkm
		FROM class_members cm
		JOIN classes c ON cm.class_id = c.id
		JOIN schedules s ON s.class_id = c.id
		JOIN class_subjects cs ON s.class_subject_id = cs.id
		JOIN subjects sub ON cs.subject_id = sub.id
		JOIN users u ON cs.teacher_id = u.id
		LEFT JOIN app_settings apset ON apset.setting_key = 'default_kkm'
		WHERE cm.student_id = $1 AND c.academic_year_id = $2
	`, studentID, academicYearID)
	subjects, _ := rowsToMaps(subjectRows)

	// 2. Task scores
	taskRows, _ := config.Pool.Query(context.Background(), `
		SELECT t.subject_id, t.title, ts.score::float8 as score
		FROM tasks t
		JOIN classes c ON t.class_id = c.id
		JOIN task_scores ts ON ts.task_id = t.id AND ts.student_id = $1
		WHERE c.academic_year_id = $2 AND ts.score IS NOT NULL
	`, studentID, academicYearID)
	allTaskScores, _ := rowsToMaps(taskRows)

	// 3. Quiz scores
	quizRows, _ := config.Pool.Query(context.Background(), `
		SELECT q.subject_id, q.title, qs.score::float8 as score
		FROM quizzes q
		JOIN classes c ON q.class_id = c.id
		JOIN quiz_scores qs ON qs.quiz_id = q.id AND qs.student_id = $1
		WHERE c.academic_year_id = $2 AND qs.score IS NOT NULL
	`, studentID, academicYearID)
	allQuizScores, _ := rowsToMaps(quizRows)

	// 4. Map & categorize per subject (no icon for parent)
	result := []map[string]interface{}{}
	for _, sub := range subjects {
		subjectID := sub["subject_id"]

		tugas := []map[string]interface{}{}
		for _, t := range allTaskScores {
			if fmt.Sprintf("%v", t["subject_id"]) == fmt.Sprintf("%v", subjectID) {
				tugas = append(tugas, map[string]interface{}{
					"title": t["title"],
					"score": toFloat64(t["score"]),
				})
			}
		}

		uh := []map[string]interface{}{}
		uts := []map[string]interface{}{}
		uas := []map[string]interface{}{}
		for _, q := range allQuizScores {
			if fmt.Sprintf("%v", q["subject_id"]) != fmt.Sprintf("%v", subjectID) {
				continue
			}
			titleUpper := strings.ToUpper(fmt.Sprintf("%v", q["title"]))
			entry := map[string]interface{}{
				"title": q["title"],
				"score": toFloat64(q["score"]),
			}
			// Parent uses "TENGAH" and "AKHIR" (shorter than student's version)
			if strings.Contains(titleUpper, "UTS") || strings.Contains(titleUpper, "TENGAH") {
				uts = append(uts, entry)
			} else if strings.Contains(titleUpper, "UAS") || strings.Contains(titleUpper, "AKHIR") {
				uas = append(uas, entry)
			} else {
				uh = append(uh, entry)
			}
		}

		kkm := toFloat64(sub["kkm"])
		if kkm == 0 {
			kkm = 75
		}

		result = append(result, map[string]interface{}{
			"subject": sub["subject_name"],
			"teacher": sub["teacher_name"],
			"kkm":     kkm,
			"categories": map[string]interface{}{
				"tugas": tugas,
				"uh":    uh,
				"uts":   uts,
				"uas":   uas,
			},
		})
	}

	jsonResponse(w, http.StatusOK, result)
}

// GetParentAttendance - GET /api/parent/attendance
func GetParentAttendance(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	studentID := r.URL.Query().Get("student_id")
	academicYearID := r.URL.Query().Get("academic_year_id")

	// Security check
	var existingID int64
	err := config.Pool.QueryRow(context.Background(),
		"SELECT id FROM users WHERE id = $1 AND parent_id = $2",
		studentID, claims.ID).Scan(&existingID)
	if err != nil {
		jsonResponse(w, http.StatusForbidden, map[string]string{"error": "Akses ditolak."})
		return
	}

	// Filter journals where student is absent for this academic year
	rows, err := config.Pool.Query(context.Background(), `
		SELECT tj.journal_date, tj.real_time_range, tj.notes, tj.absent_student_ids, sub.subject_name, u.full_name as teacher_name
		FROM teaching_journals tj
		JOIN classes c ON tj.class_id = c.id
		JOIN subjects sub ON tj.subject_id = sub.id
		JOIN users u ON tj.teacher_id = u.id
		WHERE $1::int = ANY(tj.absent_student_ids) AND c.academic_year_id = $2
		ORDER BY tj.journal_date DESC
	`, studentID, academicYearID)
	if err != nil {
		serverError(w, r, err, "Gagal mengambil riwayat absensi anak.")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Gagal mengambil riwayat absensi anak.")
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, data)
}
