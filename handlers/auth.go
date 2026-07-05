package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"time"

	"lms-backend-go/config"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

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
	}

	var u userRow
	err := config.Pool.QueryRow(context.Background(),
		"SELECT id, username, full_name, password, role, is_active FROM users WHERE username = $1",
		req.Username,
	).Scan(&u.ID, &u.Username, &u.FullName, &u.Password, &u.Role, &u.IsActive)

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

	claims := jwt.MapClaims{
		"id":   u.ID,
		"role": u.Role,
		"name": u.FullName,
		"exp":  time.Now().Add(30 * 24 * time.Hour).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString([]byte(secret))
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "Terjadi kesalahan pada server.")
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
		},
	})
}
