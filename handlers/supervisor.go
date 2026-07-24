package handlers

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strings"

	"lms-backend-go/config"
)

// GetSupervisorDashboard - GET /api/supervisor/dashboard
func GetSupervisorDashboard(w http.ResponseWriter, r *http.Request) {
	academicYearID := r.URL.Query().Get("academic_year_id")

	if academicYearID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "academic_year_id diperlukan untuk memuat dashboard."})
		return
	}

	// 1. Average grade
	var avgGrade *float64
	config.Pool.QueryRow(context.Background(), `
		SELECT COALESCE(ROUND(AVG(gabungan_nilai.score)::numeric, 1), NULL)::float8 as avg_score
		FROM (
			SELECT ts.score FROM task_scores ts
			JOIN tasks t ON ts.task_id = t.id JOIN classes c ON t.class_id = c.id
			JOIN subjects s ON t.subject_id = s.id
			JOIN users u ON ts.student_id = u.id
			WHERE c.academic_year_id = $1 AND ts.score IS NOT NULL
			AND (s.subject_name NOT ILIKE ALL(ARRAY['%Islam%', '%Kristen%', '%Katolik%', '%Hindu%', '%Budha%', '%Konghucu%']) OR s.subject_name ILIKE '%' || u.religion || '%')
			UNION ALL
			SELECT qs.score FROM quiz_scores qs
			JOIN quizzes q ON qs.quiz_id = q.id JOIN classes c ON q.class_id = c.id
			JOIN subjects s ON q.subject_id = s.id
			JOIN users u ON qs.student_id = u.id
			WHERE c.academic_year_id = $1 AND qs.score IS NOT NULL
			AND (s.subject_name NOT ILIKE ALL(ARRAY['%Islam%', '%Kristen%', '%Katolik%', '%Hindu%', '%Budha%', '%Konghucu%']) OR s.subject_name ILIKE '%' || u.religion || '%')
		) as gabungan_nilai
	`, academicYearID).Scan(&avgGrade)
	avgGradeVal := 0.0
	if avgGrade != nil {
		avgGradeVal = *avgGrade
	}

	// 2A. Submission stats (completion rate + below KKM)
	var totalSubmitted, totalGraded, belowKkm int64
	config.Pool.QueryRow(context.Background(), `
		WITH GlobalSetting AS (
			SELECT COALESCE(
				(SELECT default_kkm FROM academic_year_kkm WHERE academic_year_id = $1 LIMIT 1),
				80
			) AS default_kkm
		),
		GabunganSubmission AS (
			SELECT ts.id, ts.score, COALESCE(s.kkm, g.default_kkm) AS kkm_acuan
			FROM task_scores ts
			JOIN tasks t ON ts.task_id = t.id JOIN classes c ON t.class_id = c.id JOIN subjects s ON t.subject_id = s.id
			JOIN users u ON ts.student_id = u.id
			CROSS JOIN GlobalSetting g
			WHERE c.academic_year_id = $1
			AND (s.subject_name NOT ILIKE ALL(ARRAY['%Islam%', '%Kristen%', '%Katolik%', '%Hindu%', '%Budha%', '%Konghucu%']) OR s.subject_name ILIKE '%' || u.religion || '%')
			UNION ALL
			SELECT qs.id, qs.score, COALESCE(s.kkm, g.default_kkm) AS kkm_acuan
			FROM quiz_scores qs
			JOIN quizzes q ON qs.quiz_id = q.id JOIN classes c ON q.class_id = c.id JOIN subjects s ON q.subject_id = s.id
			JOIN users u ON qs.student_id = u.id
			CROSS JOIN GlobalSetting g
			WHERE c.academic_year_id = $1
			AND (s.subject_name NOT ILIKE ALL(ARRAY['%Islam%', '%Kristen%', '%Katolik%', '%Hindu%', '%Budha%', '%Konghucu%']) OR s.subject_name ILIKE '%' || u.religion || '%')
		)
		SELECT
			COUNT(id)::bigint as total_submitted,
			SUM(CASE WHEN score IS NOT NULL THEN 1 ELSE 0 END)::bigint as total_graded,
			SUM(CASE WHEN score < kkm_acuan THEN 1 ELSE 0 END)::bigint as below_kkm
		FROM GabunganSubmission
	`, academicYearID).Scan(&totalSubmitted, &totalGraded, &belowKkm)

	completionRate := 0
	if totalSubmitted > 0 {
		completionRate = int(math.Round(float64(totalGraded) / float64(totalSubmitted) * 100))
	}

	// 2B. Passing rate
	var passingRateRaw *float64
	config.Pool.QueryRow(context.Background(), `
		WITH GlobalSetting AS (
			SELECT COALESCE(
				(SELECT default_kkm FROM academic_year_kkm WHERE academic_year_id = $1 LIMIT 1),
				80
			) AS default_kkm
		),
		PerItemStats AS (
			SELECT
				t.id AS item_id,
				COUNT(ts.score) AS total_graded,
				SUM(CASE WHEN ts.score >= COALESCE(s.kkm, g.default_kkm) THEN 1 ELSE 0 END) AS passed_count
			FROM tasks t
			JOIN classes c ON t.class_id = c.id
			JOIN subjects s ON t.subject_id = s.id
			JOIN task_scores ts ON ts.task_id = t.id
			JOIN users u ON ts.student_id = u.id
			CROSS JOIN GlobalSetting g
			WHERE c.academic_year_id = $1
			AND (s.subject_name NOT ILIKE ALL(ARRAY['%Islam%', '%Kristen%', '%Katolik%', '%Hindu%', '%Budha%', '%Konghucu%']) OR s.subject_name ILIKE '%' || u.religion || '%')
			GROUP BY t.id
			UNION ALL
			SELECT
				q.id AS item_id,
				COUNT(qs.score) AS total_graded,
				SUM(CASE WHEN qs.score >= COALESCE(s.kkm, g.default_kkm) THEN 1 ELSE 0 END) AS passed_count
			FROM quizzes q
			JOIN classes c ON q.class_id = c.id
			JOIN subjects s ON q.subject_id = s.id
			JOIN quiz_scores qs ON qs.quiz_id = q.id
			JOIN users u ON qs.student_id = u.id
			CROSS JOIN GlobalSetting g
			WHERE c.academic_year_id = $1
			AND (s.subject_name NOT ILIKE ALL(ARRAY['%Islam%', '%Kristen%', '%Katolik%', '%Hindu%', '%Budha%', '%Konghucu%']) OR s.subject_name ILIKE '%' || u.religion || '%')
			GROUP BY q.id
		)
		SELECT COALESCE(ROUND(AVG(CASE WHEN total_graded > 0 THEN (passed_count::NUMERIC / total_graded) * 100 END), 0), 0)::float8 as passing_rate
		FROM PerItemStats
	`, academicYearID).Scan(&passingRateRaw)
	passingRate := 0
	if passingRateRaw != nil {
		passingRate = int(*passingRateRaw)
	}

	// 3. Teacher activity index
	var sumAssets, avgAssets, maxAssets float64
	config.Pool.QueryRow(context.Background(), `
		WITH TeacherAssets AS (
			SELECT
				u.id as teacher_id,
				(
					(SELECT COUNT(td.id) FROM teaching_documents td WHERE td.teacher_id = u.id AND td.academic_year_id = $1) +
					(SELECT COUNT(tj.id) FROM teaching_journals tj JOIN classes c ON tj.class_id = c.id WHERE tj.teacher_id = u.id AND c.academic_year_id = $1) +
					(SELECT COUNT(m.id) FROM materials m JOIN classes c ON m.class_id = c.id WHERE m.teacher_id = u.id AND c.academic_year_id = $1) +
					(SELECT COUNT(t.id) FROM tasks t JOIN classes c ON t.class_id = c.id WHERE t.teacher_id = u.id AND c.academic_year_id = $1) +
					(SELECT COUNT(q.id) FROM quizzes q JOIN classes c ON q.class_id = c.id WHERE q.teacher_id = u.id AND c.academic_year_id = $1)
				) as total_assets
			FROM users u
			WHERE u.role = 'teacher' AND u.is_active = true
		)
		SELECT
			COALESCE(SUM(total_assets), 0)::float8,
			COALESCE(AVG(total_assets), 0)::float8,
			COALESCE(MAX(total_assets), 0)::float8
		FROM TeacherAssets
	`, academicYearID).Scan(&sumAssets, &avgAssets, &maxAssets)

	teacherActiveIndex := 0
	totalAssets := int(sumAssets)
	if maxAssets > 0 {
		teacherActiveIndex = int(math.Round(avgAssets / maxAssets * 100))
	}

	// 4. Top teachers
	topTeacherRows, _ := config.Pool.Query(context.Background(), `
		SELECT
			u.full_name as name,
			COALESCE(
				(SELECT s.subject_name
				 FROM class_subjects cs
				 JOIN subjects s ON cs.subject_id = s.id
				 WHERE cs.teacher_id = u.id AND cs.academic_year_id = $1
				 LIMIT 1), 'Umum'
			) as mapel,
			(SELECT COUNT(*) FROM materials m JOIN classes c ON m.class_id = c.id WHERE m.teacher_id = u.id AND c.academic_year_id = $1) +
			(SELECT COUNT(*) FROM tasks t JOIN classes c ON t.class_id = c.id WHERE t.teacher_id = u.id AND c.academic_year_id = $1) +
			(SELECT COUNT(*) FROM quizzes q JOIN classes c ON q.class_id = c.id WHERE q.teacher_id = u.id AND c.academic_year_id = $1) +
			(SELECT COUNT(*) FROM teaching_documents td WHERE td.teacher_id = u.id AND td.academic_year_id = $1) +
			(SELECT COUNT(*) FROM teaching_journals tj JOIN classes c ON tj.class_id = c.id WHERE tj.teacher_id = u.id AND c.academic_year_id = $1) as score
		FROM users u
		WHERE u.role = 'teacher'
		ORDER BY score DESC
		LIMIT 3
	`, academicYearID)
	topTeachers, _ := rowsToMaps(topTeacherRows)
	if topTeachers == nil {
		topTeachers = []map[string]interface{}{}
	}

	// 5. Top students
	topStudentRows, _ := config.Pool.Query(context.Background(), `
		SELECT
			u.full_name as name,
			COALESCE((SELECT CONCAT(c.grade, ' ', c.name) FROM class_members cm JOIN classes c ON cm.class_id = c.id WHERE cm.student_id = u.id AND c.academic_year_id = $1 LIMIT 1), 'Umum') as kelas,
			ROUND(AVG(gabungan_nilai.score), 0)::int as point
		FROM users u
		JOIN (
			SELECT ts.student_id, ts.score, s.subject_name FROM task_scores ts JOIN tasks t ON ts.task_id = t.id JOIN classes c ON t.class_id = c.id JOIN subjects s ON t.subject_id = s.id WHERE c.academic_year_id = $1 AND ts.score IS NOT NULL
			UNION ALL
			SELECT qs.student_id, qs.score, s.subject_name FROM quiz_scores qs JOIN quizzes q ON qs.quiz_id = q.id JOIN classes c ON q.class_id = c.id JOIN subjects s ON q.subject_id = s.id WHERE c.academic_year_id = $1 AND qs.score IS NOT NULL
		) gabungan_nilai ON u.id = gabungan_nilai.student_id
		WHERE u.role = 'student'
		AND (gabungan_nilai.subject_name NOT ILIKE ALL(ARRAY['%Islam%', '%Kristen%', '%Katolik%', '%Hindu%', '%Budha%', '%Konghucu%']) OR gabungan_nilai.subject_name ILIKE '%' || u.religion || '%')
		GROUP BY u.id, u.full_name
		ORDER BY point DESC
		LIMIT 3
	`, academicYearID)
	topStudents, _ := rowsToMaps(topStudentRows)
	if topStudents == nil {
		topStudents = []map[string]interface{}{}
	}

	// 6. Grade JP progress
	progressRows, _ := config.Pool.Query(context.Background(), `
		WITH CurriculumData AS (
			SELECT
				c.grade,
				s.target_jp,
				COALESCE(SUM(
					CASE
						WHEN tj.slots_taught IS NULL OR TRIM(tj.slots_taught) = '' THEN 0
						ELSE ARRAY_LENGTH(STRING_TO_ARRAY(tj.slots_taught, ','), 1)
					END
				), 0) as total_slots
			FROM classes c
			CROSS JOIN subjects s
			LEFT JOIN (
				SELECT DISTINCT sch.class_id, cs.subject_id
				FROM schedules sch
				JOIN class_subjects cs ON sch.class_subject_id = cs.id
				WHERE cs.academic_year_id = $1
			) cs_map ON cs_map.class_id = c.id AND cs_map.subject_id = s.id
			LEFT JOIN teaching_journals tj ON tj.class_id = c.id AND tj.subject_id = s.id AND c.academic_year_id = $1
			WHERE c.academic_year_id = $1
			GROUP BY c.id, c.grade, s.id, s.target_jp
			HAVING COUNT(cs_map.subject_id) > 0
				OR COALESCE(SUM(CASE WHEN tj.slots_taught IS NULL OR TRIM(tj.slots_taught) = '' THEN 0 ELSE ARRAY_LENGTH(STRING_TO_ARRAY(tj.slots_taught, ','), 1) END), 0) > 0
		)
		SELECT grade, COALESCE(SUM(target_jp), 0)::int as total_target_jp, COALESCE(SUM(total_slots), 0)::int as total_slots
		FROM CurriculumData
		GROUP BY grade
		ORDER BY grade ASC
	`, academicYearID)
	progressData, _ := rowsToMaps(progressRows)

	type gradeProgress struct {
		Progress int `json:"progress"`
		Actual   int `json:"actual"`
		Target   int `json:"target"`
	}
	gradeProgressMap := map[string]*gradeProgress{}
	for _, r := range progressData {
		grade := fmt.Sprintf("%v", r["grade"])
		target := toIntIface(r["total_target_jp"])
		actual := toIntIface(r["total_slots"])
		if _, ok := gradeProgressMap[grade]; !ok {
			gradeProgressMap[grade] = &gradeProgress{}
		}
		gradeProgressMap[grade].Target += target
		gradeProgressMap[grade].Actual += actual
	}
	for _, item := range gradeProgressMap {
		if item.Target > 0 {
			p := int(math.Round(float64(item.Actual) / float64(item.Target) * 100))
			if p > 100 {
				p = 100
			}
			item.Progress = p
		}
	}

	// 7. Audit
	var activeSubjects int
	config.Pool.QueryRow(context.Background(),
		"SELECT COUNT(*)::int FROM class_subjects WHERE academic_year_id = $1", academicYearID).Scan(&activeSubjects)

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"kpi": map[string]interface{}{
			"avgGrade":       avgGradeVal,
			"completionRate": completionRate,
			"passingRate":    passingRate,
			"belowKkm":       belowKkm,
			"teacherIndex":   teacherActiveIndex,
		},
		"topTeachers": topTeachers,
		"topStudents": topStudents,
		"progress":    gradeProgressMap,
		"audit": map[string]interface{}{
			"activeSubjects":   activeSubjects,
			"totalAssets":      totalAssets,
			"totalSubmissions": totalSubmitted,
		},
	})
}

