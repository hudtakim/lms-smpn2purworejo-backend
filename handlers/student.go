package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"lms-backend-go/config"
	"lms-backend-go/middleware"

	chilib "github.com/go-chi/chi/v5"
)

// GetStudentAcademicYears - GET /api/student/academic-years
func GetStudentAcademicYears(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)

	if claims.Role == "parent" {
		dbRows, err := config.Pool.Query(context.Background(), `
			SELECT DISTINCT ay.id, ay.year_name, ay.semester, ay.is_active
			FROM academic_years ay
			JOIN classes c ON c.academic_year_id = ay.id
			JOIN class_members cm ON cm.class_id = c.id
			JOIN users u ON cm.student_id = u.id
			WHERE u.parent_id = $1 AND u.role = 'student'
			ORDER BY ay.id DESC
		`, claims.ID)
		if err != nil {
			serverError(w, r, err, "Terjadi kesalahan pada server")
			return
		}
		data, err := rowsToMaps(dbRows)
		if err != nil {
			serverError(w, r, err, "Terjadi kesalahan pada server")
			return
		}
		if data == nil {
			data = []map[string]interface{}{}
		}
		jsonResponse(w, http.StatusOK, data)
		return
	}

	// student
	dbRows, err := config.Pool.Query(context.Background(), `
		SELECT DISTINCT
			ay.id, ay.year_name, ay.semester, ay.is_active
		FROM academic_years ay
		JOIN classes c ON c.academic_year_id = ay.id
		JOIN class_members cm ON cm.class_id = c.id
		WHERE cm.student_id = $1
		ORDER BY ay.id DESC
	`, claims.ID)
	if err != nil {
		serverError(w, r, err, "Terjadi kesalahan pada server")
		return
	}
	data, err := rowsToMaps(dbRows)
	if err != nil {
		serverError(w, r, err, "Terjadi kesalahan pada server")
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, data)
}

