package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gotd/td/session"
	"github.com/gotd/td/telegram"
	"github.com/gotd/td/telegram/downloader"
	"github.com/gotd/td/tg"
)

type FileInfo struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	TelegramMsgID string `json:"telegram_msg_id"`
	Size          *int64 `json:"size"`
	IsPrivate     bool   `json:"is_private"`
}

var (
	botToken    string
	supabaseURL string
	supabaseKey string
	apiID       int
	apiHash     string

	tgClient    *telegram.Client
	tgAPI       *tg.Client
	tgReady     bool
	tgMu        sync.RWMutex
	dl          *downloader.Downloader
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	botToken = os.Getenv("TELEGRAM_BOT_TOKEN")
	supabaseURL = os.Getenv("SUPABASE_URL")
	supabaseKey = os.Getenv("SUPABASE_SERVICE_ROLE_KEY")

	apiIDStr := os.Getenv("TELEGRAM_API_ID")
	apiHash = os.Getenv("TELEGRAM_API_HASH")

	if botToken == "" {
		log.Fatal("TELEGRAM_BOT_TOKEN is required")
	}
	if supabaseURL == "" || supabaseKey == "" {
		log.Fatal("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
	}
	if apiIDStr == "" || apiHash == "" {
		log.Fatal("TELEGRAM_API_ID and TELEGRAM_API_HASH are required (get from https://my.telegram.org/apps)")
	}

	var err error
	apiID, err = strconv.Atoi(apiIDStr)
	if err != nil {
		log.Fatalf("Invalid TELEGRAM_API_ID: %v", err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	// Initialize MTProto client
	dl = downloader.NewDownloader()

	sessionStorage := &session.StorageMemory{}

	tgClient = telegram.NewClient(apiID, apiHash, telegram.Options{
		SessionStorage: sessionStorage,
	})

	// Start HTTP server in background
	mux := http.NewServeMux()
	mux.HandleFunc("/api/stream/", handleStream)
	mux.HandleFunc("/api/download/", handleDownload)
	mux.HandleFunc("/api/auth/status", handleAuthStatus)
	mux.HandleFunc("/api/files", handleListFiles)
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/", handleRoot)

	handler := corsMiddleware(mux)

	go func() {
		log.Printf("🚀 HTTP server starting on port %s", port)
		if err := http.ListenAndServe(":"+port, handler); err != nil {
			log.Fatal(err)
		}
	}()

	// Run MTProto client (blocking)
	log.Println("🔄 Connecting to Telegram MTProto...")
	err = tgClient.Run(ctx, func(ctx context.Context) error {
		// Authenticate as bot
		status, err := tgClient.Auth().Status(ctx)
		if err != nil {
			return fmt.Errorf("auth status: %w", err)
		}

		if !status.Authorized {
			log.Println("🤖 Authenticating bot via MTProto...")
			if _, err := tgClient.Auth().Bot(ctx, botToken); err != nil {
				return fmt.Errorf("bot auth: %w", err)
			}
		}

		tgMu.Lock()
		tgAPI = tgClient.API()
		tgReady = true
		tgMu.Unlock()

		log.Println("✅ MTProto connected! Bot authenticated. Ready for large file downloads.")

		// Block until context is cancelled
		<-ctx.Done()
		return ctx.Err()
	})

	if err != nil && ctx.Err() == nil {
		log.Fatalf("MTProto client error: %v", err)
	}
}

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

func handleRoot(w http.ResponseWriter, r *http.Request) {
	tgMu.RLock()
	ready := tgReady
	tgMu.RUnlock()
	jsonResp(w, map[string]interface{}{
		"status":    "ok",
		"service":   "telegram-filestream",
		"version":   "3.0.0-mtproto",
		"mtproto":   ready,
	}, http.StatusOK)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	tgMu.RLock()
	ready := tgReady
	tgMu.RUnlock()
	jsonResp(w, map[string]interface{}{
		"status":  "healthy",
		"mtproto": ready,
	}, http.StatusOK)
}

func handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	tgMu.RLock()
	ready := tgReady
	tgMu.RUnlock()
	jsonResp(w, map[string]interface{}{
		"authenticated": ready,
		"method":        "mtproto_bot",
		"message":       "MTProto bot auth - unlimited file size",
	}, http.StatusOK)
}

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

// handleStream streams a file via MTProto (supports any file size)
func handleStream(w http.ResponseWriter, r *http.Request) {
	fileID := strings.TrimPrefix(r.URL.Path, "/api/stream/")
	if fileID == "" {
		jsonResp(w, map[string]interface{}{"error": "missing file ID"}, http.StatusBadRequest)
		return
	}

	tgMu.RLock()
	ready := tgReady
	api := tgAPI
	tgMu.RUnlock()

	if !ready || api == nil {
		jsonResp(w, map[string]interface{}{"error": "MTProto not connected yet"}, http.StatusServiceUnavailable)
		return
	}

	log.Printf("🎯 Stream request: %s", fileID)

	file, err := getFileByID(fileID)
	if err != nil {
		jsonResp(w, map[string]interface{}{"error": "File not found"}, http.StatusNotFound)
		return
	}

	// First try Bot API getFile (works for <20MB, faster)
	telegramFileURL, fileSize, botErr := getTelegramFileURL(file.TelegramMsgID)
	if botErr == nil && fileSize > 0 && fileSize <= 20*1024*1024 {
		// Small file - use Bot API (faster)
		log.Printf("📡 Small file (%s), using Bot API", formatBytes(fileSize))
		streamViaBotAPI(w, r, file, telegramFileURL, fileSize)
		return
	}

	// Large file or Bot API failed - use MTProto
	log.Printf("📡 Using MTProto for file: %s", file.Name)
	streamViaMTProto(w, r, file, api)
}

func streamViaBotAPI(w http.ResponseWriter, r *http.Request, file *FileInfo, telegramFileURL string, fileSize int64) {
	rangeHeader := r.Header.Get("Range")
	var start, end int64
	end = fileSize - 1
	statusCode := http.StatusOK

	if rangeHeader != "" {
		s, e, err := parseRange(rangeHeader, fileSize)
		if err == nil {
			start = s
			end = e
			statusCode = http.StatusPartialContent
		}
	}

	contentLength := end - start + 1

	telegramReq, _ := http.NewRequest("GET", telegramFileURL, nil)
	if statusCode == http.StatusPartialContent {
		telegramReq.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, end))
	}

	client := &http.Client{Timeout: 300 * time.Second}
	telegramResp, err := client.Do(telegramReq)
	if err != nil {
		jsonResp(w, map[string]interface{}{"error": "Failed to fetch"}, http.StatusBadGateway)
		return
	}
	defer telegramResp.Body.Close()

	contentType := detectContentType(file.Name)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Content-Length", strconv.FormatInt(contentLength, 10))
	w.Header().Set("X-Accel-Buffering", "no")

	if statusCode == http.StatusPartialContent {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, fileSize))
	}

	w.WriteHeader(statusCode)
	written, _ := io.Copy(w, telegramResp.Body)
	log.Printf("✅ Bot API streamed %s of %s", formatBytes(written), file.Name)
}