// GetTeacherPerformance - GET /api/supervisor/teacher-performance
func GetTeacherPerformance(w http.ResponseWriter, r *http.Request) {
	academicYearID := r.URL.Query().Get("academic_year_id")

	if academicYearID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "academic_year_id diperlukan."})
		return
	}

	rows, err := config.Pool.Query(context.Background(), `
		SELECT
			u.id,
			u.full_name as name,
			COALESCE(
				(SELECT STRING_AGG(DISTINCT s.subject_name, ', ')
				 FROM class_subjects cs
				 JOIN subjects s ON cs.subject_id = s.id
				 WHERE cs.teacher_id = u.id AND cs.academic_year_id = $1), 'Umum'
			) as mapel,
			(SELECT COUNT(*) FROM materials m JOIN classes c ON m.class_id = c.id WHERE m.teacher_id = u.id AND c.academic_year_id = $1)::int as materi_count,
			((SELECT COUNT(*) FROM tasks t JOIN classes c ON t.class_id = c.id WHERE t.teacher_id = u.id AND c.academic_year_id = $1) +
			 (SELECT COUNT(*) FROM quizzes q JOIN classes c ON q.class_id = c.id WHERE q.teacher_id = u.id AND c.academic_year_id = $1))::int as tugas_count,
			(
				(SELECT COUNT(*) FROM materials m JOIN classes c ON m.class_id = c.id WHERE m.teacher_id = u.id AND c.academic_year_id = $1) +
				(SELECT COUNT(*) FROM tasks t JOIN classes c ON t.class_id = c.id WHERE t.teacher_id = u.id AND c.academic_year_id = $1) +
				(SELECT COUNT(*) FROM quizzes q JOIN classes c ON q.class_id = c.id WHERE q.teacher_id = u.id AND c.academic_year_id = $1) +
				(SELECT COUNT(*) FROM teaching_documents td WHERE td.teacher_id = u.id AND td.academic_year_id = $1) +
				(SELECT COUNT(*) FROM teaching_journals tj JOIN classes c ON tj.class_id = c.id WHERE tj.teacher_id = u.id AND c.academic_year_id = $1)
			)::int as total_assets,
			COALESCE((
				SELECT ROUND(AVG(gabungan_nilai.score)::numeric, 1)::float8
				FROM (
					SELECT ts.score FROM task_scores ts
					JOIN tasks t ON ts.task_id = t.id JOIN classes c ON t.class_id = c.id
					JOIN subjects s ON t.subject_id = s.id JOIN users us ON ts.student_id = us.id
					WHERE c.academic_year_id = $1 AND t.teacher_id = u.id AND ts.score IS NOT NULL
					AND (s.subject_name NOT ILIKE ALL(ARRAY['%Islam%', '%Kristen%', '%Katolik%', '%Hindu%', '%Budha%', '%Konghucu%']) OR s.subject_name ILIKE '%' || us.religion || '%')
					UNION ALL
					SELECT qs.score FROM quiz_scores qs
					JOIN quizzes q ON qs.quiz_id = q.id JOIN classes c ON q.class_id = c.id
					JOIN subjects s ON q.subject_id = s.id JOIN users us ON qs.student_id = us.id
					WHERE c.academic_year_id = $1 AND q.teacher_id = u.id AND qs.score IS NOT NULL
					AND (s.subject_name NOT ILIKE ALL(ARRAY['%Islam%', '%Kristen%', '%Katolik%', '%Hindu%', '%Budha%', '%Konghucu%']) OR s.subject_name ILIKE '%' || us.religion || '%')
				) gabungan_nilai
			), 0) as avg_grade
		FROM users u
		WHERE u.role = 'teacher' AND u.is_active = true
		ORDER BY total_assets DESC
	`, academicYearID)
	if err != nil {
		serverError(w, r, err, "Gagal memuat data performa guru.")
		return
	}
	data, _ := rowsToMaps(rows)
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{"data": data})
}

