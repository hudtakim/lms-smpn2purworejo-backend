package main

import (
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"

	"lms-backend-go/config"
	"lms-backend-go/handlers"
	"lms-backend-go/middleware"

	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"
)

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	_ = godotenv.Load()

	// Structured JSON logging to stdout — captured by k8s and parseable by
	// any log aggregator (Loki, ELK, CloudWatch, etc.)
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	config.InitDB()

	r := chi.NewRouter()
	r.Use(corsMiddleware)
	r.Use(chiMiddleware.Logger)
	r.Use(chiMiddleware.Recoverer)

	// Serve static uploads
	fs := http.StripPrefix("/uploads/", http.FileServer(http.Dir("./uploads")))
	r.Handle("/uploads/*", http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		fs.ServeHTTP(w, req)
	}))

	// ==================== AUTH ====================
	r.Post("/api/auth/login", handlers.Login)

	// ==================== GLOBAL ====================
	r.Get("/api/global/session-duration-limit", handlers.GetSessionDurationLimit)
	r.Get("/api/global/maintenance-status", handlers.GetMaintenanceStatus)
	r.Post("/api/admin/global-time-slots/copy-previous", handlers.CopyPreviousTimeSlots)

	r.Group(func(r chi.Router) {
		r.Use(middleware.VerifyToken)
		r.Get("/api/global/active-academic-year", handlers.GetActiveAcademicYear)
		r.Get("/api/global/admin-whatsapp", handlers.GetAdminWhatsapp)
		r.Get("/api/global/profile", handlers.GetProfile)
		r.Put("/api/global/update-password", handlers.UpdatePassword)
	})

	// ==================== ADMIN ====================
	r.Group(func(r chi.Router) {
		r.Use(middleware.VerifyToken)
		r.Use(middleware.IsAdmin)

		// Users
		r.Get("/api/admin/users", handlers.GetUsers)
		r.Get("/api/admin/teachers-to-plot", handlers.GetTeacherListToPlot)
		r.Post("/api/admin/users", handlers.CreateUser)
		r.Post("/api/admin/users/import", handlers.ImportUsers)
		r.Put("/api/admin/users/{id}", handlers.UpdateUser)
		r.Delete("/api/admin/users/{id}", handlers.DeleteUser)
		r.Patch("/api/admin/users/{id}/toggle-status", handlers.ToggleUserStatus)

		// Rooms
		r.Get("/api/admin/rooms", handlers.GetRooms)
		r.Post("/api/admin/rooms", handlers.CreateRoom)
		r.Post("/api/admin/rooms/import", handlers.ImportRooms)

		// Academic years (admin only routes)
		r.Post("/api/admin/academic-years", handlers.CreateAcademicYear)
		r.Patch("/api/admin/academic-years/activate/{id}", handlers.ActivateAcademicYear)

		// Subjects
		r.Get("/api/admin/subjects", handlers.GetSubjects)
		r.Post("/api/admin/subjects", handlers.CreateSubject)
		r.Post("/api/admin/subjects/import", handlers.ImportSubjects)
		r.Put("/api/admin/subjects/{id}", handlers.UpdateSubject)
		r.Patch("/api/admin/subjects/{id}/toggle", handlers.ToggleSubject)

		// Class subjects & schedules
		r.Post("/api/admin/class-subjects", handlers.CreateClassSubject)
		r.Delete("/api/admin/class-subjects/{id}", handlers.DeleteClassSubject)
		r.Post("/api/admin/schedules", handlers.CreateSchedule)
		r.Delete("/api/admin/schedules/{id}", handlers.DeleteSchedule)

		// Time slots
		r.Post("/api/admin/time-slots", handlers.CreateTimeSlot)
		r.Delete("/api/admin/time-slots/{id}", handlers.DeleteTimeSlot)

		// Day settings
		r.Put("/api/admin/day-settings", handlers.UpdateDaySettings)

		// KKM settings
		r.Get("/api/admin/settings/kkm", handlers.GetKKMSettings)
		r.Put("/api/admin/settings/kkm", handlers.UpdateKKMSettings)

		// System
		r.Get("/api/admin/system/telemetry", handlers.GetSystemTelemetry)
		r.Get("/api/admin/system/backup", handlers.GetSystemBackup)

		// Maintenance
		r.Delete("/api/admin/maintenance/academic-year", handlers.DeleteAcademicYearData)
		r.Delete("/api/admin/maintenance/users", handlers.DeleteUsersData)

		// App settings
		r.Get("/api/admin/settings/app", handlers.GetAppSettings)
		r.Put("/api/admin/settings/app", handlers.UpdateAppSettings)

		// Parents
		r.Get("/api/admin/parents-list", handlers.GetParentsList)
		r.Get("/api/admin/parents/{parentId}/students", handlers.GetParentStudents)
		r.Get("/api/admin/parents/{parentId}/available-students", handlers.GetAvailableStudentsForParent)
		r.Post("/api/admin/parents/{parentId}/students", handlers.AssignStudentsToParent)
		r.Delete("/api/admin/parents/{parentId}/students/{studentId}", handlers.RemoveStudentFromParent)
		r.Post("/api/admin/parents/import-mapping", handlers.ImportParentMapping)
		r.Post("/api/admin/parents/auto-generate", handlers.AutoGenerateParents)

		// Classes (admin-only CRUD)
		r.Post("/api/admin/classes", handlers.CreateClass)
		r.Post("/api/admin/classes/import", handlers.ImportClasses)
		r.Post("/api/admin/classes/import-members", handlers.ImportClassMembers)
		// Static paths MUST come before parameterized paths
		r.Get("/api/admin/classes/available-homeroom-teacher", handlers.GetAvailableHomeroomTeacher)
		r.Get("/api/admin/classes/available-students", handlers.GetAvailableStudentsForClass)
		r.Get("/api/admin/classes/global/schedules", handlers.GetClassSchedules)
		r.Get("/api/admin/classes/global/subjects", handlers.GetClassSubjects)
		r.Put("/api/admin/classes/{id}", handlers.UpdateClass)
		r.Delete("/api/admin/classes/{id}", handlers.DeleteClass)
		r.Get("/api/admin/classes/{classId}/detail", handlers.GetClassDetail)
		r.Get("/api/admin/classes/{classId}/members", handlers.GetClassMembers)
		r.Post("/api/admin/classes/{classId}/members", handlers.AddClassMembers)
		r.Delete("/api/admin/classes/{classId}/members/{studentId}", handlers.RemoveClassMember)
		r.Post("/api/admin/classes/{classId}/assign-students", handlers.AssignStudentsToClass)
		r.Get("/api/admin/classes/{class_id}/subjects", handlers.GetClassSubjects)
		r.Get("/api/admin/classes/{class_id}/schedules", handlers.GetClassSchedules)

		// Academic year full CRUD
		r.Patch("/api/admin/academic-years/{id}/activate", handlers.ActivateAcademicYearFull)
		r.Delete("/api/admin/academic-years/{id}", handlers.DeleteAcademicYear)
	})

	// Admin + VerifyToken (without role restriction for some)
	r.Group(func(r chi.Router) {
		r.Use(middleware.VerifyToken)
		// Classes list accessible to all authenticated
		r.Get("/api/admin/classes", handlers.GetClassesList)
		// Classes by academic year accessible to all authenticated
		r.Get("/api/admin/classes/{academic_year_id}", handlers.GetClassesByAcademicYear)
		// Academic years list
		r.Get("/api/admin/academic-years", handlers.GetAcademicYears)
		r.Get("/api/admin/academic-years/list", handlers.GetAcademicYearsList)
	})

	// Admin or Teacher or Supervisor
	r.Group(func(r chi.Router) {
		r.Use(middleware.VerifyToken)
		r.Use(middleware.IsAdminOrTeacherOrSupervisor)
		// Academic years (teachers/supervisors need this too)
	})

	// Admin or Teacher
	r.Group(func(r chi.Router) {
		r.Use(middleware.VerifyToken)
		r.Use(middleware.IsAdminOrTeacher)
		r.Get("/api/admin/time-slots", handlers.GetTimeSlots)
		r.Get("/api/admin/day-settings", handlers.GetDaySettings)
	})

	// ==================== TEACHER ====================
	r.Group(func(r chi.Router) {
		r.Use(middleware.VerifyToken)
		r.Use(middleware.IsTeacher)

		r.Get("/api/teacher/my-schedule", handlers.GetMySchedule)
		r.Get("/api/teacher/my-classes", handlers.GetMyClasses)
		r.Get("/api/teacher/active-subjects", handlers.GetActiveSubjects)
		r.Get("/api/teacher/teaching-documents", handlers.GetTeachingDocuments)
		r.Post("/api/teacher/teaching-documents", handlers.CreateTeachingDocument)
		r.Put("/api/teacher/teaching-documents/{id}", handlers.UpdateTeachingDocument)
		r.Delete("/api/teacher/teaching-documents/{id}", handlers.DeleteTeachingDocument)
		r.Get("/api/teacher/pending-gradings", handlers.GetPendingGradings)
		r.Get("/api/teacher/class-name", handlers.GetClassName)
		r.Get("/api/teacher/upload-limit", handlers.GetUploadLimit)

		r.Get("/api/teacher/kelas/{classId}/overview", handlers.GetClassOverview)

		// Materials
		r.Get("/api/teacher/kelas/{classId}/materials/{subjectId}", handlers.GetMaterials)
		r.Post("/api/teacher/kelas/{classId}/materials/{subjectId}", handlers.CreateMaterial)
		r.Put("/api/teacher/kelas/{classId}/materials/{id}", handlers.UpdateMaterial)
		r.Delete("/api/teacher/kelas/{classId}/materials/{id}", handlers.DeleteMaterial)

		// Tasks
		r.Get("/api/teacher/kelas/{classId}/tasks/{subjectId}", handlers.GetTasks)
		r.Post("/api/teacher/kelas/{classId}/tasks/{subjectId}", handlers.CreateTask)
		r.Put("/api/teacher/kelas/{classId}/tasks/{id}", handlers.UpdateTask)
		r.Delete("/api/teacher/kelas/{classId}/tasks/{id}", handlers.DeleteTask)

		// Journals
		r.Get("/api/teacher/kelas/{classId}/journals/{subjectId}", handlers.GetJournals)
		r.Post("/api/teacher/kelas/{classId}/journals/{subjectId}", handlers.CreateJournal)
		r.Put("/api/teacher/kelas/{classId}/journals/{id}", handlers.UpdateJournal)
		r.Delete("/api/teacher/kelas/{classId}/journals/{id}", handlers.DeleteJournal)

		// Quizzes
		r.Get("/api/teacher/kelas/{classId}/quizzes/{subjectId}", handlers.GetQuizzes)
		r.Post("/api/teacher/kelas/{classId}/quizzes/{subjectId}", handlers.CreateQuiz)
		r.Put("/api/teacher/kelas/{classId}/quizzes/{id}", handlers.UpdateQuiz)
		r.Delete("/api/teacher/kelas/{classId}/quizzes/{id}", handlers.DeleteQuiz)
		r.Get("/api/teacher/kelas/{classId}/quizzes/{id}/scores", handlers.GetQuizScores)
		r.Post("/api/teacher/kelas/{classId}/quizzes/{id}/scores-manual", handlers.SaveQuizScoreManual)
		r.Post("/api/teacher/kelas/{classId}/quizzes/{id}/import-scores", handlers.ImportQuizScores)

		// Task scores
		r.Get("/api/teacher/kelas/{classId}/tasks/{id}/scores", handlers.GetTaskScores)
		r.Post("/api/teacher/kelas/{classId}/tasks/{id}/scores", handlers.SaveTaskScore)

		// Gradebook
		r.Get("/api/teacher/kelas/{classId}/gradebook/{subjectId}", handlers.GetGradebook)
		r.Get("/api/teacher/kelas/{classId}/gradebook/{subjectId}/export", handlers.ExportGradebook)
	})

	// ==================== STUDENT ====================
	r.Group(func(r chi.Router) {
		r.Use(middleware.VerifyToken)
		r.Use(middleware.IsStudentOrParent)
		r.Get("/api/student/academic-years", handlers.GetStudentAcademicYears)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.VerifyToken)
		r.Use(middleware.IsStudent)

		r.Get("/api/student/dashboard-meta", handlers.GetStudentDashboardMeta)
		r.Get("/api/student/my-schedule", handlers.GetStudentSchedule)
		r.Get("/api/student/my-subjects", handlers.GetStudentSubjects)
		r.Get("/api/student/my-materials/{subjectId}", handlers.GetStudentMaterials)
		r.Get("/api/student/my-task-subjects", handlers.GetStudentTaskSubjects)
		r.Get("/api/student/my-tasks/{subjectId}", handlers.GetStudentTasks)
		r.Get("/api/student/my-quiz-subjects", handlers.GetStudentQuizSubjects)
		r.Get("/api/student/my-quizzes/{subjectId}", handlers.GetStudentQuizzes)
		r.Post("/api/student/submit-task/{taskId}", handlers.SubmitTask)
		r.Get("/api/student/my-grades", handlers.GetStudentGrades)
	})

	// ==================== SUPERVISOR ====================
	r.Group(func(r chi.Router) {
		r.Use(middleware.VerifyToken)
		r.Use(middleware.IsSupervisor)

		r.Get("/api/supervisor/dashboard", handlers.GetSupervisorDashboard)
		r.Get("/api/supervisor/teacher-performance", handlers.GetTeacherPerformance)
		r.Get("/api/supervisor/teacher-detail-assets", handlers.GetTeacherDetailAssets)
		r.Get("/api/supervisor/student-stats", handlers.GetStudentStats)
		r.Get("/api/supervisor/student-list", handlers.GetStudentList)
		r.Get("/api/supervisor/student-detail-performance", handlers.GetStudentDetailPerformance)
		r.Get("/api/supervisor/curriculum-progress", handlers.GetCurriculumProgress)
	})

	// ==================== PARENT ====================
	r.Group(func(r chi.Router) {
		r.Use(middleware.VerifyToken)
		r.Use(middleware.IsParent)

		r.Get("/api/parent/my-children", handlers.GetMyChildren)
		r.Get("/api/parent/dashboard-meta", handlers.GetParentDashboardMeta)
		r.Get("/api/parent/grades", handlers.GetParentGrades)
		r.Get("/api/parent/attendance", handlers.GetParentAttendance)
	})

	fmt.Println("Server running on port 5000")
	log.Fatal(http.ListenAndServe(":5000", r))
}
