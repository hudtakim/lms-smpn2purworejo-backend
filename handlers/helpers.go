package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math/rand"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func jsonResponse(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, status int, message string) {
	jsonResponse(w, status, map[string]string{"error": message})
}

// serverError logs the underlying error (with request context) and returns a
// generic 500 response to the client. Use this instead of jsonError for all
// unexpected server-side failures (DB errors, file I/O errors, etc.).
func serverError(w http.ResponseWriter, r *http.Request, err error, message string) {
	slog.Error(message,
		"error", err,
		"method", r.Method,
		"path", r.URL.Path,
	)
	jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": message})
}

// saveUploadedFile saves the uploaded file to ./uploads/ and returns the URL path.
// Returns empty string if no file was uploaded.
func saveUploadedFile(r *http.Request, fieldName string) (string, error) {
	file, header, err := r.FormFile(fieldName)
	if err != nil {
		// No file uploaded - not an error
		return "", nil
	}
	defer file.Close()

	ext := filepath.Ext(header.Filename)
	if ext == "" {
		ext = ".bin"
	}

	randSuffix := rand.Intn(1000000)
	filename := fmt.Sprintf("%d-%d%s", time.Now().UnixMilli(), randSuffix, ext)

	if err := os.MkdirAll("./uploads", 0755); err != nil {
		return "", err
	}

	destPath := filepath.Join("./uploads", filename)
	destFile, err := os.Create(destPath)
	if err != nil {
		return "", err
	}
	defer destFile.Close()

	if _, err = io.Copy(destFile, file); err != nil {
		return "", err
	}

	return "/uploads/" + filename, nil
}

// saveUploadedFileFromHeader saves from an already-opened multipart file.
func saveUploadedFileFromHeader(file multipart.File, header *multipart.FileHeader) (string, error) {
	ext := filepath.Ext(header.Filename)
	if ext == "" {
		ext = ".bin"
	}

	randSuffix := rand.Intn(1000000)
	filename := fmt.Sprintf("%d-%d%s", time.Now().UnixMilli(), randSuffix, ext)

	if err := os.MkdirAll("./uploads", 0755); err != nil {
		return "", err
	}

	destPath := filepath.Join("./uploads", filename)
	destFile, err := os.Create(destPath)
	if err != nil {
		return "", err
	}
	defer destFile.Close()

	if _, err = io.Copy(destFile, file); err != nil {
		return "", err
	}

	return "/uploads/" + filename, nil
}

// deleteFile removes a physical file given its URL path like /uploads/filename.ext
func deleteFile(urlPath string) {
	if urlPath == "" {
		return
	}
	localPath := "." + urlPath
	os.Remove(localPath)
}

// extractEmbedURL extracts the src from an iframe string, or returns as-is if not an iframe.
func extractEmbedURL(raw string) string {
	if !strings.Contains(raw, "<iframe") {
		return raw
	}
	// find src="..."
	lower := strings.ToLower(raw)
	srcIdx := strings.Index(lower, "src=")
	if srcIdx == -1 {
		return raw
	}
	rest := raw[srcIdx+4:]
	if len(rest) == 0 {
		return raw
	}
	quote := rest[0]
	if quote != '"' && quote != '\'' {
		return raw
	}
	rest = rest[1:]
	endIdx := strings.IndexByte(rest, quote)
	if endIdx == -1 {
		return raw
	}
	return rest[:endIdx]
}

// dayIntToName converts a day_of_week integer to Indonesian name.
func dayIntToName(d int) string {
	switch d {
	case 1:
		return "Senin"
	case 2:
		return "Selasa"
	case 3:
		return "Rabu"
	case 4:
		return "Kamis"
	case 5:
		return "Jumat"
	case 6:
		return "Sabtu"
	default:
		return "Minggu"
	}
}

// formatFileSize formats bytes to MB string.
func formatFileSize(bytes int64) string {
	mb := float64(bytes) / (1024 * 1024)
	return fmt.Sprintf("%.2f MB", mb)
}

// toIntIface converts an interface{} (from pgx row values) to int.
func toIntIface(v interface{}) int {
	if v == nil {
		return 0
	}
	switch val := v.(type) {
	case int32:
		return int(val)
	case int64:
		return int(val)
	case int:
		return val
	case float64:
		return int(val)
	case float32:
		return int(val)
	default:
		s := fmt.Sprintf("%v", v)
		n, _ := strconv.Atoi(s)
		return n
	}
}

// toFloat64 converts an interface{} (from pgx row values) to float64.
func toFloat64(v interface{}) float64 {
	if v == nil {
		return 0
	}
	switch val := v.(type) {
	case float64:
		return val
	case float32:
		return float64(val)
	case int32:
		return float64(val)
	case int64:
		return float64(val)
	case int:
		return float64(val)
	default:
		s := fmt.Sprintf("%v", v)
		f, _ := strconv.ParseFloat(s, 64)
		return f
	}
}

// getColValue returns the value from a row map trying multiple key variants.
func getColValue(row map[string]string, keys ...string) string {
	for _, k := range keys {
		if v, ok := row[k]; ok && v != "" {
			return strings.TrimSpace(v)
		}
		// case-insensitive
		kl := strings.ToLower(k)
		for rk, rv := range row {
			if strings.ToLower(rk) == kl {
				return strings.TrimSpace(rv)
			}
		}
	}
	return ""
}