// GetTeacherDetailAssets - GET /api/supervisor/teacher-detail-assets
func GetTeacherDetailAssets(w http.ResponseWriter, r *http.Request) {
	academicYearID := r.URL.Query().Get("academic_year_id")
	teacherID := r.URL.Query().Get("teacher_id")

	if academicYearID == "" || teacherID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "academic_year_id dan teacher_id diperlukan."})
		return
	}

	// 1. Materials
	materialRows, _ := config.Pool.Query(context.Background(), `
		SELECT m.id, m.title, m.description, m.file_url, m.link_url, m.created_at,
			CONCAT(c.grade,'-',c.name) as class_name,
			COALESCE(s.subject_name, 'Umum') as subject_name
		FROM materials m
		JOIN classes c ON m.class_id = c.id
		LEFT JOIN subjects s ON m.subject_id = s.id
		WHERE m.teacher_id = $1 AND c.academic_year_id = $2
		ORDER BY m.created_at DESC
	`, teacherID, academicYearID)
	materials, _ := rowsToMaps(materialRows)
	if materials == nil {
		materials = []map[string]interface{}{}
	}

	// 2. Tasks
	taskRows, _ := config.Pool.Query(context.Background(), `
		SELECT t.id, t.title, t.file_url, t.link_url, t.due_date as target_date,
			CONCAT(c.grade,'-',c.name) as class_name,
			COALESCE(s.subject_name, 'Umum') as subject_name,
			'Tugas' as type
		FROM tasks t
		JOIN classes c ON t.class_id = c.id
		LEFT JOIN subjects s ON t.subject_id = s.id
		WHERE t.teacher_id = $1 AND c.academic_year_id = $2
	`, teacherID, academicYearID)
	tasks, _ := rowsToMaps(taskRows)

	// 3. Quizzes
	quizRows, _ := config.Pool.Query(context.Background(), `
		SELECT q.id, q.title, NULL::text as file_url, q.embed_url as link_url, NULL::date as target_date,
			CONCAT(c.grade,'-',c.name) as class_name,
			COALESCE(s.subject_name, 'Umum') as subject_name,
			'Kuis' as type
		FROM quizzes q
		JOIN classes c ON q.class_id = c.id
		LEFT JOIN subjects s ON q.subject_id = s.id
		WHERE q.teacher_id = $1 AND c.academic_year_id = $2
	`, teacherID, academicYearID)
	quizzes, _ := rowsToMaps(quizRows)

	// Merge tasks and quizzes into assessments, sorted by target_date desc (matches JS)
	assessments := []map[string]interface{}{}
	if tasks != nil {
		assessments = append(assessments, tasks...)
	}
	if quizzes != nil {
		assessments = append(assessments, quizzes...)
	}
	sort.Slice(assessments, func(a, b int) bool {
		getDateStr := func(m map[string]interface{}) string {
			v := m["target_date"]
			if v == nil {
				return ""
			}
			s := fmt.Sprintf("%v", v)
			if s == "<nil>" {
				return ""
			}
			return s
		}
		return getDateStr(assessments[a]) > getDateStr(assessments[b])
	})

	// 4. Documents
	docRows, _ := config.Pool.Query(context.Background(), `
		SELECT td.id, td.title, td.description, td.file_url, td.link_url, td.grade,
			COALESCE(s.subject_name, 'Umum') as subject_name
		FROM teaching_documents td
		LEFT JOIN subjects s ON td.subject_id = s.id
		WHERE td.teacher_id = $1 AND td.academic_year_id = $2
		ORDER BY td.created_at DESC
	`, teacherID, academicYearID)
	docs, _ := rowsToMaps(docRows)
	if docs == nil {
		docs = []map[string]interface{}{}
	}

	// 5. Journals
	journalRows, _ := config.Pool.Query(context.Background(), `
		SELECT tj.id, tj.journal_date, tj.real_time_range, tj.slots_taught, tj.notes,
			tj.is_substitute, tj.substitute_name,
			CONCAT(c.grade,'-',c.name) as class_name,
			COALESCE(s.subject_name, 'Umum') as subject_name
		FROM teaching_journals tj
		JOIN classes c ON tj.class_id = c.id
		LEFT JOIN subjects s ON tj.subject_id = s.id
		WHERE tj.teacher_id = $1 AND c.academic_year_id = $2
		ORDER BY tj.journal_date DESC
	`, teacherID, academicYearID)
	journals, _ := rowsToMaps(journalRows)
	if journals == nil {
		journals = []map[string]interface{}{}
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"materials":   materials,
		"assessments": assessments,
		"documents":   docs,
		"journals":    journals,
	})
}

