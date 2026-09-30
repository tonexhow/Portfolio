package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/netip"
	neturl "net/url"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"jpano.dev/portfolio/internal/config"
	"jpano.dev/portfolio/internal/database"
	mediastore "jpano.dev/portfolio/internal/storage"
)

type app struct {
	db         *database.DB
	clientDir  string
	appURL     string
	apiURL     string
	origins    map[string]bool
	settings   config.Settings
	mediaStore *mediastore.Client
	chat       *chatHub

	smtpHost string
	smtpPort string
	smtpUser string
	smtpPass string
	smtpTo   string

	accessSecret []byte
	access       *accessManager

	mu          sync.Mutex
	rateLimiter map[string]*rateState
}

type rateState struct {
	Count   int
	ResetAt time.Time
}

type feedback struct {
	ID           int64     `json:"id"`
	DisplayName  string    `json:"display_name"`
	Rating       int       `json:"rating"`
	Comment      string    `json:"comment"`
	Status       string    `json:"status,omitempty"`
	Pinned       bool      `json:"pinned,omitempty"`
	AuthProvider string    `json:"auth_provider,omitempty"`
	Credential   string    `json:"credential,omitempty"`
	AvatarURL    string    `json:"avatar_url,omitempty"`
	ProfileURL   string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
}

type contactMessage struct {
	ID         int64     `json:"id"`
	FullName   string    `json:"full_name"`
	Email      string    `json:"email"`
	Subject    string    `json:"subject"`
	Message    string    `json:"message"`
	Status     string    `json:"status"`
	AvatarURL  string    `json:"avatar_url,omitempty"`
	ProfileURL string    `json:"-"`
	CreatedAt  time.Time `json:"created_at"`
}