// GetStudentDashboardMeta - GET /api/student/dashboard-meta
func GetStudentDashboardMeta(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	academicYearID := r.URL.Query().Get("academic_year_id")

	if academicYearID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "Academic year ID diperlukan"})
		return
	}

	var classID int64
	err := config.Pool.QueryRow(context.Background(), `
		SELECT c.id as class_id FROM class_members cm
		JOIN classes c ON cm.class_id = c.id
		WHERE cm.student_id = $1 AND c.academic_year_id = $2 LIMIT 1
	`, claims.ID, academicYearID).Scan(&classID)
	if err != nil {
		jsonResponse(w, http.StatusOK, map[string]interface{}{
			"tasks":                []interface{}{},
			"quizzes":              []interface{}{},
			"totalMaterials":       0,
			"attendancePercentage": 100,
		})
		return
	}

	taskRows, _ := config.Pool.Query(context.Background(), `
		SELECT
			t.id, t.title, t.due_date, sub.subject_name,
			CASE WHEN ts.student_id IS NOT NULL THEN true ELSE false END as is_submitted
		FROM tasks t
		JOIN subjects sub ON t.subject_id = sub.id
		LEFT JOIN task_scores ts ON ts.task_id = t.id AND ts.student_id = $1
		WHERE t.class_id = $2 AND DATE(t.due_date) >= CURRENT_DATE
		ORDER BY t.due_date ASC
	`, claims.ID, classID)
	tasks, _ := rowsToMaps(taskRows)
	if tasks == nil {
		tasks = []map[string]interface{}{}
	}

	quizRows, _ := config.Pool.Query(context.Background(), `
		SELECT
			q.id, q.title, q.exam_date as due_date,
			TO_CHAR(q.start_time, 'HH24:MI:SS') as start_time,
			TO_CHAR(q.end_time, 'HH24:MI:SS') as end_time,
			sub.subject_name,
			CASE WHEN qs.student_id IS NOT NULL THEN true ELSE false END as is_attempted
		FROM quizzes q
		JOIN subjects sub ON q.subject_id = sub.id
		LEFT JOIN quiz_scores qs ON qs.quiz_id = q.id AND qs.student_id = $1
		WHERE q.class_id = $2 AND DATE(q.exam_date) >= CURRENT_DATE
		ORDER BY q.exam_date ASC
	`, claims.ID, classID)
	quizzes, _ := rowsToMaps(quizRows)
	if quizzes == nil {
		quizzes = []map[string]interface{}{}
	}

	var totalMaterials int
	config.Pool.QueryRow(context.Background(),
		"SELECT COUNT(m.id)::INT as total FROM materials m WHERE m.class_id = $1", classID).Scan(&totalMaterials)

	// Calculate attendance (filtered by religion so agama subjects don't inflate counts)
	userReligion := strings.ToLower(claims.Religion)
	var totalJournals int
	config.Pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM teaching_journals tj
		JOIN subjects s ON tj.subject_id = s.id
		WHERE tj.class_id = $1 AND (
			NOT (s.subject_name ILIKE '%islam%' OR s.subject_name ILIKE '%katolik%' OR
			     s.subject_name ILIKE '%kristen%' OR s.subject_name ILIKE '%hindu%' OR
			     s.subject_name ILIKE '%buddha%' OR s.subject_name ILIKE '%konghucu%')
			OR s.subject_name ILIKE '%' || $2 || '%'
		)
	`, classID, userReligion).Scan(&totalJournals)

	var absentCount int
	config.Pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM teaching_journals tj
		JOIN subjects s ON tj.subject_id = s.id
		WHERE tj.class_id = $1 AND $2 = ANY(tj.absent_student_ids) AND (
			NOT (s.subject_name ILIKE '%islam%' OR s.subject_name ILIKE '%katolik%' OR
			     s.subject_name ILIKE '%kristen%' OR s.subject_name ILIKE '%hindu%' OR
			     s.subject_name ILIKE '%buddha%' OR s.subject_name ILIKE '%konghucu%')
			OR s.subject_name ILIKE '%' || $3 || '%'
		)
	`, classID, claims.ID, userReligion).Scan(&absentCount)

	attendancePct := 100.0
	if totalJournals > 0 {
		attendancePct = float64(totalJournals-absentCount) / float64(totalJournals) * 100
	}
	attendancePct = math.Round(attendancePct*10) / 10

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"tasks":                tasks,
		"quizzes":              quizzes,
		"totalMaterials":       totalMaterials,
		"attendancePercentage": attendancePct,
	})
}