// GetStudentStats - GET /api/supervisor/student-stats
func GetStudentStats(w http.ResponseWriter, r *http.Request) {
	academicYearID := r.URL.Query().Get("academic_year_id")

	if academicYearID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "academic_year_id diperlukan untuk memuat statistik."})
		return
	}

	// 1. Student counts
	var total, aktif int64
	config.Pool.QueryRow(context.Background(), `
		SELECT
			COUNT(DISTINCT cm.student_id)::bigint as total,
			SUM(CASE WHEN u.is_active = true THEN 1 ELSE 0 END)::bigint as aktif
		FROM class_members cm
		JOIN classes c ON cm.class_id = c.id
		JOIN users u ON cm.student_id = u.id
		WHERE c.academic_year_id = $1
	`, academicYearID).Scan(&total, &aktif)

	// 2. At-risk and passing rate
	var beriisikoCount int64
	var passingRate float64
	config.Pool.QueryRow(context.Background(), `
		WITH GlobalSetting AS (
			SELECT COALESCE(default_kkm, 80) AS default_kkm FROM academic_year_kkm WHERE academic_year_id = $1 LIMIT 1
		),
		GabunganNilai AS (
			SELECT ts.student_id, ts.score, COALESCE(s.kkm, g.default_kkm) AS kkm_acuan, t.id as item_id, 'task' as item_type
			FROM task_scores ts
			JOIN tasks t ON ts.task_id = t.id JOIN classes c ON t.class_id = c.id JOIN subjects s ON t.subject_id = s.id
			JOIN users u ON ts.student_id = u.id CROSS JOIN GlobalSetting g
			WHERE c.academic_year_id = $1 AND ts.score IS NOT NULL
			AND (s.subject_name NOT ILIKE ALL(ARRAY['%Islam%', '%Kristen%', '%Katolik%', '%Hindu%', '%Budha%', '%Konghucu%']) OR s.subject_name ILIKE '%' || u.religion || '%')
			UNION ALL
			SELECT qs.student_id, qs.score, COALESCE(s.kkm, g.default_kkm) AS kkm_acuan, q.id as item_id, 'quiz' as item_type
			FROM quiz_scores qs
			JOIN quizzes q ON qs.quiz_id = q.id JOIN classes c ON q.class_id = c.id JOIN subjects s ON q.subject_id = s.id
			JOIN users u ON qs.student_id = u.id CROSS JOIN GlobalSetting g
			WHERE c.academic_year_id = $1 AND qs.score IS NOT NULL
			AND (s.subject_name NOT ILIKE ALL(ARRAY['%Islam%', '%Kristen%', '%Katolik%', '%Hindu%', '%Budha%', '%Konghucu%']) OR s.subject_name ILIKE '%' || u.religion || '%')
		),
		SiswaMetrics AS (
			SELECT student_id, SUM(CASE WHEN score < kkm_acuan THEN 1 ELSE 0 END) as total_remedial
			FROM GabunganNilai GROUP BY student_id
		),
		PerItemStats AS (
			SELECT item_id, item_type,
				COUNT(score) AS total_graded,
				SUM(CASE WHEN score >= kkm_acuan THEN 1 ELSE 0 END) AS passed_count
			FROM GabunganNilai GROUP BY item_id, item_type
		)
		SELECT
			(SELECT COUNT(student_id) FROM SiswaMetrics WHERE total_remedial >= 2)::bigint as berisiko_count,
			(SELECT COALESCE(ROUND(AVG(CASE WHEN total_graded > 0 THEN (passed_count::NUMERIC / total_graded) * 100 END), 0), 0)::float8 FROM PerItemStats) as passing_rate
	`, academicYearID).Scan(&beriisikoCount, &passingRate)

	passingRateStr := fmt.Sprintf("%d%%", int(passingRate))

	// 3. Grade health
	gradeHealthRows, _ := config.Pool.Query(context.Background(), `
		SELECT c.grade, COALESCE(ROUND(AVG(gabungan.score), 0), 0)::int as avg_score
		FROM classes c
		JOIN (
			SELECT t.class_id, ts.score FROM task_scores ts
			JOIN tasks t ON ts.task_id = t.id JOIN subjects s ON t.subject_id = s.id JOIN users u ON ts.student_id = u.id
			WHERE ts.score IS NOT NULL
			AND (s.subject_name NOT ILIKE ALL(ARRAY['%Islam%', '%Kristen%', '%Katolik%', '%Hindu%', '%Budha%', '%Konghucu%']) OR s.subject_name ILIKE '%' || u.religion || '%')
			UNION ALL
			SELECT q.class_id, qs.score FROM quiz_scores qs
			JOIN quizzes q ON qs.quiz_id = q.id JOIN subjects s ON q.subject_id = s.id JOIN users u ON qs.student_id = u.id
			WHERE qs.score IS NOT NULL
			AND (s.subject_name NOT ILIKE ALL(ARRAY['%Islam%', '%Kristen%', '%Katolik%', '%Hindu%', '%Budha%', '%Konghucu%']) OR s.subject_name ILIKE '%' || u.religion || '%')
		) gabungan ON c.id = gabungan.class_id
		WHERE c.academic_year_id = $1
		GROUP BY c.grade
		ORDER BY c.grade ASC
	`, academicYearID)
	gradeHealthData, _ := rowsToMaps(gradeHealthRows)

	gradeHealth := map[string]interface{}{"VII": 0, "VIII": 0, "IX": 0}
	for _, r := range gradeHealthData {
		grade := fmt.Sprintf("%v", r["grade"])
		if _, ok := gradeHealth[grade]; ok {
			gradeHealth[grade] = toIntIface(r["avg_score"])
		}
	}

	// 4. Top students leaderboard
	topStudentRows, _ := config.Pool.Query(context.Background(), `
		WITH GlobalSetting AS (
			SELECT COALESCE(default_kkm, 80) AS default_kkm FROM academic_year_kkm WHERE academic_year_id = $1 LIMIT 1
		)
		SELECT
			ROW_NUMBER() OVER (ORDER BY AVG(gabungan_nilai.score) DESC)::int as rank,
			u.full_name as name,
			COALESCE((SELECT c.name FROM class_members cm JOIN classes c ON cm.class_id = c.id WHERE cm.student_id = u.id AND c.academic_year_id = $1 LIMIT 1), 'Umum') as kelas,
			(COUNT(gabungan_nilai.score) * 15)::int as xp,
			ROUND(AVG(gabungan_nilai.score), 0)::int as avg,
			CASE
				WHEN AVG(gabungan_nilai.score) >= ((100.0 - MAX(g.default_kkm)) / 2.0) + MAX(g.default_kkm) THEN 'Excellent'
				WHEN AVG(gabungan_nilai.score) >= MAX(g.default_kkm) THEN 'Good'
				ELSE 'Need Attention'
			END as status
		FROM users u
		CROSS JOIN GlobalSetting g
		JOIN (
			SELECT ts.student_id, ts.score, s.subject_name FROM task_scores ts JOIN tasks t ON ts.task_id = t.id JOIN classes c ON t.class_id = c.id JOIN subjects s ON t.subject_id = s.id WHERE c.academic_year_id = $1 AND ts.score IS NOT NULL
			UNION ALL
			SELECT qs.student_id, qs.score, s.subject_name FROM quiz_scores qs JOIN quizzes q ON qs.quiz_id = q.id JOIN classes c ON q.class_id = c.id JOIN subjects s ON q.subject_id = s.id WHERE c.academic_year_id = $1 AND qs.score IS NOT NULL
		) gabungan_nilai ON u.id = gabungan_nilai.student_id
		WHERE u.role = 'student'
		AND (gabungan_nilai.subject_name NOT ILIKE ALL(ARRAY['%Islam%', '%Kristen%', '%Katolik%', '%Hindu%', '%Budha%', '%Konghucu%']) OR gabungan_nilai.subject_name ILIKE '%' || u.religion || '%')
		GROUP BY u.id, u.full_name
		ORDER BY avg DESC
		LIMIT 5
	`, academicYearID)
	topStudents, _ := rowsToMaps(topStudentRows)
	if topStudents == nil {
		topStudents = []map[string]interface{}{}
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"studentStats": map[string]interface{}{
			"total":    total,
			"aktif":    aktif,
			"berisiko": beriisikoCount,
			"tuntas":   passingRateStr,
		},
		"gradeHealth": gradeHealth,
		"topStudents": topStudents,
	})
}