func main() {
	settings, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	closeRuntimeLog := configureRuntimeLog(settings.Root, settings.ClientDir)
	defer closeRuntimeLog()
	var db *database.DB
	if settings.DatabaseURL != "" {
		db, err = database.Open(settings.DatabaseURL)
		if err == nil {
			autoSetup := strings.EqualFold(env("DB_AUTO_SETUP", "false"), "true")
			var initialized bool
			initialized, err = database.Ensure(db, settings.Root, autoSetup)
			if err == nil && initialized {
				log.Print("Supabase database initialized from database/schema.sql and database/initial_data.sql.")
			}
		}
		if err != nil {
			if db != nil {
				_ = db.Close()
				db = nil
			}
			// Connection strings may contain passwords: never log the URL or raw driver error.
			log.Print("Database is not ready. Verify DATABASE_URL/network access. If this is a new database, set DB_AUTO_SETUP=true and restart.")
		}
	} else {
		log.Print("DATABASE_URL is empty. The API process is online, but database-backed actions are unavailable.")
	}
	if db != nil {
		defer db.Close()
		database.CleanupExpiredAccess(db)
	}
	accessSecret, err := loadAccessSecret()
	if err != nil {
		log.Fatal(err)
	}
	mediaStore, err := mediastore.FromEnvironment(settings.DatabaseURL)
	if err != nil {
		log.Fatalf("Supabase Storage configuration error: %v", err)
	}
	if mediaStore != nil {
		storageCtx, cancelStorage := context.WithTimeout(context.Background(), 20*time.Second)
		storageErr := mediaStore.EnsureBucket(storageCtx)
		cancelStorage()
		if storageErr != nil {
			if strings.EqualFold(env("STORAGE_REQUIRED", "false"), "true") {
				log.Fatalf("Supabase Storage is required but unavailable: %v", storageErr)
			}
			log.Printf("Supabase Storage is not ready; image uploads will use the database fallback until storage is configured: %v", storageErr)
			mediaStore = nil
		}
	}

	a := &app{
		db:           db,
		clientDir:    settings.ClientDir,
		appURL:       settings.FrontendOrigin,
		apiURL:       settings.APIOrigin,
		origins:      settings.Origins,
		settings:     settings,
		mediaStore:   mediaStore,
		chat:         newChatHub(),
		smtpHost:     env("SMTP_HOST", "smtp.gmail.com"),
		smtpPort:     env("SMTP_PORT", "587"),
		smtpUser:     os.Getenv("SMTP_EMAIL"),
		smtpPass:     os.Getenv("SMTP_PASSWORD"),
		smtpTo:       os.Getenv("SMTP_TO"),
		accessSecret: accessSecret,
		access:       newAccessManager(),
		rateLimiter:  make(map[string]*rateState),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/public/snapshot", a.publicSnapshot)
	mux.HandleFunc("GET /api/public/information", a.publicInformation)
	mux.HandleFunc("GET /api/public/project-media/{id}", a.publicProjectMedia)
	mux.HandleFunc("GET /api/admin/project-media/{id}", a.requireAdmin(a.adminProjectMedia))
	mux.HandleFunc("POST /api/admin/project-media", a.requireAdmin(a.uploadProjectMedia))
	mux.HandleFunc("GET /api/public/profiles", a.publicProfiles)
	mux.HandleFunc("GET /api/public/projects", a.publicProjects)
	mux.HandleFunc("GET /api/public/feedback", a.publicFeedback)
	mux.HandleFunc("POST /api/public/feedback", a.submitFeedback)
	mux.HandleFunc("GET /api/public/feedback/{id}/avatar", a.publicFeedbackAvatar)
	mux.HandleFunc("GET /api/public/feedback-auth/providers", a.feedbackAuthProviders)
	mux.HandleFunc("GET /api/public/feedback-auth/session", a.feedbackAuthSession)
	mux.HandleFunc("GET /api/public/feedback-auth/avatar", a.feedbackAuthAvatar)
	mux.HandleFunc("POST /api/public/feedback-auth/logout", a.feedbackAuthLogout)
	mux.HandleFunc("GET /auth/feedback/{provider}/start", a.feedbackAuthStart)
	mux.HandleFunc("GET /auth/feedback/{provider}/callback", a.feedbackAuthCallback)
	mux.HandleFunc("GET /api/public/contact-auth/session", a.contactAuthSession)
	mux.HandleFunc("GET /api/public/contact-auth/avatar", a.contactAuthAvatar)
	mux.HandleFunc("GET /auth/contact/google/start", a.contactAuthStart)
	mux.HandleFunc("POST /api/public/contact", a.submitContact)
	mux.HandleFunc("GET /api/public/certificates", a.publicCertificates)
	mux.HandleFunc("GET /api/public/certificates/{id}/image", a.publicCertificateImage)
	mux.HandleFunc("GET /api/public/certificates/{id}/download", a.publicCertificateDownload)
	mux.HandleFunc("POST /api/public/visit", a.publicVisit)

	mux.HandleFunc("GET /api/public/career-profiles", a.publicCareerProfiles)
	mux.HandleFunc("GET /api/public/chat/status", a.publicChatStatus)
	mux.HandleFunc("GET /api/public/chat/avatar", a.publicChatAvatar)
	mux.HandleFunc("POST /api/public/chat/session", a.publicChatSession)
	mux.HandleFunc("GET /api/public/chat/ws", a.publicChatWS)

	mux.HandleFunc("GET /api/access/session", a.accessSessionStatus)
	mux.HandleFunc("GET /api/access/pending", a.accessPendingStatus)
	mux.HandleFunc("POST /api/access/challenge", a.accessChallenge)
	mux.HandleFunc("POST /api/access/request", a.accessRequest)
	mux.HandleFunc("POST /api/access/otp", a.accessOTP)
	mux.HandleFunc("POST /api/access/grant", a.accessGrant)
	mux.HandleFunc("POST /api/access/finalize", a.accessFinalize)
	mux.HandleFunc("GET /api/access/events", a.accessEvents)
	mux.HandleFunc("POST /api/access/logout", a.adminLogout)
	mux.HandleFunc("POST /api/admin/logout", a.adminLogout)
	mux.HandleFunc("GET /api/admin/overview", a.requireAdmin(a.adminOverviewV2))
	mux.HandleFunc("GET /api/admin/analytics", a.requireAdmin(a.adminAnalytics))
	mux.HandleFunc("GET /api/admin/feedback", a.requireAdmin(a.adminFeedbackPage))
	mux.HandleFunc("PATCH /api/admin/feedback/{id}", a.requireAdmin(a.adminUpdateFeedbackV2))
	mux.HandleFunc("DELETE /api/admin/feedback/{id}", a.requireAdmin(a.adminDeleteFeedback))
	mux.HandleFunc("GET /api/admin/feedback/{id}/avatar", a.requireAdmin(a.adminFeedbackAvatar))
	mux.HandleFunc("GET /api/admin/contacts", a.requireAdmin(a.adminContactsPage))
	mux.HandleFunc("GET /api/admin/contacts/{id}/avatar", a.requireAdmin(a.adminContactAvatar))
	mux.HandleFunc("PATCH /api/admin/contacts/{id}", a.requireAdmin(a.adminUpdateContactV2))
	mux.HandleFunc("DELETE /api/admin/contacts/{id}", a.requireAdmin(a.adminDeleteContact))
	mux.HandleFunc("POST /api/admin/contacts/{id}/reply", a.requireAdmin(a.adminReplyContact))
	mux.HandleFunc("GET /api/admin/certificates", a.requireAdmin(a.adminCertificatesPage))
	mux.HandleFunc("GET /api/admin/certificates/preview", a.requireAdmin(a.adminCertificateURLPreview))
	mux.HandleFunc("POST /api/admin/certificates", a.requireAdmin(a.adminAddCertificate))
	mux.HandleFunc("POST /api/admin/certificates/{id}", a.requireAdmin(a.adminUpdateCertificate))
	mux.HandleFunc("PATCH /api/admin/certificates/{id}", a.requireAdmin(a.adminSetCertificateState))
	mux.HandleFunc("DELETE /api/admin/certificates/{id}", a.requireAdmin(a.adminDeleteCertificate))
	mux.HandleFunc("GET /api/admin/certificates/{id}/image", a.requireAdmin(a.adminCertificateImage))
	mux.HandleFunc("GET /api/admin/projects", a.requireAdmin(a.adminProjectsPage))
	mux.HandleFunc("POST /api/admin/projects", a.requireAdmin(a.adminAddProject))
	mux.HandleFunc("POST /api/admin/projects/reorder", a.requireAdmin(a.adminReorderProjects))
	mux.HandleFunc("PATCH /api/admin/projects/{key}", a.requireAdmin(a.adminUpdateProject))
	mux.HandleFunc("DELETE /api/admin/projects/{key}", a.requireAdmin(a.adminDeleteProject))
	mux.HandleFunc("POST /api/admin/projects/{key}/ping", a.requireAdmin(a.adminPingProject))
	mux.HandleFunc("GET /api/admin/information", a.requireAdmin(a.adminInformation))
	mux.HandleFunc("POST /api/admin/information/challenge", a.requireAdmin(a.adminInformationChallenge))
	mux.HandleFunc("POST /api/admin/information/save", a.requireAdmin(a.adminSaveInformation))

	mux.HandleFunc("GET /api/admin/career-profiles", a.requireAdmin(a.adminCareerProfiles))
	mux.HandleFunc("POST /api/admin/career-profiles", a.requireAdmin(a.adminAddCareerProfile))
	mux.HandleFunc("POST /api/admin/career-profiles/{id}", a.requireAdmin(a.adminUpdateCareerProfile))
	mux.HandleFunc("DELETE /api/admin/career-profiles/{id}", a.requireAdmin(a.adminDeleteCareerProfile))
	mux.HandleFunc("GET /api/admin/chats", a.requireAdmin(a.adminChats))
	mux.HandleFunc("GET /api/admin/chats/{id}/avatar", a.requireAdmin(a.adminChatAvatar))
	mux.HandleFunc("GET /api/admin/chats/{id}", a.requireAdmin(a.adminChatMessages))
	mux.HandleFunc("DELETE /api/admin/chats/{id}", a.requireAdmin(a.adminDeleteChat))
	mux.HandleFunc("GET /api/admin/chat/ws", a.requireAdmin(a.adminChatWS))

	// The frontend is deployed independently. Only API/auth routes live here.
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, a.appURL, http.StatusSeeOther) })

	server := &http.Server{
		Addr:              net.JoinHostPort(settings.Bind, settings.BackendPort),
		Handler:           a.crossOrigin(a.databaseReady(a.logRequests(mux))),
		ReadHeaderTimeout: 8 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go a.runProjectChecks(ctx)
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				a.cleanupChats()
			}
		}
	}()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		log.Fatal(err)
	}
	defer listener.Close()
	removePID := writeRuntimePID(settings.Root)
	defer removePID()
	log.Printf("Portfolio API listening on %s. Frontend origin: %s", server.Addr, a.appURL)
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func configureRuntimeLog(root, clientDir string) func() {
	if info, err := os.Stat(clientDir); err == nil && info.IsDir() {
		return func() {}
	}
	dir := filepath.Join(root, "systems")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return func() {}
	}
	f, err := os.OpenFile(filepath.Join(dir, "backend.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return func() {}
	}
	log.SetOutput(f)
	return func() { _ = f.Close() }
}