func streamViaMTProto(w http.ResponseWriter, r *http.Request, file *FileInfo, api *tg.Client) {
	ctx := r.Context()

	var totalSize int64
	if file.Size != nil && *file.Size > 0 {
		totalSize = *file.Size
	}

	// Decode file_id to get MTProto InputFileLocation
	location, err := decodeFileID(file.TelegramMsgID)
	if err != nil {
		log.Printf("❌ Cannot decode file_id: %v", err)
		jsonResp(w, map[string]interface{}{
			"error": fmt.Sprintf("Cannot decode file_id for MTProto download: %v", err),
		}, http.StatusInternalServerError)
		return
	}

	log.Printf("✅ Decoded file_id successfully, starting MTProto download for: %s", file.Name)

	// Use pipe to stream MTProto download to HTTP response
	pr, pw := io.Pipe()

	go func() {
		defer pw.Close()
		_, dlErr := dl.Download(api, location).Stream(ctx, pw)
		if dlErr != nil {
			log.Printf("❌ MTProto download error: %v", dlErr)
			pw.CloseWithError(dlErr)
		}
	}()

	contentType := detectContentType(file.Name)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Accept-Ranges", "none") // No range support for MTProto stream
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Transfer-Encoding", "chunked")

	if totalSize > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(totalSize, 10))
	}

	w.WriteHeader(http.StatusOK)
	written, err := io.Copy(w, pr)
	if err != nil {
		log.Printf("⚠️ Stream error: %v", err)
	} else {
		log.Printf("✅ MTProto streamed %s of %s", formatBytes(written), file.Name)
	}
}


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

	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, file.Name))

	// Reuse stream handler
	r.URL.Path = "/api/stream/" + fileID
	handleStream(w, r)
}

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
			FilePath string `json:"file_path"`
			FileSize int64  `json:"file_size"`
		} `json:"result"`
		Description string `json:"description"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", 0, fmt.Errorf("failed to parse response: %w", err)
	}

	if !result.OK {
		return "", 0, fmt.Errorf("bot API error: %s", result.Description)
	}

	fileURL := fmt.Sprintf("https://api.telegram.org/file/bot%s/%s", botToken, result.Result.FilePath)
	return fileURL, result.Result.FileSize, nil
}

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
	case strings.HasSuffix(lower, ".ogg"):
		return "audio/ogg"
	case strings.HasSuffix(lower, ".pdf"):
		return "application/pdf"
	case strings.HasSuffix(lower, ".jpg"), strings.HasSuffix(lower, ".jpeg"):
		return "image/jpeg"
	case strings.HasSuffix(lower, ".png"):
		return "image/png"
	case strings.HasSuffix(lower, ".gif"):
		return "image/gif"
	case strings.HasSuffix(lower, ".webp"):
		return "image/webp"
	case strings.HasSuffix(lower, ".zip"):
		return "application/zip"
	case strings.HasSuffix(lower, ".rar"):
		return "application/x-rar-compressed"
	default:
		return "application/octet-stream"
	}
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
