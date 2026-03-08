package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// FileInfo represents a file record from Supabase
type FileInfo struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	TelegramMsgID string    `json:"telegram_msg_id"`
	Size          *int64    `json:"size"`
	IsPrivate     bool      `json:"is_private"`
	CreatedAt     time.Time `json:"created_at"`
}

var (
	botToken    string
	supabaseURL string
	supabaseKey string
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	botToken = os.Getenv("TELEGRAM_BOT_TOKEN")
	supabaseURL = os.Getenv("SUPABASE_URL")
	supabaseKey = os.Getenv("SUPABASE_SERVICE_ROLE_KEY")

	if botToken == "" {
		log.Fatal("TELEGRAM_BOT_TOKEN is required")
	}
	if supabaseURL == "" || supabaseKey == "" {
		log.Fatal("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/stream/", handleStream)
	mux.HandleFunc("/api/download/", handleDownload)
	mux.HandleFunc("/api/auth/status", handleAuthStatus)
	mux.HandleFunc("/api/auth/otp", handleAuthOTP)
	mux.HandleFunc("/api/files", handleListFiles)
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/", handleRoot)

	handler := corsMiddleware(mux)

	log.Printf("🚀 Filestream server starting on port %s", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal(err)
	}
}

// corsMiddleware adds CORS headers to all responses
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "authorization, content-type, range, apikey, x-client-info")
		w.Header().Set("Access-Control-Expose-Headers", "content-length, content-range, accept-ranges, content-type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// handleRoot returns a simple status page
func handleRoot(w http.ResponseWriter, r *http.Request) {
	jsonResp(w, map[string]interface{}{
		"status":  "ok",
		"service": "telegram-filestream",
		"version": "2.0.0",
	}, http.StatusOK)
}

// handleHealth returns health status
func handleHealth(w http.ResponseWriter, r *http.Request) {
	jsonResp(w, map[string]interface{}{"status": "healthy"}, http.StatusOK)
}

// handleAuthStatus - Bot API doesn't need MTProto auth, always authenticated
func handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	jsonResp(w, map[string]interface{}{
		"authenticated": true,
		"method":        "bot_api",
		"message":       "Bot API mode - no session auth needed",
	}, http.StatusOK)
}

// handleAuthOTP - Not needed for Bot API mode
func handleAuthOTP(w http.ResponseWriter, r *http.Request) {
	jsonResp(w, map[string]interface{}{
		"success": true,
		"message": "Bot API mode - OTP not required",
	}, http.StatusOK)
}

// handleListFiles returns files from Supabase
func handleListFiles(w http.ResponseWriter, r *http.Request) {
	req, err := http.NewRequest("GET", supabaseURL+"/rest/v1/files?select=*&order=created_at.desc", nil)
	if err != nil {
		jsonResp(w, map[string]interface{}{"error": err.Error()}, http.StatusInternalServerError)
		return
	}
	req.Header.Set("apikey", supabaseKey)
	req.Header.Set("Authorization", "Bearer "+supabaseKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		jsonResp(w, map[string]interface{}{"error": err.Error()}, http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// handleStream streams a file by its public ID (proxies from Telegram Bot API)
func handleStream(w http.ResponseWriter, r *http.Request) {
	fileID := strings.TrimPrefix(r.URL.Path, "/api/stream/")
	if fileID == "" {
		jsonResp(w, map[string]interface{}{"error": "missing file ID"}, http.StatusBadRequest)
		return
	}

	log.Printf("🎯 Stream request: %s /api/stream/%s from %s", r.Method, fileID, r.RemoteAddr)

	// Look up file in Supabase
	file, err := getFileByID(fileID)
	if err != nil {
		log.Printf("❌ File lookup error: %v", err)
		jsonResp(w, map[string]interface{}{"error": "File not found"}, http.StatusNotFound)
		return
	}

	log.Printf("🔍 Streaming file: ID=%s, Name=%s, Size=%s", file.ID, file.Name, formatSize(file.Size))

	// Get Telegram file URL via Bot API
	telegramFileURL, fileSize, err := getTelegramFileURL(file.TelegramMsgID)
	if err != nil {
		log.Printf("❌ Telegram Bot API error: %v", err)
		jsonResp(w, map[string]interface{}{"error": "Failed to get file from Telegram"}, http.StatusInternalServerError)
		return
	}

	log.Printf("📡 Telegram file URL obtained, size=%d", fileSize)

	// Parse Range header
	rangeHeader := r.Header.Get("Range")
	var start, end int64
	end = fileSize - 1
	statusCode := http.StatusOK

	if rangeHeader != "" {
		log.Printf("🔎 Range header: %s", rangeHeader)
		s, e, err := parseRange(rangeHeader, fileSize)
		if err == nil {
			start = s
			end = e
			statusCode = http.StatusPartialContent
		}
	}

	contentLength := end - start + 1

	// Fetch from Telegram CDN with Range if needed
	telegramReq, err := http.NewRequest("GET", telegramFileURL, nil)
	if err != nil {
		jsonResp(w, map[string]interface{}{"error": "Request creation failed"}, http.StatusInternalServerError)
		return
	}

	if statusCode == http.StatusPartialContent {
		telegramReq.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, end))
	}

	client := &http.Client{Timeout: 300 * time.Second}
	telegramResp, err := client.Do(telegramReq)
	if err != nil {
		log.Printf("❌ Telegram CDN fetch error: %v", err)
		jsonResp(w, map[string]interface{}{"error": "Failed to fetch from Telegram CDN"}, http.StatusBadGateway)
		return
	}
	defer telegramResp.Body.Close()

	// Detect content type
	contentType := detectContentType(file.Name)

	// Set response headers
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Content-Length", strconv.FormatInt(contentLength, 10))
	w.Header().Set("X-Accel-Buffering", "no") // Disable buffering on Render/nginx

	if statusCode == http.StatusPartialContent {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, fileSize))
	}

	w.WriteHeader(statusCode)

	// Stream the content directly to the client
	written, err := io.Copy(w, telegramResp.Body)
	if err != nil {
		log.Printf("⚠️ Stream copy error (client may have disconnected): %v", err)
	} else {
		log.Printf("✅ Streamed %s of %s successfully", formatBytes(written), file.Name)
	}
}