func writeRuntimePID(root string) func() {
	dir := filepath.Join(root, "systems")
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Printf("Unable to create runtime directory for PID file: %v", err)
		return func() {}
	}
	path := filepath.Join(dir, ".jpano-api.pid")
	if err := os.WriteFile(path, []byte(strconv.Itoa(os.Getpid())), 0600); err != nil {
		log.Printf("Unable to write runtime PID file: %v", err)
		return func() {}
	}
	return func() { _ = os.Remove(path) }
}

func (a *app) publicFeedback(w http.ResponseWriter, r *http.Request) {
	page := 1
	limit := 5
	if value, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && value > 0 {
		page = value
	}
	if value, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && value > 0 {
		limit = value
	}
	if limit > 5 {
		limit = 5
	}

	var average sql.NullFloat64
	var count int
	if err := a.db.QueryRow(`SELECT AVG(rating), COUNT(*) FROM feedback WHERE status='approved'`).Scan(&average, &count); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load feedback.")
		return
	}

	totalPages := 1
	if count > 0 {
		totalPages = (count + limit - 1) / limit
	}
	if page > totalPages {
		page = totalPages
	}
	offset := (page - 1) * limit

	rows, err := a.db.Query(`SELECT id, display_name, rating, comment, pinned, auth_provider, credential, profile_url, created_at
		FROM feedback WHERE status='approved'
		ORDER BY pinned DESC, created_at DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load feedback.")
		return
	}
	defer rows.Close()

	items := []feedback{}
	for rows.Next() {
		var f feedback
		if err := rows.Scan(&f.ID, &f.DisplayName, &f.Rating, &f.Comment, &f.Pinned, &f.AuthProvider, &f.Credential, &f.ProfileURL, &f.CreatedAt); err == nil {
			if f.AuthProvider != "" && f.AuthProvider != "legacy" {
				f.DisplayName = maskFeedbackName(f.DisplayName)
				f.Credential = maskFeedbackCredential(f.Credential)
				if f.ProfileURL != "" {
					f.AvatarURL = fmt.Sprintf("/api/public/feedback/%d/avatar", f.ID)
				}
			}
			items = append(items, f)
		}
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load feedback.")
		return
	}

	avg := 0.0
	if average.Valid {
		avg = average.Float64
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":          items,
		"average_rating": avg,
		"rating_count":   count,
		"page":           page,
		"page_size":      limit,
		"total_pages":    totalPages,
		"has_previous":   page > 1,
		"has_next":       page < totalPages,
	})
}

func (a *app) submitFeedback(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Rating  int    `json:"rating"`
		Comment string `json:"comment"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request.")
		return
	}
	in.Comment = strings.TrimSpace(strings.Join(strings.Fields(in.Comment), " "))
	if len([]rune(in.Comment)) > 300 {
		writeError(w, http.StatusBadRequest, "Feedback must be 300 characters or fewer.")
		return
	}
	if in.Comment == "" || in.Rating < 1 || in.Rating > 5 {
		writeError(w, http.StatusBadRequest, "Rating and comment are required.")
		return
	}
	identity, authenticated := a.currentFeedbackIdentity(r)
	if !authenticated {
		writeError(w, http.StatusUnauthorized, "Verify your identity before submitting feedback.")
		return
	}

	if remaining := a.submissionCooldownRemaining(r, "feedback"); remaining > 0 {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{
			"error":       "Please wait before submitting more feedback.",
			"retry_after": remaining,
		})
		return
	}
	if !a.allow(r, "feedback", 5, 10*time.Minute) {
		writeError(w, http.StatusTooManyRequests, "Too many submissions. Please try again later.")
		return
	}

	if _, err := a.db.Exec(`INSERT INTO feedback(display_name, rating, comment, auth_provider, auth_user_id, credential, profile_url) VALUES(?,?,?,?,?,?,?)`,
		identity.DisplayName, in.Rating, in.Comment, identity.Provider, identity.ProviderUserID, identity.Credential, identity.ProfileURL); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to save feedback.")
		return
	}
	a.markSubmissionCooldown(r, "feedback", 30*time.Second)
	writeJSON(w, http.StatusCreated, map[string]any{
		"message":          "Thanks! Your feedback is awaiting review.",
		"cooldown_seconds": 30,
	})
}

