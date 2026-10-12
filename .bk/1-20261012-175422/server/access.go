package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	accessChallengeLifetime = time.Minute
	accessRequestLifetime   = 15 * time.Minute
	accessRequestCooldown   = 15 * time.Minute
	accessRateWindow        = 2 * time.Hour
	accessRateLimit         = 5
	adminSessionLifetime    = 12 * time.Hour
	pendingAccessCookie     = "jp_access_pending"
	adminSessionCookie      = "jp_admin"
)

type accessManager struct {
	mu          sync.Mutex
	challenges  map[string]accessChallengeState
	subscribers map[string]map[chan string]struct{}
}

type accessChallengeState struct {
	Value     string
	IP        string
	ExpiresAt time.Time
}

type deviceInfo struct {
	UserAgent           string  `json:"user_agent"`
	Platform            string  `json:"platform"`
	Language            string  `json:"language"`
	Languages           string  `json:"languages"`
	Timezone            string  `json:"timezone"`
	ScreenWidth         int     `json:"screen_width"`
	ScreenHeight        int     `json:"screen_height"`
	ColorDepth          int     `json:"color_depth"`
	HardwareConcurrency int     `json:"hardware_concurrency"`
	DeviceMemory        float64 `json:"device_memory"`
	TouchPoints         int     `json:"touch_points"`
}

type accessRequestRow struct {
	ID                string
	BrowserSecretHash string
	Status            string
	WrongAttempts     int
	IPAddress         string
	FingerprintHash   string
	DeviceJSON        string
	ExpiresAt         time.Time
}

type accessEmailContext struct {
	RequestID       string
	RequestedAt     time.Time
	IPAddress       string
	FingerprintHash string
	UserAgent       string
	Device          deviceInfo
}

func newAccessManager() *accessManager {
	return &accessManager{
		challenges:  make(map[string]accessChallengeState),
		subscribers: make(map[string]map[chan string]struct{}),
	}
}

func loadAccessSecret() ([]byte, error) {
	value := strings.TrimSpace(os.Getenv("ACCESS_SECRET"))
	if value != "" {
		if len(value) < 32 {
			return nil, errors.New("ACCESS_SECRET must be at least 32 characters")
		}
		return []byte(value), nil
	}

	generated := make([]byte, 32)
	if _, err := rand.Read(generated); err != nil {
		return nil, fmt.Errorf("generate access secret: %w", err)
	}
	log.Printf("ACCESS_SECRET is not configured; pending access verification will reset if the server restarts")
	return []byte(hex.EncodeToString(generated)), nil
}

func (a *app) accessChallenge(w http.ResponseWriter, r *http.Request) {
	if !a.allow(r, "access-challenge", 120, time.Hour) {
		writeError(w, http.StatusTooManyRequests, "Too many challenge refreshes. Please try again later.")
		return
	}

	key, err := generateChallengeKey(12)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to create a challenge.")
		return
	}
	id, err := randomToken(18)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to create a challenge.")
		return
	}

	now := time.Now()
	expires := now.Add(accessChallengeLifetime)
	a.access.mu.Lock()
	for existingID, challenge := range a.access.challenges {
		if now.After(challenge.ExpiresAt) {
			delete(a.access.challenges, existingID)
		}
	}
	a.access.challenges[id] = accessChallengeState{Value: key, IP: clientIP(r), ExpiresAt: expires}
	a.access.mu.Unlock()

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"challenge_id": id,
		"challenge":    key,
		"expires_at":   expires,
		"expires_in":   int(accessChallengeLifetime.Seconds()),
	})
}

