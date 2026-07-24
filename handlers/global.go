package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"time"

	"lms-backend-go/config"
	"lms-backend-go/middleware"

	"golang.org/x/crypto/bcrypt"
)

func GetActiveAcademicYear(w http.ResponseWriter, r *http.Request) {
	rows, err := config.Pool.Query(context.Background(),
		"SELECT * FROM academic_years WHERE is_active = true LIMIT 1")
	if err != nil {
		serverError(w, r, err, "Internal server error")
		return
	}
	defer rows.Close()

	fieldDescs := rows.FieldDescriptions()
	var result map[string]interface{}
	if rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			serverError(w, r, err, "Internal server error")
			return
		}
		result = make(map[string]interface{})
		for i, fd := range fieldDescs {
			result[string(fd.Name)] = vals[i]
		}
	}

	jsonResponse(w, http.StatusOK, result)
}

func GetSessionDurationLimit(w http.ResponseWriter, r *http.Request) {
	rows, err := config.Pool.Query(context.Background(),
		"SELECT * FROM app_settings WHERE setting_key = 'session_time_limit'")
	if err != nil {
		serverError(w, r, err, "Internal server error")
		return
	}
	defer rows.Close()

	fieldDescs := rows.FieldDescriptions()
	var result map[string]interface{}
	if rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			serverError(w, r, err, "Internal server error")
			return
		}
		result = make(map[string]interface{})
		for i, fd := range fieldDescs {
			result[string(fd.Name)] = vals[i]
		}
	}

	jsonResponse(w, http.StatusOK, result)
}

func GetMaintenanceStatus(w http.ResponseWriter, r *http.Request) {
	rows, err := config.Pool.Query(context.Background(),
		"SELECT * FROM app_settings WHERE setting_key = 'mode_maintenance'")
	if err != nil {
		serverError(w, r, err, "Internal server error")
		return
	}
	defer rows.Close()

	fieldDescs := rows.FieldDescriptions()
	var result map[string]interface{}
	if rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			serverError(w, r, err, "Internal server error")
			return
		}
		result = make(map[string]interface{})
		for i, fd := range fieldDescs {
			result[string(fd.Name)] = vals[i]
		}
	}

	jsonResponse(w, http.StatusOK, result)
}

func GetAdminWhatsapp(w http.ResponseWriter, r *http.Request) {
	rows, err := config.Pool.Query(context.Background(),
		"SELECT * FROM app_settings WHERE setting_key = 'admin_wa'")
	if err != nil {
		serverError(w, r, err, "Internal server error")
		return
	}
	defer rows.Close()

	fieldDescs := rows.FieldDescriptions()
	var result map[string]interface{}
	if rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			serverError(w, r, err, "Internal server error")
			return
		}
		result = make(map[string]interface{})
		for i, fd := range fieldDescs {
			result[string(fd.Name)] = vals[i]
		}
	}

	jsonResponse(w, http.StatusOK, result)
}

func GetProfile(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	userId := claims.ID

	rows, err := config.Pool.Query(context.Background(), `
		SELECT
			u.username,
			u.full_name,
			u.role,
			u.gender,
			u.religion,
			u.updated_at,
			CONCAT(c.grade,'-',c.name) AS class_name
		FROM users u
		LEFT JOIN class_members cm ON cm.student_id = u.id
		LEFT JOIN classes c ON c.id = cm.class_id
		WHERE u.id = $1
	`, userId)
	if err != nil {
		serverError(w, r, err, "Internal server error")
		return
	}
	defer rows.Close()

	fieldDescs := rows.FieldDescriptions()
	var result map[string]interface{}
	if rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			serverError(w, r, err, "Internal server error")
			return
		}
		result = make(map[string]interface{})
		for i, fd := range fieldDescs {
			result[string(fd.Name)] = vals[i]
		}
	}

	if result == nil {
		jsonError(w, http.StatusNotFound, "User tidak ditemukan")
		return
	}

	jsonResponse(w, http.StatusOK, result)
}

func UpdatePassword(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetClaims(r)
	userId := claims.ID

	var body struct {
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if len(body.NewPassword) < 6 {
		jsonError(w, http.StatusBadRequest, "Password baru minimal 6 karakter.")
		return
	}

	var updatedAt *time.Time
	err := config.Pool.QueryRow(context.Background(),
		"SELECT updated_at FROM users WHERE id = $1", userId).Scan(&updatedAt)
	if err != nil {
		serverError(w, r, err, "Terjadi kesalahan pada server.")
		return
	}

	if updatedAt != nil {
		daysSince := time.Since(*updatedAt).Hours() / 24
		if daysSince < 7 {
			daysLeft := int(math.Ceil(7 - daysSince))
			jsonError(w, http.StatusBadRequest, fmt.Sprintf("Anda sudah pernah mengubah password minggu ini. Silakan coba lagi dalam %d hari.", daysLeft))
			return
		}
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), 10)
	if err != nil {
		serverError(w, r, err, "Terjadi kesalahan pada server.")
		return
	}

	_, err = config.Pool.Exec(context.Background(),
		"UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2",
		string(hashed), userId)
	if err != nil {
		serverError(w, r, err, "Terjadi kesalahan pada server.")
		return
	}

	jsonResponse(w, http.StatusOK, map[string]string{
		"message": "Password berhasil diperbarui! Gunakan password baru ini saat login berikutnya.",
	})
}