// GetStudentList - GET /api/supervisor/student-list
func GetStudentList(w http.ResponseWriter, r *http.Request) {
	academicYearID := r.URL.Query().Get("academic_year_id")

	if academicYearID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "academic_year_id diperlukan."})
		return
	}

	rows, err := config.Pool.Query(context.Background(), `
		SELECT
			u.id,
			u.full_name as name,
			u.username as nis,
			CONCAT(c.grade, '-', c.name) as class_name,
			c.id as class_id,
			COALESCE((
				SELECT ROUND(AVG(gabungan_nilai.score)::numeric, 1)::float8
				FROM (
					SELECT ts.score FROM task_scores ts
					JOIN tasks t ON ts.task_id = t.id JOIN subjects s ON t.subject_id = s.id
					WHERE t.class_id = c.id AND ts.student_id = u.id AND ts.score IS NOT NULL
					AND (CASE WHEN LOWER(s.subject_name) LIKE '%islam%' THEN LOWER(u.religion) = 'islam'
					          WHEN LOWER(s.subject_name) LIKE '%katolik%' THEN LOWER(u.religion) = 'katolik'
					          WHEN LOWER(s.subject_name) LIKE '%kristen%' THEN LOWER(u.religion) = 'kristen'
					          WHEN LOWER(s.subject_name) LIKE '%hindu%' THEN LOWER(u.religion) = 'hindu'
					          WHEN LOWER(s.subject_name) LIKE '%budha%' THEN LOWER(u.religion) = 'budha'
					          WHEN LOWER(s.subject_name) LIKE '%konghucu%' THEN LOWER(u.religion) = 'konghucu'
					          ELSE TRUE END)
					UNION ALL
					SELECT qs.score FROM quiz_scores qs
					JOIN quizzes q ON qs.quiz_id = q.id JOIN subjects s ON q.subject_id = s.id
					WHERE q.class_id = c.id AND qs.student_id = u.id AND qs.score IS NOT NULL
					AND (CASE WHEN LOWER(s.subject_name) LIKE '%islam%' THEN LOWER(u.religion) = 'islam'
					          WHEN LOWER(s.subject_name) LIKE '%katolik%' THEN LOWER(u.religion) = 'katolik'
					          WHEN LOWER(s.subject_name) LIKE '%kristen%' THEN LOWER(u.religion) = 'kristen'
					          WHEN LOWER(s.subject_name) LIKE '%hindu%' THEN LOWER(u.religion) = 'hindu'
					          WHEN LOWER(s.subject_name) LIKE '%budha%' THEN LOWER(u.religion) = 'budha'
					          WHEN LOWER(s.subject_name) LIKE '%konghucu%' THEN LOWER(u.religion) = 'konghucu'
					          ELSE TRUE END)
				) gabungan_nilai
			), 0) as avg_score,
			(
				SELECT SUM(CASE WHEN score < kkm_acuan THEN 1 ELSE 0 END)::int
				FROM (
					SELECT ts.score, COALESCE(s.kkm, (SELECT default_kkm FROM academic_year_kkm WHERE academic_year_id = $1 LIMIT 1)) AS kkm_acuan
					FROM task_scores ts JOIN tasks t ON ts.task_id = t.id JOIN subjects s ON t.subject_id = s.id
					WHERE t.class_id = c.id AND ts.student_id = u.id AND ts.score IS NOT NULL
					AND (CASE WHEN LOWER(s.subject_name) LIKE '%islam%' THEN LOWER(u.religion) = 'islam'
					          WHEN LOWER(s.subject_name) LIKE '%katolik%' THEN LOWER(u.religion) = 'katolik'
					          WHEN LOWER(s.subject_name) LIKE '%kristen%' THEN LOWER(u.religion) = 'kristen'
					          WHEN LOWER(s.subject_name) LIKE '%hindu%' THEN LOWER(u.religion) = 'hindu'
					          WHEN LOWER(s.subject_name) LIKE '%budha%' THEN LOWER(u.religion) = 'budha'
					          WHEN LOWER(s.subject_name) LIKE '%konghucu%' THEN LOWER(u.religion) = 'konghucu'
					          ELSE TRUE END)
					UNION ALL
					SELECT qs.score, COALESCE(s.kkm, (SELECT default_kkm FROM academic_year_kkm WHERE academic_year_id = $1 LIMIT 1)) AS kkm_acuan
					FROM quiz_scores qs JOIN quizzes q ON qs.quiz_id = q.id JOIN subjects s ON q.subject_id = s.id
					WHERE q.class_id = c.id AND qs.student_id = u.id AND qs.score IS NOT NULL
					AND (CASE WHEN LOWER(s.subject_name) LIKE '%islam%' THEN LOWER(u.religion) = 'islam'
					          WHEN LOWER(s.subject_name) LIKE '%katolik%' THEN LOWER(u.religion) = 'katolik'
					          WHEN LOWER(s.subject_name) LIKE '%kristen%' THEN LOWER(u.religion) = 'kristen'
					          WHEN LOWER(s.subject_name) LIKE '%hindu%' THEN LOWER(u.religion) = 'hindu'
					          WHEN LOWER(s.subject_name) LIKE '%budha%' THEN LOWER(u.religion) = 'budha'
					          WHEN LOWER(s.subject_name) LIKE '%konghucu%' THEN LOWER(u.religion) = 'konghucu'
					          ELSE TRUE END)
				) all_scores
			) as remedial_count
		FROM users u
		JOIN class_members cm ON u.id = cm.student_id
		JOIN classes c ON cm.class_id = c.id
		WHERE u.role = 'student' AND c.academic_year_id = $1
		ORDER BY c.grade, c.name, u.full_name
	`, academicYearID)
	if err != nil {
		serverError(w, r, err, "Gagal mengambil daftar siswa.")
		return
	}
	data, err := rowsToMaps(rows)
	if err != nil {
		serverError(w, r, err, "Gagal mengambil daftar siswa.")
		return
	}
	if data == nil {
		data = []map[string]interface{}{}
	}
	jsonResponse(w, http.StatusOK, data)
}

