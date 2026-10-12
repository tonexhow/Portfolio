package application

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
	db              *database.DB
	clientDir       string
	appURL          string
	apiURL          string
	origins         map[string]bool
	settings        config.Settings
	mediaStore      *mediastore.Client
	databaseFailure string
	chat            *chatHub

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

func Run() { RunWithStop(nil) }

// RunWithStop uses the same graceful shutdown path for console signals and
// for a verified Windows stop.exe event; Go remains usable via `go run .`.
func RunWithStop(externalStop <-chan struct{}) {
	settings, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	closeRuntimeLog := configureRuntimeLog(settings.Root, settings.ClientDir)
	defer closeRuntimeLog()
	// Register early so stop.exe can end a slow startup or interrupted DB check.
	removePID := writeRuntimePID(settings.Root)
	defer removePID()
	var db *database.DB
	dbFailure := "not_configured"
	// The direct endpoint normally resolves to IPv6. A Supabase Session Pooler
	// URI can be used on IPv4-only networks or configured on its own. Do not
	// construct or guess a pooler host from a project reference.
	primaryURL := strings.TrimSpace(settings.DatabaseURL)
	poolerURL := strings.TrimSpace(os.Getenv("DATABASE_POOLER_URL"))
	candidates := make([]string, 0, 2)
	if primaryURL != "" {
		candidates = append(candidates, primaryURL)
	}
	if poolerURL != "" && poolerURL != primaryURL {
		candidates = append(candidates, poolerURL)
	}
	if len(candidates) > 0 {
		var lastError error
		for i, connectionURL := range candidates {
			candidate, connectErr := database.Open(connectionURL)
			if connectErr != nil {
				lastError = connectErr
				// Never log or return credentials, hosts or private URLs.
				log.Printf("Database connection option %d unavailable (reason=%s).", i+1, databaseFailureCode(connectErr))
				continue
			}
			db = candidate
			settings.DatabaseURL = connectionURL
			if i > 0 {
				log.Print("Database connected using the configured alternate connection option.")
			}
			break
		}
		if db != nil {
			var aligned bool
			aligned, err = database.Ensure(db, settings.Root,
				false, strings.EqualFold(env("DB_AUTO_MIGRATE", "false"), "true"))
			if err == nil && aligned {
				log.Print("Reviewed schema.sql alignment applied; portfolio content was not seeded or reset.")
			} else if err == nil {
				log.Print("Database schema is compatible; no alignment necessary.")
			}
		} else {
			err = lastError
		}
		if err != nil {
			dbFailure = databaseFailureCode(err)
			if db != nil {
				_ = db.Close()
				db = nil
			}
			log.Printf("Database not ready (reason=%s). See server/docs/DATABASE_TROUBLESHOOTING.md.", dbFailure)
		}
	} else {
		log.Print("No database connection URL was supplied. The API can respond, but management features are unavailable.")
	}

	if db != nil {
		dbFailure = ""
		defer db.Close()
		database.CleanupExpiredAccess(db)
		// Remove only delivered AI email history older than 15 days. Unsent drafts stay available.
		// Cleanup also repeats in the hourly maintenance tick.
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
		var storageErr error
		if strings.EqualFold(env("STORAGE_AUTO_SETUP", "false"), "true") {
			storageErr = mediaStore.EnsureBucket(storageCtx)
		} else {
			storageErr = mediaStore.CheckBucket(storageCtx)
		}
		cancelStorage()
		if storageErr != nil {
			if strings.EqualFold(env("STORAGE_REQUIRED", "false"), "true") {
				log.Fatalf("Supabase Storage is required but unavailable: %v", storageErr)
			}
			log.Printf("Supabase Storage not ready; Go uses database image fallback until configured. No storage policy was changed: %v", storageErr)
			mediaStore = nil
		}
	}

	a := &app{
		db:              db,
		clientDir:       settings.ClientDir,
		appURL:          settings.FrontendOrigin,
		apiURL:          settings.APIOrigin,
		origins:         settings.Origins,
		settings:        settings,
		mediaStore:      mediaStore,
		databaseFailure: dbFailure,
		chat:            newChatHub(),
		smtpHost:        env("SMTP_HOST", "smtp.gmail.com"),
		smtpPort:        env("SMTP_PORT", "587"),
		smtpUser:        os.Getenv("SMTP_EMAIL"),
		smtpPass:        os.Getenv("SMTP_PASSWORD"),
		smtpTo:          os.Getenv("SMTP_TO"),
		accessSecret:    accessSecret,
		access:          newAccessManager(),
		rateLimiter:     make(map[string]*rateState),
	}

	if a.db != nil {
		go a.reconcilePendingPayments(context.Background())
	}

	mux := a.routes()
	server := &http.Server{
		Addr:              net.JoinHostPort(settings.Bind, settings.BackendPort),
		Handler:           a.crossOrigin(a.databaseReady(a.logRequests(mux))),
		ReadHeaderTimeout: 8 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      45 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if externalStop != nil {
		go func() {
			select {
			case <-externalStop:
				log.Print("Stop requested by local Windows shutdown tool")
				stop()
			case <-ctx.Done():
			}
		}()
	}
	go a.runProjectChecks(ctx)
	go a.cleanupAIReplyHistory()
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				a.cleanupChats()
				a.cleanupAIReplyHistory()
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
	log.Printf("Portfolio API listening on %s. Frontend origin: %s", server.Addr, a.appURL)
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func configureRuntimeLog(root, clientDir string) func() {
	if info, err := os.Stat(clientDir); err == nil && info.IsDir() {
		enableManagementLog(os.Stderr)
		return func() {}
	}
	dir := filepath.Join(root, "server", ".runtime")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return func() {}
	}
	f, err := os.OpenFile(filepath.Join(dir, "backend.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return func() {}
	}
	enableManagementLog(f)
	return func() { _ = f.Close() }
}

func writeRuntimePID(root string) func() {
	dir := filepath.Join(root, "server", ".runtime")
	if _, err := os.Stat(filepath.Join(root, "server", "go.mod")); os.IsNotExist(err) {
		// Keep compiled runtime metadata inside system/windows so that the
		// release does not create an unexpected source server/ directory.
		dir = filepath.Join(root, "system", "windows")
	}
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

	var feedbackID int64
	if err := a.db.QueryRow(`INSERT INTO feedback(display_name, rating, comment, auth_provider, auth_user_id, credential, profile_url) VALUES(?,?,?,?,?,?,?) RETURNING id`,
		identity.DisplayName, in.Rating, in.Comment, identity.Provider, identity.ProviderUserID, identity.Credential, identity.ProfileURL).Scan(&feedbackID); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to save feedback.")
		return
	}
	if feedbackID > 0 {
		go a.prepareAIReply("feedback", feedbackID, identity.DisplayName, identity.Credential, "Portfolio feedback", in.Comment)
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

	var contactID int64
	if err := a.db.QueryRow(`INSERT INTO contact_messages(full_name,email,profile_url,subject,message) VALUES(?,?,?,?,?) RETURNING id`, in.FullName, email, identity.ProfileURL, in.Subject, in.Message).Scan(&contactID); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to save your message.")
		return
	}

	if contactID > 0 {
		go a.prepareAIReply("contact", contactID, in.FullName, email, in.Subject, in.Message)
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