// GetStudentSchedule - GET /api/student/my-schedule
func GetStudentSchedule(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	academicYearID := r.URL.Query().Get("academic_year_id")

	if academicYearID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"message": "Parameter academic_year_id diperlukan."})
		return
	}

	// 1. Find classId
	var classID int64
	err := config.Pool.QueryRow(context.Background(),
		"SELECT class_id FROM class_members INNER JOIN classes ON class_members.class_id = classes.id WHERE student_id = $1 AND classes.academic_year_id = $2",
		claims.ID, academicYearID,
	).Scan(&classID)
	if err != nil {
		jsonResponse(w, http.StatusNotFound, map[string]string{"message": "Anda belum terdaftar di kelas manapun."})
		return
	}

	// 2. Get day_var_global - cast time to text for easy parsing
	dayVarRows, err := config.Pool.Query(context.Background(),
		"SELECT day_of_week, TO_CHAR(start_time_school, 'HH24:MI:SS') as start_time_school, kbm_duration_minutes FROM day_var_global")
	if err != nil {
		serverError(w, r, err, "Gagal memproses data jadwal pelajaran.")
		return
	}
	dayVars, _ := rowsToMaps(dayVarRows)

	// 3. Get global_time_slots for this academic year
	slotRows, err := config.Pool.Query(context.Background(), `
		SELECT slot_number, slot_type, label_name, custom_duration_minutes, day_of_week
		FROM global_time_slots
		WHERE academic_year_id = $1 ORDER BY slot_number ASC
	`, academicYearID)
	if err != nil {
		serverError(w, r, err, "Gagal memproses data jadwal pelajaran.")
		return
	}
	globalSlots, _ := rowsToMaps(slotRows)

	// 4. Get schedules with join to subjects & teachers
	studentReligion := strings.ToLower(claims.Religion)
	scheduleRows, err := config.Pool.Query(context.Background(), `
		SELECT
			s.day_of_week,
			s.slot_number,
			sub.subject_name,
			u.full_name as teacher_name
		FROM schedules s
		JOIN class_subjects cs ON s.class_subject_id = cs.id
		JOIN subjects sub ON cs.subject_id = sub.id
		JOIN users u ON cs.teacher_id = u.id
		JOIN classes c ON s.class_id = c.id
		WHERE s.class_id = $1 AND c.academic_year_id = $2 AND s.academic_year_id = $2 AND (
			NOT (sub.subject_name ILIKE '%islam%' OR sub.subject_name ILIKE '%katolik%' OR
			     sub.subject_name ILIKE '%kristen%' OR sub.subject_name ILIKE '%hindu%' OR
			     sub.subject_name ILIKE '%buddha%' OR sub.subject_name ILIKE '%konghucu%')
			OR sub.subject_name ILIKE '%' || $3 || '%'
		)
	`, classID, academicYearID, studentReligion)
	if err != nil {
		serverError(w, r, err, "Gagal memproses data jadwal pelajaran.")
		return
	}
	schedules, _ := rowsToMaps(scheduleRows)

	// 5. Time calculation engine
	daysNameMap := map[int]string{1: "Senin", 2: "Selasa", 3: "Rabu", 4: "Kamis", 5: "Jumat", 6: "Sabtu", 7: "Minggu"}
	formattedSchedule := map[string][]map[string]interface{}{
		"Senin": {}, "Selasa": {}, "Rabu": {}, "Kamis": {}, "Jumat": {}, "Sabtu": {}, "Minggu": {},
	}

	formatJam := func(totalMins int) string {
		return fmt.Sprintf("%02d:%02d", totalMins/60, totalMins%60)
	}

	for dayNum := 1; dayNum <= 7; dayNum++ {
		dayName := daysNameMap[dayNum]

		// find daySetting
		var daySetting map[string]interface{}
		for _, d := range dayVars {
			if toIntIface(d["day_of_week"]) == dayNum {
				daySetting = d
				break
			}
		}

		// filter slots for this day (already ordered by slot_number from query)
		var todaySlots []map[string]interface{}
		for _, s := range globalSlots {
			if toIntIface(s["day_of_week"]) == dayNum {
				todaySlots = append(todaySlots, s)
			}
		}

		if daySetting == nil || len(todaySlots) == 0 {
			continue
		}

		// Parse start time "HH:MM:SS"
		startTimeStr := fmt.Sprintf("%v", daySetting["start_time_school"])
		parts := strings.SplitN(startTimeStr, ":", 3)
		jam, _ := strconv.Atoi(parts[0])
		menit := 0
		if len(parts) > 1 {
			menit, _ = strconv.Atoi(parts[1])
		}
		totalMins := jam*60 + menit

		defaultDuration := toIntIface(daySetting["kbm_duration_minutes"])
		if defaultDuration == 0 {
			defaultDuration = 40
		}

		for _, slot := range todaySlots {
			startMins := totalMins
			slotType := fmt.Sprintf("%v", slot["slot_type"])

			var durasi int
			if slotType == "kbm" {
				durasi = defaultDuration
			} else {
				durasi = toIntIface(slot["custom_duration_minutes"])
				if durasi == 0 {
					durasi = 15
				}
			}
			endMins := startMins + durasi
			totalMins = endMins

			timeStr := fmt.Sprintf("%s - %s", formatJam(startMins), formatJam(endMins))

			if slotType == "kbm" {
				slotNum := toIntIface(slot["slot_number"])
				// find matching schedule entry
				var matchedSched map[string]interface{}
				for _, sched := range schedules {
					if fmt.Sprintf("%v", sched["day_of_week"]) == dayName && toIntIface(sched["slot_number"]) == slotNum {
						matchedSched = sched
						break
					}
				}
				if matchedSched != nil {
					formattedSchedule[dayName] = append(formattedSchedule[dayName], map[string]interface{}{
						"time":    timeStr,
						"subject": matchedSched["subject_name"],
						"teacher": matchedSched["teacher_name"],
					})
				} else {
					formattedSchedule[dayName] = append(formattedSchedule[dayName], map[string]interface{}{
						"time":    timeStr,
						"subject": "Kosong - (Belum Ada Jadwal)",
						"teacher": "-",
					})
				}
			} else {
				labelName := fmt.Sprintf("%v", slot["label_name"])
				if labelName == "<nil>" || labelName == "" {
					labelName = "Istirahat"
				}
				formattedSchedule[dayName] = append(formattedSchedule[dayName], map[string]interface{}{
					"time":    timeStr,
					"subject": labelName,
					"teacher": "",
				})
			}
		}
	}

	jsonResponse(w, http.StatusOK, formattedSchedule)
}

