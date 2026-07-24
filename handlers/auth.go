package handlers

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"

	"lms-backend-go/config"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const defaultSessionDurationMinutes = 60

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	type userRow struct {
		ID       int
		Username string
		FullName string
		Password string
		Role     string
		IsActive bool
		Religion *string
	}

	var u userRow
	err := config.Pool.QueryRow(context.Background(),
		"SELECT id, username, full_name, password, role, is_active, religion FROM users WHERE username = $1",
		req.Username,
	).Scan(&u.ID, &u.Username, &u.FullName, &u.Password, &u.Role, &u.IsActive, &u.Religion)

	if err != nil {
		jsonError(w, http.StatusUnauthorized, "Username atau password salah.")
		return
	}

	if !u.IsActive {
		jsonError(w, http.StatusForbidden, "Akun Anda dinonaktifkan. Silakan hubungi Admin.")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(u.Password), []byte(req.Password)); err != nil {
		jsonError(w, http.StatusUnauthorized, "Username atau password salah.")
		return
	}

	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "rahasia_spero_lms"
	}

	sessionDurationMinutes := defaultSessionDurationMinutes
	var sessionDurationValue string
	err = config.Pool.QueryRow(context.Background(),
		"SELECT setting_value FROM app_settings WHERE setting_key = 'session_time_limit'",
	).Scan(&sessionDurationValue)
	if err != nil {
		slog.Warn("Gagal membaca session_time_limit, memakai default session duration",
			"error", err,
			"default_minutes", defaultSessionDurationMinutes,
		)
	} else if parsedMinutes, parseErr := strconv.Atoi(sessionDurationValue); parseErr == nil && parsedMinutes > 0 {
		sessionDurationMinutes = parsedMinutes
	} else {
		slog.Warn("session_time_limit tidak valid, memakai default session duration",
			"value", sessionDurationValue,
			"default_minutes", defaultSessionDurationMinutes,
		)
	}

	religion := ""
	if u.Religion != nil {
		religion = *u.Religion
	}

	claims := jwt.MapClaims{
		"id":       u.ID,
		"role":     u.Role,
		"name":     u.FullName,
		"religion": religion,
		"exp":      time.Now().Add(time.Duration(sessionDurationMinutes) * time.Minute).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString([]byte(secret))
	if err != nil {
		serverError(w, r, err, "Terjadi kesalahan pada server.")
		return
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"message": "Login berhasil!",
		"token":   tokenStr,
		"user": map[string]interface{}{
			"id":        u.ID,
			"username":  u.Username,
			"full_name": u.FullName,
			"role":      u.Role,
			"religion":  religion,
		},
	})
}
