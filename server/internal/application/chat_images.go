package application

// A private, bounded image attachment path for the admin Live Chat composer.
// The message contains only an internal reference, never a large data: URL.
import (
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var chatImageIDPattern = regexp.MustCompile(`^ci_[A-Za-z0-9_-]{16,80}$`)

func (a *app) adminUploadChatImage(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		writeError(w, 503, "Database unavailable.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 5<<20)
	if err := r.ParseMultipartForm(5 << 20); err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "Choose an image up to 4 MB.")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	thread := strings.TrimSpace(r.FormValue("thread_id"))
	if len(thread) < 6 || len(thread) > 100 {
		writeError(w, 400, "Select a conversation before uploading an image.")
		return
	}
	var exists bool
	if err := a.db.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM chat_threads WHERE id=$1 AND status='open')`, thread).Scan(&exists); err != nil || !exists {
		writeError(w, 404, "This conversation is unavailable.")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, 400, "Select an image to upload.")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 4*1024*1024+1))
	if err != nil || len(data) == 0 || len(data) > 4*1024*1024 {
		writeError(w, 400, "Images must be 4 MB or smaller.")
		return
	}
	mime := http.DetectContentType(data)
	switch mime {
	case "image/jpeg", "image/png", "image/gif", "image/webp":
	default:
		writeError(w, 400, "Use a PNG, JPEG, GIF or WebP image.")
		return
	}
	id, err := randomOfferToken("ci_")
	if err != nil {
		writeError(w, 500, "Cannot prepare the image.")
		return
	}
	_, err = a.db.ExecContext(r.Context(), `INSERT INTO chat_images(id,thread_id,image_mime,image_data) VALUES($1,$2,$3,$4)`, id, thread, mime, data)
	if err != nil {
		writeError(w, 503, "Unable to store chat image; check database alignment.")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 201, map[string]string{"url": "/api/chat/images/" + id, "id": id})
}

func (a *app) viewChatImage(w http.ResponseWriter, r *http.Request) {
	if a.db == nil {
		http.NotFound(w, r)
		return
	}
	id := r.PathValue("id")
	if !chatImageIDPattern.MatchString(id) {
		http.NotFound(w, r)
		return
	}
	var thread, mime string
	var body []byte
	var expiry time.Time
	err := a.db.QueryRowContext(r.Context(), `SELECT thread_id,image_mime,image_data,expires_at FROM chat_images WHERE id=$1`, id).Scan(&thread, &mime, &body, &expiry)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if time.Now().After(expiry) {
		http.NotFound(w, r)
		return
	}
	if !a.isAdmin(r) {
		current, e := a.currentChatThread(r)
		if e != nil || current != thread {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
	}
	if len(body) == 0 || len(body) > 4*1024*1024 || mime == "" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store, max-age=0")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