// GetStudentSubjects - GET /api/student/my-subjects
func GetStudentSubjects(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	academicYearID := r.URL.Query().Get("academic_year_id")

	if academicYearID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"message": "academic_year_id diperlukan."})
		return
	}

	userReligion := strings.ToLower(claims.Religion)
	rows, err := config.Pool.Query(context.Background(), `
		SELECT
			s.id AS subject_id,
			s.subject_name,
			s.subject_code,
			COUNT(DISTINCT m.id) AS total_modul
		FROM subjects s
		LEFT JOIN class_members cm ON cm.student_id = $1
		LEFT JOIN classes c ON c.id = cm.class_id AND s.grade = c.grade
		LEFT JOIN materials m ON m.subject_id = s.id AND m.class_id = c.id
		JOIN class_subjects cs ON cs.subject_id = s.id
		JOIN schedules sch ON sch.class_id = c.id AND sch.class_subject_id = cs.id
		WHERE c.academic_year_id = $2 AND (
			NOT (s.subject_name ILIKE '%islam%' OR s.subject_name ILIKE '%katolik%' OR
			     s.subject_name ILIKE '%kristen%' OR s.subject_name ILIKE '%hindu%' OR
			     s.subject_name ILIKE '%buddha%' OR s.subject_name ILIKE '%konghucu%')
			OR s.subject_name ILIKE '%' || $3 || '%'
		)
		GROUP BY s.id, s.subject_name, s.subject_code
		ORDER BY s.subject_name ASC
	`, claims.ID, academicYearID, userReligion)
	if err != nil {
		serverError(w, r, err, "Gagal mengambil mata pelajaran.")
		return
	}
	data, _ := rowsToMaps(rows)
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, data)
}

// GetStudentMaterials - GET /api/student/my-materials/:subjectId
func GetStudentMaterials(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	subjectID := chilib.URLParam(r, "subjectId")
	academicYearID := r.URL.Query().Get("academic_year_id")

	rows, err := config.Pool.Query(context.Background(), `
		SELECT m.id, m.title, m.description, m.link_url, m.file_url, m.created_at, u.full_name as teacher_name
		FROM materials m
		JOIN classes c ON m.class_id = c.id
		JOIN class_members cm ON cm.class_id = c.id
		JOIN users u ON m.teacher_id = u.id
		WHERE cm.student_id = $1 AND c.academic_year_id = $2 AND m.subject_id = $3
		ORDER BY m.created_at DESC
	`, claims.ID, academicYearID, subjectID)
	if err != nil {
		serverError(w, r, err, "Gagal mengambil daftar materi.")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Gagal mengambil daftar materi.")
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, data)
}