// GetStudentDetailPerformance - GET /api/supervisor/student-detail-performance
func GetStudentDetailPerformance(w http.ResponseWriter, r *http.Request) {
	studentID := r.URL.Query().Get("student_id")
	academicYearID := r.URL.Query().Get("academic_year_id")

	if studentID == "" || academicYearID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "Parameter academic_year_id dan student_id diperlukan."})
		return
	}

	// Get student name for attendance text parsing
	var studentName string
	err := config.Pool.QueryRow(context.Background(),
		"SELECT full_name FROM users WHERE id = $1", studentID).Scan(&studentName)
	if err != nil {
		jsonResponse(w, http.StatusNotFound, map[string]string{"error": "Siswa tidak ditemukan."})
		return
	}

	// Get global KKM
	var globalKkm float64
	config.Pool.QueryRow(context.Background(),
		`SELECT COALESCE((SELECT default_kkm FROM academic_year_kkm WHERE academic_year_id = $1 LIMIT 1), 75)::float8`,
		academicYearID).Scan(&globalKkm)
	if globalKkm == 0 {
		globalKkm = 75
	}

	// Task assessments
	taskRows, _ := config.Pool.Query(context.Background(), `
		SELECT t.title, COALESCE(s.subject_name, 'Umum') as subject_name, ts.score, t.due_date as date, 'Tugas' as type,
			COALESCE(s.kkm::float8, $3) as kkm
		FROM tasks t
		JOIN subjects s ON t.subject_id = s.id
		JOIN class_members cm ON t.class_id = cm.class_id
		JOIN users u ON cm.student_id = u.id
		LEFT JOIN task_scores ts ON ts.task_id = t.id AND ts.student_id = $1
		WHERE cm.student_id = $1 AND t.class_id IN (SELECT id FROM classes WHERE academic_year_id = $2)
		AND (CASE WHEN LOWER(s.subject_name) LIKE '%islam%' THEN LOWER(u.religion) = 'islam'
		          WHEN LOWER(s.subject_name) LIKE '%katolik%' THEN LOWER(u.religion) = 'katolik'
		          WHEN LOWER(s.subject_name) LIKE '%kristen%' THEN LOWER(u.religion) = 'kristen'
		          WHEN LOWER(s.subject_name) LIKE '%hindu%' THEN LOWER(u.religion) = 'hindu'
		          WHEN LOWER(s.subject_name) LIKE '%budha%' THEN LOWER(u.religion) = 'budha'
		          WHEN LOWER(s.subject_name) LIKE '%konghucu%' THEN LOWER(u.religion) = 'konghucu'
		          ELSE TRUE END)
	`, studentID, academicYearID, globalKkm)
	taskScores, _ := rowsToMaps(taskRows)

	// Quiz assessments
	quizRows, _ := config.Pool.Query(context.Background(), `
		SELECT q.title, COALESCE(s.subject_name, 'Umum') as subject_name, qs.score, q.exam_date as date, 'Kuis' as type,
			COALESCE(s.kkm::float8, $3) as kkm
		FROM quizzes q
		JOIN subjects s ON q.subject_id = s.id
		JOIN class_members cm ON q.class_id = cm.class_id
		JOIN users u ON cm.student_id = u.id
		LEFT JOIN quiz_scores qs ON qs.quiz_id = q.id AND qs.student_id = $1
		WHERE cm.student_id = $1 AND q.class_id IN (SELECT id FROM classes WHERE academic_year_id = $2)
		AND (CASE WHEN LOWER(s.subject_name) LIKE '%islam%' THEN LOWER(u.religion) = 'islam'
		          WHEN LOWER(s.subject_name) LIKE '%katolik%' THEN LOWER(u.religion) = 'katolik'
		          WHEN LOWER(s.subject_name) LIKE '%kristen%' THEN LOWER(u.religion) = 'kristen'
		          WHEN LOWER(s.subject_name) LIKE '%hindu%' THEN LOWER(u.religion) = 'hindu'
		          WHEN LOWER(s.subject_name) LIKE '%budha%' THEN LOWER(u.religion) = 'budha'
		          WHEN LOWER(s.subject_name) LIKE '%konghucu%' THEN LOWER(u.religion) = 'konghucu'
		          ELSE TRUE END)
	`, studentID, academicYearID, globalKkm)
	quizScores, _ := rowsToMaps(quizRows)

	assessments := []map[string]interface{}{}
	if taskScores != nil {
		assessments = append(assessments, taskScores...)
	}
	if quizScores != nil {
		assessments = append(assessments, quizScores...)
	}
	sort.Slice(assessments, func(a, b int) bool {
		getDateStr := func(m map[string]interface{}) string {
			v := m["date"]
			if v == nil {
				return ""
			}
			s := fmt.Sprintf("%v", v)
			if s == "<nil>" {
				return ""
			}
			return s
		}
		return getDateStr(assessments[a]) > getDateStr(assessments[b])
	})

	// Attendance journals with status parsing
	journalRows, _ := config.Pool.Query(context.Background(), `
		SELECT tj.journal_date, tj.real_time_range, tj.notes, COALESCE(s.subject_name, 'Umum') as subject_name,
			tj.absent_student_ids, tj.absent_students
		FROM teaching_journals tj
		LEFT JOIN subjects s ON tj.subject_id = s.id
		JOIN class_members cm ON tj.class_id = cm.class_id
		JOIN users u ON cm.student_id = u.id
		WHERE cm.student_id = $1 AND tj.class_id IN (SELECT id FROM classes WHERE academic_year_id = $2)
		AND (CASE WHEN LOWER(s.subject_name) LIKE '%islam%' THEN LOWER(u.religion) = 'islam'
		          WHEN LOWER(s.subject_name) LIKE '%katolik%' THEN LOWER(u.religion) = 'katolik'
		          WHEN LOWER(s.subject_name) LIKE '%kristen%' THEN LOWER(u.religion) = 'kristen'
		          WHEN LOWER(s.subject_name) LIKE '%hindu%' THEN LOWER(u.religion) = 'hindu'
		          WHEN LOWER(s.subject_name) LIKE '%budha%' THEN LOWER(u.religion) = 'budha'
		          WHEN LOWER(s.subject_name) LIKE '%konghucu%' THEN LOWER(u.religion) = 'konghucu'
		          ELSE TRUE END)
		ORDER BY tj.journal_date DESC
	`, studentID, academicYearID)
	journals, _ := rowsToMaps(journalRows)

	escapedName := regexp.QuoteMeta(studentName)
	re := regexp.MustCompile(`(?i)` + escapedName + `\s*\(([^)]+)\)`)
	// Use word-boundary regex to avoid false positives (e.g. ID "1" matching "10")
	studentIDRe := regexp.MustCompile(`\b` + regexp.QuoteMeta(studentID) + `\b`)

	attendanceLog := []map[string]interface{}{}
	for _, j := range journals {
		isAbsent := false

		// Check absent_student_ids array
		absentIDs := j["absent_student_ids"]
		absentIDsStr := fmt.Sprintf("%v", absentIDs)
		if absentIDsStr != "<nil>" && absentIDsStr != "" && studentIDRe.MatchString(absentIDsStr) {
			isAbsent = true
		}

		status := "Hadir"
		var reason interface{}

		if isAbsent {
			status = "Alpha"
			absentStudents := fmt.Sprintf("%v", j["absent_students"])
			if absentStudents != "<nil>" && absentStudents != "" {
				match := re.FindStringSubmatch(absentStudents)
				if match != nil {
					extractedText := match[1]
					if idx := strings.Index(extractedText, "-"); idx != -1 {
						status = strings.TrimSpace(extractedText[:idx])
						reason = strings.TrimSpace(extractedText[idx+1:])
					} else {
						status = strings.TrimSpace(extractedText)
					}
				}
			}
		}

		attendanceLog = append(attendanceLog, map[string]interface{}{
			"date":    j["journal_date"],
			"time":    j["real_time_range"],
			"subject": j["subject_name"],
			"status":  status,
			"reason":  reason,
			"notes":   j["notes"],
		})
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"assessments": assessments,
		"attendance":  attendanceLog,
	})
}