// handleDownload is the same as stream but with Content-Disposition header
func handleDownload(w http.ResponseWriter, r *http.Request) {
	fileID := strings.TrimPrefix(r.URL.Path, "/api/download/")
	if fileID == "" {
		jsonResp(w, map[string]interface{}{"error": "missing file ID"}, http.StatusBadRequest)
		return
	}

	file, err := getFileByID(fileID)
	if err != nil {
		jsonResp(w, map[string]interface{}{"error": "File not found"}, http.StatusNotFound)
		return
	}

	telegramFileURL, _, err := getTelegramFileURL(file.TelegramMsgID)
	if err != nil {
		jsonResp(w, map[string]interface{}{"error": "Failed to get file"}, http.StatusInternalServerError)
		return
	}

	resp, err := http.Get(telegramFileURL)
	if err != nil {
		jsonResp(w, map[string]interface{}{"error": "Failed to fetch file"}, http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, file.Name))
	w.Header().Set("X-Accel-Buffering", "no")
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		w.Header().Set("Content-Length", cl)
	}

	io.Copy(w, resp.Body)
}

// getTelegramFileURL gets the direct download URL from Telegram Bot API
func getTelegramFileURL(telegramFileID string) (string, int64, error) {
	apiURL := fmt.Sprintf("https://api.telegram.org/bot%s/getFile?file_id=%s", botToken, telegramFileID)

	resp, err := http.Get(apiURL)
	if err != nil {
		return "", 0, fmt.Errorf("bot API request failed: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		OK     bool `json:"ok"`
		Result struct {
			FileID   string `json:"file_id"`
			FilePath string `json:"file_path"`
			FileSize int64  `json:"file_size"`
		} `json:"result"`
		Description string `json:"description"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", 0, fmt.Errorf("failed to parse bot API response: %w", err)
	}

	if !result.OK {
		return "", 0, fmt.Errorf("bot API error: %s", result.Description)
	}

	fileURL := fmt.Sprintf("https://api.telegram.org/file/bot%s/%s", botToken, result.Result.FilePath)
	return fileURL, result.Result.FileSize, nil
}

// getFileByID looks up a file record from Supabase by its ID
func getFileByID(fileID string) (*FileInfo, error) {
	url := fmt.Sprintf("%s/rest/v1/files?select=*&id=eq.%s", supabaseURL, fileID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", supabaseKey)
	req.Header.Set("Authorization", "Bearer "+supabaseKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var files []FileInfo
	if err := json.NewDecoder(resp.Body).Decode(&files); err != nil {
		return nil, err
	}

	if len(files) == 0 {
		return nil, fmt.Errorf("file not found: %s", fileID)
	}

	return &files[0], nil
}

// parseRange parses an HTTP Range header
func parseRange(rangeHeader string, totalSize int64) (int64, int64, error) {
	rangeHeader = strings.TrimPrefix(rangeHeader, "bytes=")
	parts := strings.Split(rangeHeader, "-")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("invalid range")
	}

	var start, end int64
	var err error

	if parts[0] != "" {
		start, err = strconv.ParseInt(parts[0], 10, 64)
		if err != nil {
			return 0, 0, err
		}
	}

	if parts[1] != "" {
		end, err = strconv.ParseInt(parts[1], 10, 64)
		if err != nil {
			return 0, 0, err
		}
	} else {
		end = totalSize - 1
	}

	if start > end || start >= totalSize {
		return 0, 0, fmt.Errorf("range out of bounds")
	}

	return start, end, nil
}

// detectContentType returns MIME type based on file extension
func detectContentType(filename string) string {
	lower := strings.ToLower(filename)
	switch {
	case strings.HasSuffix(lower, ".mp4"):
		return "video/mp4"
	case strings.HasSuffix(lower, ".mkv"):
		return "video/x-matroska"
	case strings.HasSuffix(lower, ".avi"):
		return "video/x-msvideo"
	case strings.HasSuffix(lower, ".mov"):
		return "video/quicktime"
	case strings.HasSuffix(lower, ".webm"):
		return "video/webm"
	case strings.HasSuffix(lower, ".mp3"):
		return "audio/mpeg"
	case strings.HasSuffix(lower, ".flac"):
		return "audio/flac"
	case strings.HasSuffix(lower, ".pdf"):
		return "application/pdf"
	case strings.HasSuffix(lower, ".jpg"), strings.HasSuffix(lower, ".jpeg"):
		return "image/jpeg"
	case strings.HasSuffix(lower, ".png"):
		return "image/png"
	case strings.HasSuffix(lower, ".gif"):
		return "image/gif"
	case strings.HasSuffix(lower, ".zip"):
		return "application/zip"
	default:
		return "application/octet-stream"
	}
}

func formatSize(size *int64) string {
	if size == nil {
		return "unknown"
	}
	return formatBytes(*size)
}

func formatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

func jsonResp(w http.ResponseWriter, data map[string]interface{}, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