// GetStudentTaskSubjects - GET /api/student/my-task-subjects
func GetStudentTaskSubjects(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	academicYearID := r.URL.Query().Get("academic_year_id")

	if academicYearID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"message": "academic_year_id diperlukan."})
		return
	}

	userReligion := strings.ToLower(claims.Religion)
	rows, err := config.Pool.Query(context.Background(), `
		SELECT
			s.id AS subject_id,
			s.subject_name,
			s.subject_code,
			COUNT(DISTINCT t.id) AS total_tasks,
			COUNT(DISTINCT CASE
				WHEN ts.student_id = $1 AND (ts.task_url IS NOT NULL OR ts.score IS NOT NULL)
				THEN t.id
			END) AS submitted_tasks,
			COUNT(DISTINCT CASE
				WHEN (ts.task_id IS NULL OR (ts.task_url IS NULL AND ts.score IS NULL))
					 AND t.due_date IS NOT NULL
					 AND t.due_date <= CURRENT_DATE + INTERVAL '3 days'
				THEN t.id
			END) AS urgent_tasks
		FROM subjects s
		JOIN class_members cm ON cm.student_id = $1
		JOIN classes c ON c.id = cm.class_id AND c.grade = s.grade
		LEFT JOIN tasks t ON t.subject_id = s.id AND t.class_id = c.id AND t.due_date >= CURRENT_DATE
		LEFT JOIN task_scores ts ON ts.task_id = t.id AND ts.student_id = $1
		JOIN class_subjects cs ON cs.subject_id = s.id
		JOIN schedules sch ON sch.class_id = c.id AND sch.class_subject_id = cs.id
		WHERE c.academic_year_id = $2 AND (
			NOT (s.subject_name ILIKE '%islam%' OR s.subject_name ILIKE '%katolik%' OR
			     s.subject_name ILIKE '%kristen%' OR s.subject_name ILIKE '%hindu%' OR
			     s.subject_name ILIKE '%buddha%' OR s.subject_name ILIKE '%konghucu%')
			OR s.subject_name ILIKE '%' || $3 || '%'
		)
		GROUP BY s.id, s.subject_name, s.subject_code
		ORDER BY s.subject_name ASC
	`, claims.ID, academicYearID, userReligion)
	if err != nil {
		serverError(w, r, err, "Gagal mengambil ringkasan tugas.")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Gagal mengambil ringkasan tugas.")
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, data)
}

// GetStudentTasks - GET /api/student/my-tasks/:subjectId
func GetStudentTasks(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	subjectID := chilib.URLParam(r, "subjectId")
	academicYearID := r.URL.Query().Get("academic_year_id")

	rows, err := config.Pool.Query(context.Background(), `
		SELECT
			t.id, t.title, t.description, t.link_url, t.file_url, t.due_date, t.created_at,
			ts.score, ts.task_url as student_submission_url,
			COALESCE(ts.updated_at, ts.created_at) AS submitted_at,
			CASE WHEN ts.student_id IS NOT NULL THEN true ELSE false END as is_submitted,
			u.full_name as teacher_name
		FROM tasks t
		JOIN classes c ON t.class_id = c.id
		JOIN class_members cm ON cm.class_id = c.id
		JOIN users u ON t.teacher_id = u.id
		LEFT JOIN task_scores ts ON ts.task_id = t.id AND ts.student_id = $1
		WHERE cm.student_id = $1 AND c.academic_year_id = $2 AND t.subject_id = $3
		ORDER BY t.created_at DESC
	`, claims.ID, academicYearID, subjectID)
	if err != nil {
		serverError(w, r, err, "Gagal mengambil detail tugas.")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Gagal mengambil detail tugas.")
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, data)
}