// GetCurriculumProgress - GET /api/supervisor/curriculum-progress
func GetCurriculumProgress(w http.ResponseWriter, r *http.Request) {
	academicYearID := r.URL.Query().Get("academic_year_id")

	if academicYearID == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "academic_year_id diperlukan."})
		return
	}

	rows, err := config.Pool.Query(context.Background(), `
		SELECT
			c.grade,
			c.id as class_id,
			c.name as class_name,
			s.id as subject_id,
			COALESCE(s.subject_name, 'Umum') as mapel,
			s.target_jp,
			STRING_AGG(DISTINCT u.full_name, ', ') as guru,
			COALESCE(SUM(
				CASE
					WHEN tj.slots_taught IS NULL OR TRIM(tj.slots_taught) = '' THEN 0
					ELSE ARRAY_LENGTH(STRING_TO_ARRAY(tj.slots_taught, ','), 1)
				END
			), 0)::int as total_slots,
			COUNT(CASE WHEN tj.is_substitute = true THEN 1 END)::int as substitute_count
		FROM classes c
		CROSS JOIN subjects s
		LEFT JOIN (
			SELECT DISTINCT sch.class_id, cs.subject_id, cs.teacher_id, cs.id as cs_id
			FROM schedules sch
			JOIN class_subjects cs ON sch.class_subject_id = cs.id
			WHERE cs.academic_year_id = $1
		) cs_map ON cs_map.class_id = c.id AND cs_map.subject_id = s.id
		LEFT JOIN users u ON cs_map.teacher_id = u.id
		LEFT JOIN teaching_journals tj ON tj.class_id = c.id AND tj.subject_id = s.id AND c.academic_year_id = $1
		WHERE c.academic_year_id = $1
		GROUP BY c.id, c.grade, c.name, s.id, s.subject_name, s.target_jp
		HAVING COUNT(cs_map.cs_id) > 0 OR COALESCE(SUM(CASE WHEN tj.slots_taught IS NULL OR TRIM(tj.slots_taught) = '' THEN 0 ELSE ARRAY_LENGTH(STRING_TO_ARRAY(tj.slots_taught, ','), 1) END), 0) > 0
		ORDER BY c.grade, c.name, s.subject_name
	`, academicYearID)
	if err != nil {
		serverError(w, r, err, "Gagal memuat data capaian kurikulum.")
		return
	}
	rawData, _ := rowsToMaps(rows)

	totalJpSekolah := 0
	formattedData := []map[string]interface{}{}
	for i, row := range rawData {
		totalSlots := toIntIface(row["total_slots"])
		totalJpSekolah += totalSlots

		var targetJp interface{}
		targetJpRaw := toIntIface(row["target_jp"])
		if row["target_jp"] != nil && fmt.Sprintf("%v", row["target_jp"]) != "<nil>" && targetJpRaw != 0 {
			targetJp = targetJpRaw
		}

		progressVisual := 0
		if targetJp != nil {
			tp := targetJp.(int)
			if tp > 0 {
				p := int(math.Round(float64(totalSlots) / float64(tp) * 100))
				if p > 100 {
					p = 100
				}
				progressVisual = p
			}
		}

		status := "Baru Dimulai"
		if targetJp == nil {
			status = "⚠ Target Belum Diatur"
		} else {
			tp := targetJp.(int)
			if totalSlots >= tp {
				status = "Tuntas"
			} else if float64(totalSlots) >= float64(tp)*0.75 {
				status = "Hampir Tuntas"
			} else if float64(totalSlots) >= float64(tp)*0.35 {
				status = "Sedang Berproses"
			} else if totalSlots == 0 {
				status = "Belum Ada KBM"
			}
		}

		subjectID := fmt.Sprintf("%v", row["subject_id"])
		if subjectID == "<nil>" {
			subjectID = "umum"
		}
		guruVal := fmt.Sprintf("%v", row["guru"])
		if guruVal == "<nil>" || guruVal == "" {
			guruVal = "Belum Ditentukan"
		}

		formattedData = append(formattedData, map[string]interface{}{
			"id":               fmt.Sprintf("%v-%s-%d", row["class_id"], subjectID, i),
			"grade":            row["grade"],
			"class_id":         row["class_id"],
			"class_name":       row["class_name"],
			"mapel":            row["mapel"],
			"guru":             guruVal,
			"progress":         progressVisual,
			"total_slots":      totalSlots,
			"target_jp":        targetJp,
			"substitute_count": toIntIface(row["substitute_count"]),
			"status":           status,
		})
	}

	totalMapel := len(formattedData)
	avgProgress := 0
	if totalMapel > 0 {
		sum := 0
		for _, d := range formattedData {
			sum += d["progress"].(int)
		}
		avgProgress = int(math.Round(float64(sum) / float64(totalMapel)))
	}
	tuntasCount := 0
	totalInvalSekolah := 0
	for _, d := range formattedData {
		s := d["status"].(string)
		if s == "Tuntas" || s == "Hampir Tuntas" {
			tuntasCount++
		}
		totalInvalSekolah += d["substitute_count"].(int)
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"data": formattedData,
		"summary": map[string]interface{}{
			"avgProgress":       avgProgress,
			"totalMapel":        totalMapel,
			"tuntasCount":       tuntasCount,
			"totalInvalSekolah": totalInvalSekolah,
			"totalJpSekolah":    totalJpSekolah,
		},
	})
}