func (a *app) accessRequest(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ChallengeID string     `json:"challenge_id"`
		Key         string     `json:"key"`
		Device      deviceInfo `json:"device"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid access request.")
		return
	}

	if !a.consumeChallenge(in.ChallengeID, in.Key, clientIP(r)) {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error":           "The challenge is incorrect or expired.",
			"reset_challenge": true,
		})
		return
	}

	recipient := firstNonEmpty(a.smtpTo, a.smtpUser)
	if a.smtpUser == "" || a.smtpPass == "" || recipient == "" {
		writeError(w, http.StatusServiceUnavailable, "Email verification is not configured.")
		return
	}

	in.Device = sanitizeDeviceInfo(in.Device)
	ip := clientIP(r)
	fingerprint := a.deviceFingerprint(r, in.Device)
	now := time.Now()
	a.expireAccessRequests(now)

	if retry, queued := a.pendingAccessRetry(fingerprint, now); queued {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":       "An access request is already waiting for verification.",
			"retry_after": retry,
		})
		return
	}
	if retry := a.accessCooldownRemaining(ip, fingerprint, now); retry > 0 {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{
			"error":       "Please wait before requesting another verification email.",
			"retry_after": retry,
		})
		return
	}
	if retry, limited := a.accessWindowLimited(ip, fingerprint, now); limited {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{
			"error":       "Access email limit reached. Maximum 5 requests are allowed every 2 hours.",
			"retry_after": retry,
		})
		return
	}

	requestID, err := randomToken(18)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to create the access request.")
		return
	}
	browserSecret, err := randomToken(32)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to create the access request.")
		return
	}
	grantToken, err := randomToken(32)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to create the access request.")
		return
	}
	otp, err := numericCode(6)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to create the verification code.")
		return
	}

	expires := now.Add(accessRequestLifetime)
	deviceJSON, _ := json.Marshal(in.Device)
	browserHash := tokenHash(browserSecret)
	grantHash := tokenHash(grantToken)
	otpHash := a.secretDigest(requestID, otp)

	_, err = a.db.Exec(`INSERT INTO access_requests(
		id, browser_secret_hash, grant_token_hash, otp_hash, status, wrong_attempts,
		ip_address, fingerprint_hash, device_json, created_at, expires_at, updated_at
	) VALUES(?,?,?,?, 'pending',0,?,?,?,?,?,?)`,
		requestID, browserHash, grantHash, otpHash,
		ip, fingerprint, string(deviceJSON), now, expires, now,
	)
	if err != nil {
		log.Printf("access request insert: %v", err)
		writeError(w, http.StatusInternalServerError, "Unable to create the access request.")
		return
	}

	a.setPendingAccessCookie(w, r, browserSecret, expires)
	grantURL := a.appURL + "/access/grant#token=" + grantToken
	mailContext := accessEmailContext{
		RequestID:       requestID,
		RequestedAt:     now,
		IPAddress:       ip,
		FingerprintHash: fingerprint,
		UserAgent:       r.UserAgent(),
		Device:          in.Device,
	}
	if err := a.sendAccessEmail(otp, grantURL, mailContext); err != nil {
		_, _ = a.db.Exec(`DELETE FROM access_requests WHERE id=?`, requestID)
		a.clearPendingAccessCookie(w, r)
		log.Printf("access SMTP error: %v", err)
		writeError(w, http.StatusBadGateway, "The verification email could not be sent.")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"message":     "Verification email sent.",
		"request_id":  requestID,
		"expires_at":  expires,
		"expires_in":  int(accessRequestLifetime.Seconds()),
		"destination": maskEmail(recipient),
	})
}

func (a *app) accessOTP(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RequestID string `json:"request_id"`
		OTP       string `json:"otp"`
	}
	if err := decodeJSON(r, &in); err != nil || strings.TrimSpace(in.RequestID) == "" {
		writeError(w, http.StatusBadRequest, "Invalid verification request.")
		return
	}
	otp := strings.TrimSpace(in.OTP)
	if len(otp) != 6 {
		writeError(w, http.StatusBadRequest, "Enter the 6-digit verification code.")
		return
	}

	row, ok := a.loadAccessRequest(in.RequestID)
	if !ok || !a.pendingCookieMatches(r, row.BrowserSecretHash) {
		writeError(w, http.StatusUnauthorized, "This verification request does not belong to this browser.")
		return
	}
	if time.Now().After(row.ExpiresAt) || row.Status == "expired" || row.Status == "failed" {
		a.expireRequest(in.RequestID)
		a.clearPendingAccessCookie(w, r)
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error":           "The verification request has expired. Start a new challenge.",
			"reset_challenge": true,
		})
		return
	}
	if row.Status == "granted" {
		if err := a.completeAccessRequest(w, r, row); err != nil {
			log.Printf("complete granted access: %v", err)
			writeError(w, http.StatusInternalServerError, "Unable to create the management session.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"message": "Access granted.", "redirect": "/admin"})
		return
	}
	if row.Status != "pending" {
		writeError(w, http.StatusUnauthorized, "This verification request is no longer active.")
		return
	}

	expected := a.secretDigest(row.ID, otp)
	storedOTPHash := ""
	if err := a.db.QueryRow(`SELECT otp_hash FROM access_requests WHERE id=?`, row.ID).Scan(&storedOTPHash); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to verify the code.")
		return
	}
	if subtle.ConstantTimeCompare([]byte(expected), []byte(storedOTPHash)) != 1 {
		attempts := row.WrongAttempts + 1
		if attempts >= 5 {
			_, _ = a.db.Exec(`UPDATE access_requests SET wrong_attempts=?, status='failed', updated_at=? WHERE id=?`, attempts, time.Now(), row.ID)
			a.clearPendingAccessCookie(w, r)
			a.access.notify(row.ID, "reset")
			writeJSON(w, http.StatusUnauthorized, map[string]any{
				"error":              "Too many incorrect OTP attempts. The challenge has been reset.",
				"attempts_remaining": 0,
				"reset_challenge":    true,
			})
			return
		}
		_, _ = a.db.Exec(`UPDATE access_requests SET wrong_attempts=?, updated_at=? WHERE id=?`, attempts, time.Now(), row.ID)
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error":              "Incorrect verification code.",
			"attempts_remaining": 5 - attempts,
		})
		return
	}

	if err := a.completeAccessRequest(w, r, row); err != nil {
		log.Printf("complete OTP access: %v", err)
		writeError(w, http.StatusInternalServerError, "Unable to create the management session.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Access granted.", "redirect": "/admin"})
}

func (a *app) accessGrant(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token string `json:"token"`
	}
	if err := decodeJSON(r, &in); err != nil || strings.TrimSpace(in.Token) == "" {
		writeError(w, http.StatusBadRequest, "Invalid grant token.")
		return
	}
	grantHash := tokenHash(strings.TrimSpace(in.Token))

	var requestID, status string
	var expires time.Time
	err := a.db.QueryRow(`SELECT id, status, expires_at FROM access_requests WHERE grant_token_hash=?`, grantHash).Scan(&requestID, &status, &expires)
	if err != nil || time.Now().After(expires) || status == "expired" || status == "failed" {
		writeError(w, http.StatusUnauthorized, "This grant link is invalid or expired.")
		return
	}
	if status == "completed" {
		writeJSON(w, http.StatusOK, map[string]any{"message": "This access request has already been completed.", "request_id": requestID, "already_completed": true})
		return
	}
	if status != "pending" {
		writeError(w, http.StatusUnauthorized, "This one-time grant link has already been used.")
		return
	}
	now := time.Now()
	usedGrantHash := "used:" + grantHash
	result, err := a.db.Exec(`UPDATE access_requests SET status='granted', grant_token_hash=?, granted_at=?, updated_at=? WHERE id=? AND status='pending' AND grant_token_hash=?`, usedGrantHash, now, now, requestID, grantHash)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to grant access.")
		return
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		writeError(w, http.StatusUnauthorized, "This one-time grant link has already been used.")
		return
	}

	a.access.notify(requestID, "granted")
	writeJSON(w, http.StatusOK, map[string]any{
		"message":    "Access granted to the requesting browser.",
		"request_id": requestID,
	})
}

func (a *app) accessFinalize(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RequestID string `json:"request_id"`
	}
	if err := decodeJSON(r, &in); err != nil || strings.TrimSpace(in.RequestID) == "" {
		writeError(w, http.StatusBadRequest, "Invalid access request.")
		return
	}
	row, ok := a.loadAccessRequest(in.RequestID)
	if !ok || !a.pendingCookieMatches(r, row.BrowserSecretHash) {
		writeError(w, http.StatusUnauthorized, "This grant belongs to another browser.")
		return
	}
	if time.Now().After(row.ExpiresAt) {
		a.expireRequest(row.ID)
		a.clearPendingAccessCookie(w, r)
		writeError(w, http.StatusUnauthorized, "The access request has expired.")
		return
	}
	if row.Status != "granted" && row.Status != "completed" {
		writeError(w, http.StatusConflict, "The access request has not been granted yet.")
		return
	}
	if row.Status == "completed" {
		if a.isAdmin(r) {
			writeJSON(w, http.StatusOK, map[string]string{"message": "Access already active.", "redirect": "/admin"})
			return
		}
		writeError(w, http.StatusConflict, "This access grant has already been used.")
		return
	}

	if err := a.completeAccessRequest(w, r, row); err != nil {
		log.Printf("finalize granted access: %v", err)
		writeError(w, http.StatusInternalServerError, "Unable to create the management session.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Access granted.", "redirect": "/admin"})
}

func (a *app) accessEvents(w http.ResponseWriter, r *http.Request) {
	requestID := strings.TrimSpace(r.URL.Query().Get("request_id"))
	if requestID == "" {
		writeError(w, http.StatusBadRequest, "Missing access request.")
		return
	}
	row, ok := a.loadAccessRequest(requestID)
	if !ok || !a.pendingCookieMatches(r, row.BrowserSecretHash) {
		writeError(w, http.StatusUnauthorized, "This access request does not belong to this browser.")
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "Live access updates are unavailable.")
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	sendSSE := func(event string, payload any) bool {
		data, _ := json.Marshal(payload)
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	if row.Status == "granted" {
		sendSSE("granted", map[string]string{"request_id": row.ID})
		return
	}
	if row.Status != "pending" || time.Now().After(row.ExpiresAt) {
		sendSSE("expired", map[string]string{"request_id": row.ID})
		return
	}
	if !sendSSE("state", map[string]any{"status": "pending", "expires_at": row.ExpiresAt}) {
		return
	}

	ch := a.access.subscribe(row.ID)
	defer a.access.unsubscribe(row.ID, ch)
	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case event := <-ch:
			switch event {
			case "granted":
				sendSSE("granted", map[string]string{"request_id": row.ID})
				return
			case "reset":
				sendSSE("reset", map[string]string{"request_id": row.ID})
				return
			}
		case <-heartbeat.C:
			if time.Now().After(row.ExpiresAt) {
				a.expireRequest(row.ID)
				sendSSE("expired", map[string]string{"request_id": row.ID})
				return
			}
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func (a *app) accessPendingStatus(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(pendingAccessCookie)
	if err != nil || cookie.Value == "" {
		writeJSON(w, http.StatusOK, map[string]any{"active": false})
		return
	}
	browserHash := tokenHash(cookie.Value)
	var requestID, status string
	var expires time.Time
	err = a.db.QueryRow(`SELECT id, status, expires_at FROM access_requests WHERE browser_secret_hash=? AND status IN ('pending','granted') ORDER BY created_at DESC LIMIT 1`, browserHash).Scan(&requestID, &status, &expires)
	if err != nil || time.Now().After(expires) {
		writeJSON(w, http.StatusOK, map[string]any{"active": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"active":      true,
		"request_id":  requestID,
		"status":      status,
		"expires_at":  expires,
		"destination": maskEmail(firstNonEmpty(a.smtpTo, a.smtpUser)),
	})
}

func (a *app) accessSessionStatus(w http.ResponseWriter, r *http.Request) {
	valid, expires := a.adminSessionInfo(r)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"authorized": valid,
		"expires_at": expires,
	})
}

func (a *app) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.isAdmin(r) {
			writeError(w, http.StatusUnauthorized, "Admin access required.")
			return
		}
		next(w, r)
	}
}

func (a *app) adminLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(adminSessionCookie); err == nil && cookie.Value != "" {
		hash := tokenHash(cookie.Value)
		_, _ = a.db.Exec(`UPDATE admin_sessions SET revoked_at=?, updated_at=? WHERE token_hash=? AND revoked_at IS NULL`, time.Now(), time.Now(), hash)
	}
	a.clearAdminCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]string{"message": "Session ended."})
}

func (a *app) isAdmin(r *http.Request) bool {
	valid, _ := a.adminSessionInfo(r)
	return valid
}

func (a *app) adminSessionInfo(r *http.Request) (bool, *time.Time) {
	cookie, err := r.Cookie(adminSessionCookie)
	if err != nil || cookie.Value == "" {
		return false, nil
	}
	hash := tokenHash(cookie.Value)
	var expires time.Time
	err = a.db.QueryRow(`SELECT expires_at FROM admin_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?`, hash, time.Now()).Scan(&expires)
	if err != nil {
		return false, nil
	}
	return true, &expires
}

func (a *app) completeAccessRequest(w http.ResponseWriter, r *http.Request, row accessRequestRow) error {
	raw, err := randomToken(32)
	if err != nil {
		return err
	}
	now := time.Now()
	expires := now.Add(adminSessionLifetime)

	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	result, err := tx.Exec(`UPDATE access_requests SET status='completed', grant_token_hash='invalidated:' || grant_token_hash, completed_at=?, updated_at=? WHERE id=? AND status IN ('pending','granted')`, now, now, row.ID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil || affected != 1 {
		return errors.New("access request was already completed")
	}
	if _, err := tx.Exec(`INSERT INTO admin_sessions(token_hash, fingerprint_hash, ip_address, user_agent, expires_at, created_at, updated_at) VALUES(?,?,?,?,?,?,?)`,
		tokenHash(raw), row.FingerprintHash, clientIP(r), clean(r.UserAgent(), 500), expires, now, now); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}

	http.SetCookie(w, &http.Cookie{
		Name:     adminSessionCookie,
		Value:    raw,
		Path:     "/",
		Expires:  expires,
		MaxAge:   int(adminSessionLifetime.Seconds()),
		HttpOnly: true,
		Secure:   isHTTPS(r, a.apiURL),
		SameSite: sessionSameSite(),
	})
	a.clearPendingAccessCookie(w, r)
	a.access.notify(row.ID, "completed")
	return nil
}

func (a *app) clearAdminCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: adminSessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: isHTTPS(r, a.apiURL), SameSite: sessionSameSite()})
}

func (a *app) setPendingAccessCookie(w http.ResponseWriter, r *http.Request, raw string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     pendingAccessCookie,
		Value:    raw,
		Path:     "/",
		Expires:  expires,
		MaxAge:   int(time.Until(expires).Seconds()),
		HttpOnly: true,
		Secure:   isHTTPS(r, a.apiURL),
		SameSite: sessionSameSite(),
	})
}

func (a *app) clearPendingAccessCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: pendingAccessCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: isHTTPS(r, a.apiURL), SameSite: sessionSameSite()})
}

func (a *app) pendingCookieMatches(r *http.Request, expectedHash string) bool {
	cookie, err := r.Cookie(pendingAccessCookie)
	if err != nil || cookie.Value == "" {
		return false
	}
	actual := tokenHash(cookie.Value)
	return subtle.ConstantTimeCompare([]byte(actual), []byte(expectedHash)) == 1
}

func (a *app) consumeChallenge(id, value, ip string) bool {
	a.access.mu.Lock()
	defer a.access.mu.Unlock()
	challenge, ok := a.access.challenges[id]
	if ok {
		delete(a.access.challenges, id)
	}
	if !ok || time.Now().After(challenge.ExpiresAt) || challenge.IP != ip {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(challenge.Value), []byte(value)) == 1
}

func (a *app) loadAccessRequest(id string) (accessRequestRow, bool) {
	var row accessRequestRow
	err := a.db.QueryRow(`SELECT id, browser_secret_hash, status, wrong_attempts, ip_address, fingerprint_hash, device_json, expires_at FROM access_requests WHERE id=?`, id).
		Scan(&row.ID, &row.BrowserSecretHash, &row.Status, &row.WrongAttempts, &row.IPAddress, &row.FingerprintHash, &row.DeviceJSON, &row.ExpiresAt)
	return row, err == nil
}

func (a *app) expireAccessRequests(now time.Time) {
	_, _ = a.db.Exec(`UPDATE access_requests SET status='expired', updated_at=? WHERE status IN ('pending','granted') AND expires_at < ?`, now, now)
}

func (a *app) expireRequest(id string) {
	now := time.Now()
	_, _ = a.db.Exec(`UPDATE access_requests SET status='expired', updated_at=? WHERE id=? AND status IN ('pending','granted')`, now, id)
	a.access.notify(id, "expired")
}

func (a *app) pendingAccessRetry(fingerprint string, now time.Time) (int, bool) {
	var expires time.Time
	err := a.db.QueryRow(`SELECT expires_at FROM access_requests WHERE fingerprint_hash=? AND status IN ('pending','granted') AND expires_at>? ORDER BY created_at DESC LIMIT 1`, fingerprint, now).Scan(&expires)
	if err != nil {
		return 0, false
	}
	return secondsUntil(expires), true
}

func (a *app) accessCooldownRemaining(ip, fingerprint string, now time.Time) int {
	var last time.Time
	err := a.db.QueryRow(`SELECT created_at FROM access_requests WHERE (ip_address=? OR fingerprint_hash=?) ORDER BY created_at DESC LIMIT 1`, ip, fingerprint).Scan(&last)
	if err != nil {
		return 0
	}
	next := last.Add(accessRequestCooldown)
	if now.Before(next) {
		return secondsUntil(next)
	}
	return 0
}

func (a *app) accessWindowLimited(ip, fingerprint string, now time.Time) (int, bool) {
	windowStart := now.Add(-accessRateWindow)
	var count int
	if err := a.db.QueryRow(`SELECT COUNT(*) FROM access_requests WHERE (ip_address=? OR fingerprint_hash=?) AND created_at>=?`, ip, fingerprint, windowStart).Scan(&count); err != nil || count < accessRateLimit {
		return 0, false
	}
	var oldest time.Time
	if err := a.db.QueryRow(`SELECT created_at FROM access_requests WHERE (ip_address=? OR fingerprint_hash=?) AND created_at>=? ORDER BY created_at ASC LIMIT 1`, ip, fingerprint, windowStart).Scan(&oldest); err != nil {
		return int(accessRateWindow.Seconds()), true
	}
	return secondsUntil(oldest.Add(accessRateWindow)), true
}

func (a *app) deviceFingerprint(r *http.Request, device deviceInfo) string {
	payload := strings.Join([]string{
		clean(r.UserAgent(), 500), device.Platform, device.Language, device.Languages, device.Timezone,
		strconv.Itoa(device.ScreenWidth), strconv.Itoa(device.ScreenHeight), strconv.Itoa(device.ColorDepth),
		strconv.Itoa(device.HardwareConcurrency), fmt.Sprintf("%.1f", device.DeviceMemory), strconv.Itoa(device.TouchPoints),
	}, "|")
	return a.secretDigest("fingerprint", payload)
}

func sanitizeDeviceInfo(d deviceInfo) deviceInfo {
	d.UserAgent = clean(d.UserAgent, 500)
	d.Platform = clean(d.Platform, 80)
	d.Language = clean(d.Language, 40)
	d.Languages = clean(d.Languages, 180)
	d.Timezone = clean(d.Timezone, 80)
	if d.ScreenWidth < 0 || d.ScreenWidth > 20000 {
		d.ScreenWidth = 0
	}
	if d.ScreenHeight < 0 || d.ScreenHeight > 20000 {
		d.ScreenHeight = 0
	}
	if d.ColorDepth < 0 || d.ColorDepth > 128 {
		d.ColorDepth = 0
	}
	if d.HardwareConcurrency < 0 || d.HardwareConcurrency > 1024 {
		d.HardwareConcurrency = 0
	}
	if d.DeviceMemory < 0 || d.DeviceMemory > 1024 {
		d.DeviceMemory = 0
	}
	if d.TouchPoints < 0 || d.TouchPoints > 128 {
		d.TouchPoints = 0
	}
	return d
}

func (a *app) secretDigest(parts ...string) string {
	mac := hmac.New(sha256.New, a.accessSecret)
	for i, part := range parts {
		if i > 0 {
			mac.Write([]byte{0})
		}
		mac.Write([]byte(part))
	}
	return hex.EncodeToString(mac.Sum(nil))
}

func tokenHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func secondsUntil(t time.Time) int {
	seconds := int(time.Until(t).Seconds())
	if time.Until(t)%time.Second != 0 {
		seconds++
	}
	if seconds < 1 {
		return 1
	}
	return seconds
}

func maskEmail(value string) string {
	local, domain, ok := strings.Cut(strings.TrimSpace(value), "@")
	if !ok || local == "" {
		return "configured email"
	}
	visible := local[:1]
	if len(local) > 2 {
		visible += strings.Repeat("•", min(5, len(local)-1))
	}
	return visible + "@" + domain
}

func (a *accessManager) subscribe(requestID string) chan string {
	ch := make(chan string, 2)
	a.mu.Lock()
	if a.subscribers[requestID] == nil {
		a.subscribers[requestID] = make(map[chan string]struct{})
	}
	a.subscribers[requestID][ch] = struct{}{}
	a.mu.Unlock()
	return ch
}

func (a *accessManager) unsubscribe(requestID string, ch chan string) {
	a.mu.Lock()
	if group := a.subscribers[requestID]; group != nil {
		delete(group, ch)
		if len(group) == 0 {
			delete(a.subscribers, requestID)
		}
	}
	a.mu.Unlock()
}

func (a *accessManager) notify(requestID, event string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for ch := range a.subscribers[requestID] {
		select {
		case ch <- event:
		default:
		}
	}
}

func (a *app) sendAccessEmail(otp, grantURL string, ctx accessEmailContext) error {
	recipient := firstNonEmpty(a.smtpTo, a.smtpUser)
	requestedAt := ctx.RequestedAt
	if ctx.Device.Timezone != "" {
		if location, err := time.LoadLocation(ctx.Device.Timezone); err == nil {
			requestedAt = requestedAt.In(location)
		}
	}

	deviceLabel := firstNonEmpty(ctx.Device.Platform, "Unknown platform")
	screen := "Unknown"
	if ctx.Device.ScreenWidth > 0 && ctx.Device.ScreenHeight > 0 {
		screen = fmt.Sprintf("%d × %d", ctx.Device.ScreenWidth, ctx.Device.ScreenHeight)
	}
	fingerprint := ctx.FingerprintHash
	if len(fingerprint) > 20 {
		fingerprint = fingerprint[:20]
	}
	browser := firstNonEmpty(ctx.UserAgent, ctx.Device.UserAgent, "Unknown browser")
	timezone := firstNonEmpty(ctx.Device.Timezone, "Unknown timezone")
	language := firstNonEmpty(ctx.Device.Language, "Unknown language")

	body := fmt.Sprintf(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0!important;padding:0!important;background:#f7f8fa;color:#172033;font-family:Arial,Helvetica,sans-serif}
table{border-spacing:0;border-collapse:collapse}.email-bg{background:#f7f8fa}.card{background:#ffffff;border:1px solid #e0e5eb}.brandbar{background:#172033;color:#f0f4f8}.copy{color:#526071}.muted{color:#758195}.otpbox{background:#f0f3f6;border:1px solid #e0e5eb}.securitybox{background:#fbfcfd;border:1px solid #e0e5eb}.security-row{border-bottom:1px solid #e0e5eb}.warning{background:#fff7e8;color:#77571a}.button-cell{background:#16a34a}.button-link{color:#ffffff!important}.accent{color:#16a34a}
@media only screen and (max-width:620px){.outer-pad{padding:0!important}.card{border-left:0!important;border-right:0!important;border-radius:0!important}.pad{padding:20px 18px!important}.headline{font-size:24px!important;line-height:30px!important}.otp{font-size:30px!important;line-height:38px!important;letter-spacing:6px!important}.button-cell{display:block!important;width:100%%!important}.button-link{display:block!important;text-align:center!important}.security-value{word-break:break-word!important}.mobile-full{width:100%%!important}}
@media (prefers-color-scheme:dark){body,.email-bg{background:#0b0f14!important;color:#f0f4f8!important}.card{background:#121820!important;border-color:#26313d!important}.brandbar{background:#10161d!important}.copy{color:#b2becd!important}.muted{color:#8290a2!important}.otpbox{background:#18202a!important;border-color:#26313d!important}.securitybox{background:#10161d!important;border-color:#26313d!important}.security-row{border-color:#26313d!important}.warning{background:#2d2515!important;color:#e9cd8b!important}.button-cell{background:#4ade80!important}.button-link{color:#07130c!important}.accent{color:#73e89a!important}}
[data-ogsc] .email-bg{background:#0b0f14!important}[data-ogsc] .card{background:#121820!important;border-color:#26313d!important}[data-ogsc] .copy{color:#b2becd!important}[data-ogsc] .muted{color:#8290a2!important}[data-ogsc] .otpbox{background:#18202a!important;border-color:#26313d!important}[data-ogsc] .securitybox{background:#10161d!important;border-color:#26313d!important}[data-ogsc] .security-row{border-color:#26313d!important}[data-ogsc] .warning{background:#2d2515!important;color:#e9cd8b!important}
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Your JPano.dev management access code is %s.</div>
<table role="presentation" width="100%%" class="email-bg" style="width:100%%;background:#f7f8fa"><tr><td align="center" class="outer-pad" style="padding:24px 12px">
<table role="presentation" width="100%%" class="card mobile-full" style="width:100%%;max-width:620px;background:#ffffff;border:1px solid #e0e5eb;border-radius:20px;overflow:hidden">
<tr><td class="brandbar pad" style="padding:22px 24px;background:#172033;color:#f0f4f8"><div style="font-size:22px;line-height:28px;font-weight:800">JPano<span style="color:#4ade80">.dev</span></div><div style="margin-top:4px;color:#b2becd;font-size:12px;line-height:18px">Portfolio Management Security</div></td></tr>
<tr><td class="pad" style="padding:26px 24px">
<div class="accent" style="color:#16a34a;font-size:11px;line-height:16px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase">Access request</div>
<h1 class="headline" style="margin:10px 0 8px;color:inherit;font-size:28px;line-height:34px">Confirm this management session.</h1>
<p class="copy" style="margin:0;color:#526071;font-size:14px;line-height:22px">A browser completed the JPano.dev access challenge. Enter the six-digit code in the waiting browser, or approve that same browser with the one-time button below.</p>

<table role="presentation" width="100%%" class="otpbox" style="width:100%%;margin-top:20px;background:#f0f3f6;border:1px solid #e0e5eb;border-radius:14px"><tr><td align="center" style="padding:18px 12px"><div class="muted" style="color:#758195;font-size:10px;line-height:15px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase">One-time password</div><div class="otp" style="margin-top:6px;color:inherit;font-family:Consolas,Monaco,monospace;font-size:34px;line-height:42px;font-weight:800;letter-spacing:8px;white-space:nowrap">%s</div></td></tr></table>

<table role="presentation" style="margin-top:18px"><tr><td class="button-cell" style="background:#16a34a;border-radius:11px"><a class="button-link" href="%s" style="display:inline-block;padding:13px 18px;color:#ffffff;text-decoration:none;font-size:13px;line-height:18px;font-weight:800">Grant Access</a></td></tr></table>
<p class="muted" style="margin:9px 0 0;color:#758195;font-size:11px;line-height:17px">The button grants only the original waiting browser. It does not create a reusable login link.</p>

<div style="margin-top:24px;padding-top:18px;border-top:1px solid #e0e5eb"><div style="margin-bottom:10px;font-size:13px;line-height:18px;font-weight:800">Request fingerprint</div>
<table role="presentation" width="100%%" class="securitybox" style="width:100%%;background:#fbfcfd;border:1px solid #e0e5eb;border-radius:12px;overflow:hidden">
%s
</table>
</div>
</td></tr>
<tr><td class="pad" style="padding:0 24px 24px"><div class="warning" style="padding:12px 14px;background:#fff7e8;color:#77571a;border-radius:12px;font-size:11px;line-height:18px">This request expires in 15 minutes. If you did not initiate it, do not enter the OTP and do not use Grant Access.</div></td></tr>
</table>
</td></tr></table>
</body>
</html>`,
		emailHTMLText(otp),
		emailHTMLText(otp),
		emailHTMLText(grantURL),
		strings.Join([]string{
			accessEmailDetailRow("Requested", requestedAt.Format("Jan 2, 2006 · 3:04:05 PM MST")),
			accessEmailDetailRow("IP address", ctx.IPAddress),
			accessEmailDetailRow("Device / platform", deviceLabel),
			accessEmailDetailRow("Browser / user agent", browser),
			accessEmailDetailRow("Timezone / language", timezone+" · "+language),
			accessEmailDetailRow("Screen", screen),
			accessEmailDetailRow("Device fingerprint", fingerprint),
			accessEmailDetailRow("Request ID", ctx.RequestID),
		}, ""),
	)

	return a.sendHTMLEmail(recipient, "JPano.dev Management Access", body)
}

func accessEmailDetailRow(label, value string) string {
	return fmt.Sprintf(`<tr><td class="security-row" style="padding:10px 12px;border-bottom:1px solid #e0e5eb"><div class="muted" style="color:#758195;font-size:9px;line-height:14px;font-weight:800;letter-spacing:1px;text-transform:uppercase">%s</div><div class="security-value" style="margin-top:2px;color:inherit;font-size:12px;line-height:18px;word-break:break-word">%s</div></td></tr>`, emailHTMLText(label), emailHTMLText(value))
}