func (a *app) submitContact(w http.ResponseWriter, r *http.Request) {
	var in struct {
		FullName string `json:"full_name"`
		Subject  string `json:"subject"`
		Message  string `json:"message"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request.")
		return
	}

	in.FullName = clean(in.FullName, 80)
	in.Subject = clean(in.Subject, 120)
	in.Message = clean(in.Message, 3000)
	identity, authenticated := a.currentContactIdentity(r)
	if !authenticated || identity.Provider != "google" || !validEmail(identity.Credential) {
		writeError(w, http.StatusUnauthorized, "Verify a Google email before sending a contact message.")
		return
	}
	email := strings.TrimSpace(strings.ToLower(identity.Credential))
	if in.FullName == "" || in.Subject == "" || in.Message == "" {
		writeError(w, http.StatusBadRequest, "Please complete all contact fields.")
		return
	}

	if remaining := a.submissionCooldownRemaining(r, "contact"); remaining > 0 {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{
			"error":       "Please wait before sending another message.",
			"retry_after": remaining,
		})
		return
	}
	if !a.allow(r, "contact", 5, 10*time.Minute) {
		writeError(w, http.StatusTooManyRequests, "Too many messages. Please try again later.")
		return
	}

	if _, err := a.db.Exec(`INSERT INTO contact_messages(full_name,email,profile_url,subject,message) VALUES(?,?,?,?,?)`, in.FullName, email, identity.ProfileURL, in.Subject, in.Message); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to save your message.")
		return
	}

	a.markSubmissionCooldown(r, "contact", 30*time.Second)
	writeJSON(w, http.StatusCreated, map[string]any{
		"message":          "Message sent successfully.",
		"cooldown_seconds": 30,
	})
}

func (a *app) submissionCooldownRemaining(r *http.Request, bucket string) int {
	key := bucket + "-cooldown|" + clientIP(r)
	now := time.Now()

	a.mu.Lock()
	defer a.mu.Unlock()

	state, ok := a.rateLimiter[key]
	if !ok || now.After(state.ResetAt) {
		if ok {
			delete(a.rateLimiter, key)
		}
		return 0
	}

	remainingDuration := time.Until(state.ResetAt)
	remaining := int(remainingDuration.Seconds())
	if remainingDuration%time.Second != 0 {
		remaining++
	}
	if remaining < 1 {
		return 1
	}
	return remaining
}

func (a *app) markSubmissionCooldown(r *http.Request, bucket string, duration time.Duration) {
	key := bucket + "-cooldown|" + clientIP(r)
	a.mu.Lock()
	a.rateLimiter[key] = &rateState{Count: 1, ResetAt: time.Now().Add(duration)}
	a.mu.Unlock()
}

func (a *app) allow(r *http.Request, bucket string, limit int, window time.Duration) bool {
	key := bucket + "|" + clientIP(r)
	now := time.Now()
	a.mu.Lock()
	defer a.mu.Unlock()
	state, ok := a.rateLimiter[key]
	if !ok || now.After(state.ResetAt) {
		a.rateLimiter[key] = &rateState{Count: 1, ResetAt: now.Add(window)}
		return true
	}
	if state.Count >= limit {
		return false
	}
	state.Count++
	return true
}

func generateChallengeKey(length int) (string, error) {
	const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ"
	const lowercase = "abcdefghijkmnopqrstuvwxyz"
	const numbers = "23456789"
	const specials = "!@#$%&*_-+=?"
	const all = uppercase + lowercase + numbers + specials
	if length < 4 {
		return "", errors.New("challenge length too short")
	}
	b := make([]byte, length)
	sets := []string{uppercase, lowercase, numbers, specials}
	for i, set := range sets {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(set))))
		if err != nil {
			return "", err
		}
		b[i] = set[n.Int64()]
	}
	for i := len(sets); i < length; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(all))))
		if err != nil {
			return "", err
		}
		b[i] = all[n.Int64()]
	}
	for i := len(b) - 1; i > 0; i-- {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(i+1)))
		if err != nil {
			return "", err
		}
		j := int(n.Int64())
		b[i], b[j] = b[j], b[i]
	}
	return string(b), nil
}

func numericCode(length int) (string, error) {
	var b strings.Builder
	for i := 0; i < length; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", err
		}
		b.WriteByte(byte('0' + n.Int64()))
	}
	return b.String(), nil
}

func randomToken(size int) (string, error) {
	b := make([]byte, size)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func safePublicURL(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	parsed, err := neturl.Parse(value)
	if err != nil {
		return false
	}
	if (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || parsed.User != nil || strings.ContainsAny(value, "\r\n") {
		return false
	}

	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".local") {
		return false
	}
	if ip, err := netip.ParseAddr(host); err == nil && !allowedIP(ip) {
		return false
	}
	return true
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func clean(s string, max int) string {
	s = strings.TrimSpace(strings.Join(strings.Fields(s), " "))
	if text := []rune(s); len(text) > max {
		s = string(text[:max])
	}
	return s
}

func validEmail(s string) bool {
	return len(s) <= 254 && regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`).MatchString(s)
}

func contains(items []string, value string) bool {
	for _, item := range items {
		if item == value {
			return true
		}
	}
	return false
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer := net.ParseIP(host)
	// cloudflared is local; never trust forwarded headers from arbitrary remote clients.
	if peer != nil && peer.IsLoopback() && env("TRUST_PROXY", "false") == "true" {
		if ip := net.ParseIP(r.Header.Get("CF-Connecting-IP")); ip != nil {
			return ip.String()
		}
		if ip := net.ParseIP(strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0])); ip != nil {
			return ip.String()
		}
	}
	return host
}

func (a *app) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		// Health polling is expected background traffic; keep the console focused on real actions.
		if r.URL.Path != "/api/health" {
			log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
		}
	})
}

func isHTTPS(r *http.Request, origin string) bool {
	return r.TLS != nil || strings.HasPrefix(origin, "https://")
}
