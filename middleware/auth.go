package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	ID       int    `json:"id"`
	Role     string `json:"role"`
	Name     string `json:"name"`
	Religion string `json:"religion"`
	jwt.RegisteredClaims
}

type contextKey string

const claimsKey contextKey = "claims"

func getJWTSecret() []byte {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "rahasia_spero_lms"
	}
	return []byte(secret)
}

func sendJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(payload)
}

func VerifyToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			sendJSON(w, http.StatusUnauthorized, map[string]interface{}{
				"success": false,
				"message": "Akses ditolak, token tidak ditemukan",
			})
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			sendJSON(w, http.StatusUnauthorized, map[string]interface{}{
				"success": false,
				"message": "Akses ditolak, token tidak ditemukan",
			})
			return
		}

		tokenStr := parts[1]
		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
			return getJWTSecret(), nil
		})

		if err != nil || !token.Valid {
			sendJSON(w, http.StatusForbidden, map[string]interface{}{
				"success": false,
				"message": "Token tidak valid atau kadaluwarsa",
			})
			return
		}

		ctx := context.WithValue(r.Context(), claimsKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func GetClaims(r *http.Request) *Claims {
	claims, _ := r.Context().Value(claimsKey).(*Claims)
	return claims
}

func IsAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := GetClaims(r)
		if claims == nil || claims.Role != "admin" {
			sendJSON(w, http.StatusForbidden, map[string]interface{}{
				"success": false,
				"message": "Akses terbatas! Hanya Administrator yang diizinkan.",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func IsTeacher(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := GetClaims(r)
		if claims == nil || claims.Role != "teacher" {
			sendJSON(w, http.StatusForbidden, map[string]interface{}{
				"success": false,
				"message": "Akses terbatas! Hanya Guru yang diizinkan.",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func IsStudent(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := GetClaims(r)
		if claims == nil || claims.Role != "student" {
			sendJSON(w, http.StatusForbidden, map[string]interface{}{
				"success": false,
				"message": "Akses terbatas! Hanya Siswa yang diizinkan.",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func IsParent(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := GetClaims(r)
		if claims == nil || claims.Role != "parent" {
			sendJSON(w, http.StatusForbidden, map[string]interface{}{
				"success": false,
				"message": "Akses terbatas! Hanya Orangtua yang diizinkan.",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func IsSupervisor(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := GetClaims(r)
		if claims == nil || claims.Role != "supervisor" {
			sendJSON(w, http.StatusForbidden, map[string]interface{}{
				"success": false,
				"message": "Akses terbatas! Hanya Pengawas yang diizinkan.",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func IsAdminOrTeacher(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := GetClaims(r)
		if claims == nil || (claims.Role != "admin" && claims.Role != "teacher") {
			sendJSON(w, http.StatusForbidden, map[string]interface{}{
				"success": false,
				"message": "Akses terbatas! Hanya Admin dan Guru yang diizinkan.",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func IsAdminOrTeacherOrSupervisor(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := GetClaims(r)
		if claims == nil || (claims.Role != "admin" && claims.Role != "teacher" && claims.Role != "supervisor") {
			sendJSON(w, http.StatusForbidden, map[string]interface{}{
				"success": false,
				"message": "Akses terbatas! Hanya Admin, Guru, dan Pengawas yang diizinkan.",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func IsStudentOrParent(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := GetClaims(r)
		if claims == nil || (claims.Role != "student" && claims.Role != "parent") {
			sendJSON(w, http.StatusForbidden, map[string]interface{}{
				"success": false,
				"message": "Akses terbatas! Hanya Siswa dan Orangtua yang diizinkan.",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}