// GetStudentQuizSubjects - GET /api/student/my-quiz-subjects
func GetStudentQuizSubjects(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	academicYearID := r.URL.Query().Get("academic_year_id")

	if academicYearID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"message": "Parameter academic_year_id diperlukan."})
		return
	}

	userReligion := strings.ToLower(claims.Religion)
	rows, err := config.Pool.Query(context.Background(), `
		SELECT
			s.id as subject_id,
			s.subject_name,
			s.subject_code,
			COUNT(DISTINCT q.id) as total_quizzes,
			COUNT(DISTINCT CASE
				WHEN qs.score IS NOT NULL THEN q.id
			END) as submitted_quizzes,
			COUNT(DISTINCT CASE
				WHEN q.exam_date IS NOT NULL
					AND (q.exam_date::date - CURRENT_DATE) <= 1
					AND (q.exam_date::date - CURRENT_DATE) >= 0
				THEN q.id
			END) as urgent_quizzes
		FROM class_members cm
		JOIN classes c ON cm.class_id = c.id
		JOIN class_subjects cs ON cs.academic_year_id = c.academic_year_id
		JOIN subjects s ON cs.subject_id = s.id
		LEFT JOIN quizzes q ON q.subject_id = s.id AND q.class_id = c.id AND (q.exam_date + q.end_time) >= CURRENT_TIMESTAMP
		LEFT JOIN quiz_scores qs ON qs.quiz_id = q.id AND qs.student_id = $1
		JOIN schedules sch ON sch.class_id = c.id AND sch.class_subject_id = cs.id
		WHERE cm.student_id = $1 AND c.academic_year_id = $2 AND (
			NOT (s.subject_name ILIKE '%islam%' OR s.subject_name ILIKE '%katolik%' OR
			     s.subject_name ILIKE '%kristen%' OR s.subject_name ILIKE '%hindu%' OR
			     s.subject_name ILIKE '%buddha%' OR s.subject_name ILIKE '%konghucu%')
			OR s.subject_name ILIKE '%' || $3 || '%'
		)
		GROUP BY s.id, s.subject_name, s.subject_code
		ORDER BY s.subject_name ASC
	`, claims.ID, academicYearID, userReligion)
	if err != nil {
		serverError(w, r, err, "Gagal mengambil ringkasan kuis.")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Gagal mengambil ringkasan kuis.")
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, data)
}

// GetStudentQuizzes - GET /api/student/my-quizzes/:subjectId
func GetStudentQuizzes(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	subjectID := chilib.URLParam(r, "subjectId")
	academicYearID := r.URL.Query().Get("academic_year_id")

	rows, err := config.Pool.Query(context.Background(), `
		SELECT
			q.id, q.title, q.instruction, q.embed_url,
			q.exam_date,
			TO_CHAR(q.start_time, 'HH24:MI:SS') as start_time,
			TO_CHAR(q.end_time, 'HH24:MI:SS') as end_time,
			q.created_at,
			qs.score,
			COALESCE(s.kkm::numeric, ay_kkm.default_kkm::numeric, 80) as kkm,
			CASE WHEN qs.student_id IS NOT NULL THEN true ELSE false END as is_submitted,
			u.full_name as teacher_name
		FROM quizzes q
		JOIN classes c ON q.class_id = c.id
		JOIN class_members cm ON cm.class_id = c.id
		JOIN users u ON q.teacher_id = u.id
		JOIN subjects s ON q.subject_id = s.id
		LEFT JOIN academic_year_kkm ay_kkm ON ay_kkm.academic_year_id = c.academic_year_id
		LEFT JOIN quiz_scores qs ON qs.quiz_id = q.id AND qs.student_id = $1
		WHERE cm.student_id = $1 AND c.academic_year_id = $2 AND q.subject_id = $3
		ORDER BY is_submitted ASC, q.exam_date ASC, q.start_time ASC
	`, claims.ID, academicYearID, subjectID)
	if err != nil {
		serverError(w, r, err, "Gagal mengambil detail kuis.")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Gagal mengambil detail kuis.")
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, data)
}

// SubmitTask - POST /api/student/submit-task/:taskId
func SubmitTask(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	taskID := chilib.URLParam(r, "taskId")

	var body struct {
		SubmissionURL string `json:"submission_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "URL pengumpulan tidak boleh kosong!")
		return
	}

	if body.SubmissionURL == "" {
		jsonError(w, http.StatusBadRequest, "URL pengumpulan tidak boleh kosong!")
		return
	}

	_, err := config.Pool.Exec(context.Background(), `
		INSERT INTO task_scores (task_id, student_id, task_url, created_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (task_id, student_id) DO UPDATE SET
			task_url = EXCLUDED.task_url,
			updated_at = NOW()
	`, taskID, claims.ID, body.SubmissionURL)
	if err != nil {
		serverError(w, r, err, "Terjadi kesalahan internal pada server.")
		return
	}
	jsonResponse(w, http.StatusOK, map[string]string{"message": "Tugas berhasil dikumpulkan!"})
}

// GetStudentGrades - GET /api/student/my-grades
func GetStudentGrades(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	academicYearID := r.URL.Query().Get("academic_year_id")

	if academicYearID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"message": "Parameter academic_year_id diperlukan."})
		return
	}

	// 1. Get subjects via schedules join (same as original)
	userReligion := strings.ToLower(claims.Religion)
	subjectRows, err := config.Pool.Query(context.Background(), `
		SELECT DISTINCT
			sub.id as subject_id,
			sub.subject_name,
			u.full_name as teacher_name,
			COALESCE(sub.kkm::float8, apset.setting_value::float8) as kkm
		FROM class_members cm
		JOIN classes c ON cm.class_id = c.id
		JOIN schedules s ON s.class_id = c.id
		JOIN class_subjects cs ON s.class_subject_id = cs.id
		JOIN subjects sub ON cs.subject_id = sub.id
		JOIN users u ON cs.teacher_id = u.id
		LEFT JOIN app_settings apset ON apset.setting_key = 'default_kkm'
		WHERE cm.student_id = $1 AND c.academic_year_id = $2 AND (
			NOT (sub.subject_name ILIKE '%islam%' OR sub.subject_name ILIKE '%katolik%' OR
			     sub.subject_name ILIKE '%kristen%' OR sub.subject_name ILIKE '%hindu%' OR
			     sub.subject_name ILIKE '%buddha%' OR sub.subject_name ILIKE '%konghucu%')
			OR sub.subject_name ILIKE '%' || $3 || '%'
		)
		ORDER BY sub.subject_name ASC
	`, claims.ID, academicYearID, userReligion)
	if err != nil {
		serverError(w, r, err, "Gagal mengambil rekap nilai.")
		return
	}
	subjects, _ := rowsToMaps(subjectRows)

	// 2. Get all task scores for this student in this academic year
	taskRows, _ := config.Pool.Query(context.Background(), `
		SELECT t.subject_id, t.title, ts.score::float8 as score
		FROM tasks t
		JOIN classes c ON t.class_id = c.id
		JOIN task_scores ts ON ts.task_id = t.id AND ts.student_id = $1
		WHERE c.academic_year_id = $2 AND ts.score IS NOT NULL
		ORDER BY t.created_at ASC
	`, claims.ID, academicYearID)
	allTaskScores, _ := rowsToMaps(taskRows)

	// 3. Get all quiz scores for this student in this academic year
	quizRows, _ := config.Pool.Query(context.Background(), `
		SELECT q.subject_id, q.title, qs.score::float8 as score
		FROM quizzes q
		JOIN classes c ON q.class_id = c.id
		JOIN quiz_scores qs ON qs.quiz_id = q.id AND qs.student_id = $1
		WHERE c.academic_year_id = $2 AND qs.score IS NOT NULL
		ORDER BY q.created_at ASC
	`, claims.ID, academicYearID)
	allQuizScores, _ := rowsToMaps(quizRows)

	emojis := []string{"📐", "🔬", "📚", "🌍", "💻", "🎨", "⚽", "🎵", "💡"}

	// 4. Map & categorize per subject
	result := []map[string]interface{}{}
	for i, sub := range subjects {
		subjectID := sub["subject_id"]

		// Filter task scores for this subject
		tugas := []map[string]interface{}{}
		for _, t := range allTaskScores {
			if fmt.Sprintf("%v", t["subject_id"]) == fmt.Sprintf("%v", subjectID) {
				tugas = append(tugas, map[string]interface{}{
					"title": t["title"],
					"score": toFloat64(t["score"]),
				})
			}
		}

		// Categorize quiz scores: uh, uts, uas
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
			if strings.Contains(titleUpper, "UTS") || strings.Contains(titleUpper, "TENGAH SEMESTER") {
				uts = append(uts, entry)
			} else if strings.Contains(titleUpper, "UAS") || strings.Contains(titleUpper, "AKHIR SEMESTER") {
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
			"icon":    emojis[i%len(emojis)],
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

// suppress unused import
var _ = strconv.Itoa
