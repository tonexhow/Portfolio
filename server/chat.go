package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const chatCookieName = "jp_chat"

type chatHub struct {
	mu       sync.RWMutex
	admins   map[*wsConn]struct{}
	visitors map[string]map[*wsConn]struct{}
}

func newChatHub() *chatHub {
	return &chatHub{admins: map[*wsConn]struct{}{}, visitors: map[string]map[*wsConn]struct{}{}}
}
func (h *chatHub) adminCount() int       { h.mu.RLock(); defer h.mu.RUnlock(); return len(h.admins) }
func (h *chatHub) addAdmin(c *wsConn)    { h.mu.Lock(); h.admins[c] = struct{}{}; h.mu.Unlock() }
func (h *chatHub) removeAdmin(c *wsConn) { h.mu.Lock(); delete(h.admins, c); h.mu.Unlock() }
func (h *chatHub) addVisitor(thread string, c *wsConn) {
	h.mu.Lock()
	if h.visitors[thread] == nil {
		h.visitors[thread] = map[*wsConn]struct{}{}
	}
	h.visitors[thread][c] = struct{}{}
	h.mu.Unlock()
}
func (h *chatHub) removeVisitor(thread string, c *wsConn) {
	h.mu.Lock()
	if m := h.visitors[thread]; m != nil {
		delete(m, c)
		if len(m) == 0 {
			delete(h.visitors, thread)
		}
	}
	h.mu.Unlock()
}
func (h *chatHub) sendAdmins(payload any) {
	data, _ := json.Marshal(payload)
	h.mu.RLock()
	list := make([]*wsConn, 0, len(h.admins))
	for c := range h.admins {
		list = append(list, c)
	}
	h.mu.RUnlock()
	for _, c := range list {
		if c.writeJSON(data) != nil {
			c.close()
			h.removeAdmin(c)
		}
	}
}
func (h *chatHub) sendThread(thread string, payload any) {
	data, _ := json.Marshal(payload)
	h.mu.RLock()
	m := h.visitors[thread]
	list := make([]*wsConn, 0, len(m))
	for c := range m {
		list = append(list, c)
	}
	h.mu.RUnlock()
	for _, c := range list {
		if c.writeJSON(data) != nil {
			c.close()
			h.removeVisitor(thread, c)
		}
	}
}
func (h *chatHub) announceAvailability(available bool) {
	h.mu.RLock()
	all := []*wsConn{}
	for _, m := range h.visitors {
		for c := range m {
			all = append(all, c)
		}
	}
	h.mu.RUnlock()
	data, _ := json.Marshal(map[string]any{"type": "availability", "available": available})
	for _, c := range all {
		_ = c.writeJSON(data)
	}
}

type chatMessage struct {
	ID        int64     `json:"id"`
	ThreadID  string    `json:"thread_id"`
	Sender    string    `json:"sender"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
}
type chatThread struct {
	ID                    string    `json:"id"`
	Status                string    `json:"status"`
	AdminUnread           int       `json:"admin_unread"`
	VisitorUnread         int       `json:"visitor_unread"`
	VisitorIP             string    `json:"visitor_ip"`
	VisitorIPHash         string    `json:"visitor_ip_hash"`
	VisitorUserAgent      string    `json:"visitor_user_agent"`
	VisitorAgent          string    `json:"visitor_agent"`
	VisitorPlatform       string    `json:"visitor_platform"`
	VisitorCountry        string    `json:"visitor_country"`
	VisitorReferrer       string    `json:"visitor_referrer"`
	VisitorFingerprint    string    `json:"visitor_fingerprint"`
	VisitorAuthProvider   string    `json:"visitor_auth_provider"`
	VisitorAuthName       string    `json:"visitor_auth_name"`
	VisitorAuthCredential string    `json:"visitor_auth_credential"`
	VisitorAvatarURL      string    `json:"visitor_avatar_url,omitempty"`
	LastMessage           string    `json:"last_message"`
	LastSender            string    `json:"last_sender"`
	LastMessageAt         time.Time `json:"last_message_at"`
	CreatedAt             time.Time `json:"created_at"`
}

type chatVisitorMeta struct {
	IP, IPHash, UserAgent, Agent, Platform, Country, Referrer, Fingerprint string
	AuthProvider, AuthName, AuthCredential, ProfileURL                     string
}

func requestClientIP(r *http.Request) string {
	if value := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); value != "" {
		if parsed := net.ParseIP(value); parsed != nil {
			return parsed.String()
		}
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && net.ParseIP(host) != nil {
		return net.ParseIP(host).String()
	}
	if parsed := net.ParseIP(strings.TrimSpace(r.RemoteAddr)); parsed != nil {
		return parsed.String()
	}
	return ""
}

func uaVersion(ua, marker string) string {
	i := strings.Index(ua, marker)
	if i < 0 {
		return ""
	}
	v := ua[i+len(marker):]
	if j := strings.IndexAny(v, " ;)"); j >= 0 {
		v = v[:j]
	}
	if parts := strings.Split(v, "."); len(parts) > 0 {
		return parts[0]
	}
	return v
}

func summarizeUserAgent(ua string) (string, string) {
	low := strings.ToLower(ua)
	agent := "Unknown browser"
	switch {
	case strings.Contains(ua, "Edg/"):
		agent = "Edge " + uaVersion(ua, "Edg/")
	case strings.Contains(ua, "OPR/"):
		agent = "Opera " + uaVersion(ua, "OPR/")
	case strings.Contains(ua, "Firefox/"):
		agent = "Firefox " + uaVersion(ua, "Firefox/")
	case strings.Contains(ua, "Chrome/"):
		agent = "Chrome " + uaVersion(ua, "Chrome/")
	case strings.Contains(ua, "Version/") && strings.Contains(ua, "Safari/"):
		agent = "Safari " + uaVersion(ua, "Version/")
	}
	platform := "Unknown device"
	switch {
	case strings.Contains(low, "android"):
		platform = "Android"
	case strings.Contains(low, "iphone") || strings.Contains(low, "ipad"):
		platform = "iOS / iPadOS"
	case strings.Contains(low, "windows"):
		platform = "Windows"
	case strings.Contains(low, "macintosh") || strings.Contains(low, "mac os x"):
		platform = "macOS"
	case strings.Contains(low, "linux"):
		platform = "Linux"
	}
	return strings.TrimSpace(agent), platform
}

func (a *app) chatVisitorMetadata(r *http.Request) chatVisitorMeta {
	ip := requestClientIP(r)
	ua := strings.TrimSpace(r.UserAgent())
	if len([]rune(ua)) > 500 {
		ua = string([]rune(ua)[:500])
	}
	agent, platform := summarizeUserAgent(ua)
	country := strings.ToUpper(strings.TrimSpace(r.Header.Get("CF-IPCountry")))
	if len(country) > 3 {
		country = country[:3]
	}
	referrer := strings.TrimSpace(r.Referer())
	if len([]rune(referrer)) > 500 {
		referrer = string([]rune(referrer)[:500])
	}
	fingerprint := tokenHash(ip + "\x00" + ua)
	if len(fingerprint) > 20 {
		fingerprint = fingerprint[:20]
	}
	meta := chatVisitorMeta{IP: ip, UserAgent: ua, Agent: agent, Platform: platform, Country: country, Referrer: referrer, Fingerprint: fingerprint}
	if ip != "" {
		meta.IPHash = tokenHash(ip)
	}
	if identity, ok := a.currentContactIdentity(r); ok {
		meta.AuthProvider, meta.AuthName, meta.AuthCredential, meta.ProfileURL = identity.Provider, identity.DisplayName, identity.Credential, identity.ProfileURL
	} else if identity, ok := a.currentFeedbackIdentity(r); ok {
		meta.AuthProvider, meta.AuthName, meta.AuthCredential, meta.ProfileURL = identity.Provider, identity.DisplayName, identity.Credential, identity.ProfileURL
	}
	return meta
}

func (a *app) chatAvailable() bool {
	if a.db == nil || a.chat == nil || a.chat.adminCount() == 0 {
		return false
	}
	var active bool
	if err := a.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM admin_sessions WHERE revoked_at IS NULL AND expires_at>?)`, time.Now()).Scan(&active); err != nil {
		return false
	}
	return active
}

func (a *app) publicChatStatus(w http.ResponseWriter, r *http.Request) {
	meta := a.chatVisitorMetadata(r)
	identity := map[string]any{"authenticated": meta.AuthName != ""}
	if meta.AuthName != "" {
		identity["display_name"] = meta.AuthName
		identity["provider"] = meta.AuthProvider
		if meta.ProfileURL != "" {
			identity["avatar_url"] = "/api/public/chat/avatar"
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"available": a.chatAvailable(), "transport": "websocket", "retention_days": 7, "identity": identity})
}

func (a *app) publicChatAvatar(w http.ResponseWriter, r *http.Request) {
	meta := a.chatVisitorMetadata(r)
	if meta.AuthProvider == "" || meta.ProfileURL == "" {
		http.NotFound(w, r)
		return
	}
	a.proxyFeedbackAvatar(w, r, meta.AuthProvider, meta.ProfileURL)
}

func (a *app) cleanupChats() {
	if a.db == nil {
		return
	}
	now := time.Now()
	_, _ = a.db.Exec(`DELETE FROM chat_messages WHERE expires_at<?`, now)
	_, _ = a.db.Exec(`DELETE FROM chat_threads t WHERE t.updated_at<? AND NOT EXISTS(SELECT 1 FROM chat_messages m WHERE m.thread_id=t.id)`, now.Add(-7*24*time.Hour))
}

func (a *app) currentChatThread(r *http.Request) (string, error) {
	cookie, err := r.Cookie(chatCookieName)
	if err != nil || cookie.Value == "" {
		return "", sql.ErrNoRows
	}
	var id string
	err = a.db.QueryRow(`SELECT id FROM chat_threads WHERE visitor_token_hash=? AND status='open'`, tokenHash(cookie.Value)).Scan(&id)
	return id, err
}
func (a *app) setChatCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{Name: chatCookieName, Value: token, Path: "/", Expires: time.Now().Add(7 * 24 * time.Hour), MaxAge: 7 * 24 * 3600, HttpOnly: true, Secure: isHTTPS(r, a.apiURL), SameSite: sessionSameSite()})
}

func (a *app) publicChatSession(w http.ResponseWriter, r *http.Request) {
	a.cleanupChats()
	if !a.chatAvailable() {
		writeError(w, http.StatusServiceUnavailable, "Live chat is offline because no administrator is currently available.")
		return
	}
	meta := a.chatVisitorMetadata(r)
	threadID, err := a.currentChatThread(r)
	if err != nil {
		if !a.allow(r, "chat-session", 5, 24*time.Hour) {
			writeError(w, http.StatusTooManyRequests, "Too many live-chat sessions were started from this connection. Try again later.")
			return
		}
		token, e := randomToken(32)
		if e != nil {
			writeError(w, 500, "Unable to start live chat.")
			return
		}
		idRaw, e := randomToken(12)
		if e != nil {
			writeError(w, 500, "Unable to start live chat.")
			return
		}
		threadID = "chat_" + idRaw
		_, e = a.db.Exec(`INSERT INTO chat_threads(
			id,visitor_token_hash,status,visitor_ip,visitor_ip_hash,visitor_user_agent,visitor_agent,visitor_platform,visitor_country,visitor_referrer,visitor_fingerprint,visitor_auth_provider,visitor_auth_name,visitor_auth_credential,visitor_profile_url,last_message_at,created_at,updated_at
		) VALUES(?,?,'open',?,?,?,?,?,?,?,?,?,?,?,?,clock_timestamp(),clock_timestamp(),clock_timestamp())`,
			threadID, tokenHash(token), meta.IP, meta.IPHash, meta.UserAgent, meta.Agent, meta.Platform, meta.Country, meta.Referrer, meta.Fingerprint, meta.AuthProvider, meta.AuthName, meta.AuthCredential, meta.ProfileURL)
		if e != nil {
			writeError(w, 500, "Unable to start live chat.")
			return
		}
		a.setChatCookie(w, r, token)
		a.chat.sendAdmins(map[string]any{"type": "thread", "thread_id": threadID})
	} else {
		_, _ = a.db.Exec(`UPDATE chat_threads SET visitor_ip=?,visitor_ip_hash=?,visitor_user_agent=?,visitor_agent=?,visitor_platform=?,visitor_country=?,visitor_referrer=?,visitor_fingerprint=?,updated_at=clock_timestamp() WHERE id=?`,
			meta.IP, meta.IPHash, meta.UserAgent, meta.Agent, meta.Platform, meta.Country, meta.Referrer, meta.Fingerprint, threadID)
		if meta.AuthName != "" {
			_, _ = a.db.Exec(`UPDATE chat_threads SET visitor_auth_provider=?,visitor_auth_name=?,visitor_auth_credential=?,visitor_profile_url=?,updated_at=clock_timestamp() WHERE id=?`,
				meta.AuthProvider, meta.AuthName, meta.AuthCredential, meta.ProfileURL, threadID)
		}
	}
	messages, err := a.loadChatMessages(threadID, 100)
	if err != nil {
		writeError(w, 500, "Unable to load live chat.")
		return
	}
	_, _ = a.db.Exec(`UPDATE chat_threads SET visitor_unread=0,updated_at=clock_timestamp() WHERE id=?`, threadID)
	writeJSON(w, http.StatusOK, map[string]any{"thread_id": threadID, "messages": messages, "available": true, "retention_days": 7})
}

func (a *app) loadChatMessages(thread string, limit int) ([]chatMessage, error) {
	rows, err := a.db.Query(`SELECT id,thread_id,sender,body,created_at FROM chat_messages WHERE thread_id=? AND expires_at>? ORDER BY created_at,id LIMIT ?`, thread, time.Now(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []chatMessage{}
	for rows.Next() {
		var m chatMessage
		if err = rows.Scan(&m.ID, &m.ThreadID, &m.Sender, &m.Body, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
func (a *app) saveChatMessage(thread, sender, body string) (chatMessage, error) {
	body = strings.TrimSpace(body)
	if len([]rune(body)) > 2000 {
		body = string([]rune(body)[:2000])
	}
	m := chatMessage{ThreadID: thread, Sender: sender, Body: body}
	if body == "" {
		return m, sql.ErrNoRows
	}
	var count int
	if err := a.db.QueryRow(`SELECT COUNT(*) FROM chat_messages WHERE thread_id=? AND expires_at>?`, thread, time.Now()).Scan(&count); err != nil {
		return m, err
	}
	if count >= 500 {
		return m, errors.New("chat message limit reached")
	}
	err := a.db.QueryRow(`INSERT INTO chat_messages(thread_id,sender,body,created_at,expires_at) VALUES(?,?,?,clock_timestamp(),clock_timestamp()+INTERVAL '7 days') RETURNING id,created_at`, thread, sender, body).Scan(&m.ID, &m.CreatedAt)
	if err != nil {
		return m, err
	}
	if sender == "visitor" {
		_, err = a.db.Exec(`UPDATE chat_threads SET admin_unread=admin_unread+1,last_message_at=?,updated_at=clock_timestamp() WHERE id=?`, m.CreatedAt, thread)
	} else {
		_, err = a.db.Exec(`UPDATE chat_threads SET visitor_unread=visitor_unread+1,last_message_at=?,updated_at=clock_timestamp() WHERE id=?`, m.CreatedAt, thread)
	}
	return m, err
}

func (a *app) publicChatWS(w http.ResponseWriter, r *http.Request) {
	if !a.chatAvailable() {
		writeError(w, http.StatusServiceUnavailable, "Live chat is offline.")
		return
	}
	thread, err := a.currentChatThread(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Open live chat first.")
		return
	}
	c, err := upgradeWebSocket(w, r)
	if err != nil {
		return
	}
	defer c.close()
	a.chat.addVisitor(thread, c)
	defer a.chat.removeVisitor(thread, c)
	_ = c.writeJSON([]byte(`{"type":"ready"}`))
	for {
		data, err := c.readText()
		if err != nil {
			return
		}
		var in struct {
			Body string `json:"body"`
		}
		if json.Unmarshal(data, &in) != nil {
			continue
		}
		if !a.chatAvailable() {
			_ = c.writeJSON([]byte(`{"type":"availability","available":false}`))
			continue
		}
		if !a.allow(r, "chat-message", 30, time.Minute) {
			_ = c.writeJSON([]byte(`{"type":"error","message":"Message limit reached. Please wait a moment."}`))
			continue
		}
		m, e := a.saveChatMessage(thread, "visitor", in.Body)
		if e != nil {
			continue
		}
		event := map[string]any{"type": "message", "message": m}
		a.chat.sendThread(thread, event)
		a.chat.sendAdmins(event)
	}
}

func (a *app) adminChatWS(w http.ResponseWriter, r *http.Request) {
	c, err := upgradeWebSocket(w, r)
	if err != nil {
		return
	}
	defer c.close()
	wasZero := a.chat.adminCount() == 0
	a.chat.addAdmin(c)
	if wasZero {
		a.chat.announceAvailability(true)
	}
	defer func() {
		a.chat.removeAdmin(c)
		if a.chat.adminCount() == 0 {
			a.chat.announceAvailability(false)
		}
	}()
	_ = c.writeJSON([]byte(`{"type":"ready","transport":"websocket"}`))
	for {
		data, err := c.readText()
		if err != nil {
			return
		}
		if !a.isAdmin(r) {
			return
		}
		var in struct {
			Action   string `json:"action"`
			ThreadID string `json:"thread_id"`
			Body     string `json:"body"`
		}
		if json.Unmarshal(data, &in) != nil {
			continue
		}
		switch in.Action {
		case "send":
			m, e := a.saveChatMessage(in.ThreadID, "admin", in.Body)
			if e != nil {
				continue
			}
			event := map[string]any{"type": "message", "message": m}
			a.chat.sendThread(in.ThreadID, event)
			a.chat.sendAdmins(event)
		case "close":
			_, _ = a.db.Exec(`UPDATE chat_threads SET status='closed',updated_at=clock_timestamp() WHERE id=?`, in.ThreadID)
			a.chat.sendThread(in.ThreadID, map[string]any{"type": "closed", "thread_id": in.ThreadID})
			a.chat.sendAdmins(map[string]any{"type": "thread", "thread_id": in.ThreadID})
		}
	}
}

func (a *app) adminChats(w http.ResponseWriter, r *http.Request) {
	a.cleanupChats()

	const pageSize = 10
	page := 1
	if value, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && value > 0 {
		page = value
	}

	var total, unread int
	if err := a.db.QueryRow(`SELECT COUNT(*),COALESCE(SUM(admin_unread),0) FROM chat_threads`).Scan(&total, &unread); err != nil {
		writeError(w, 500, "Unable to load chats.")
		return
	}
	totalPages := 1
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	if page > totalPages {
		page = totalPages
	}
	offset := (page - 1) * pageSize

	rows, err := a.db.Query(`SELECT t.id,t.status,t.admin_unread,t.visitor_unread,t.visitor_ip,t.visitor_ip_hash,t.visitor_user_agent,t.visitor_agent,t.visitor_platform,t.visitor_country,t.visitor_referrer,t.visitor_fingerprint,t.visitor_auth_provider,t.visitor_auth_name,t.visitor_auth_credential,t.visitor_profile_url,COALESCE(m.body,''),COALESCE(m.sender,''),t.last_message_at,t.created_at FROM chat_threads t LEFT JOIN LATERAL(SELECT body,sender FROM chat_messages WHERE thread_id=t.id AND expires_at>? ORDER BY created_at DESC,id DESC LIMIT 1)m ON true ORDER BY t.last_message_at DESC LIMIT ? OFFSET ?`, time.Now(), pageSize, offset)
	if err != nil {
		writeError(w, 500, "Unable to load chats.")
		return
	}
	defer rows.Close()
	items := []chatThread{}
	for rows.Next() {
		var x chatThread
		var profileURL string
		if err = rows.Scan(&x.ID, &x.Status, &x.AdminUnread, &x.VisitorUnread, &x.VisitorIP, &x.VisitorIPHash, &x.VisitorUserAgent, &x.VisitorAgent, &x.VisitorPlatform, &x.VisitorCountry, &x.VisitorReferrer, &x.VisitorFingerprint, &x.VisitorAuthProvider, &x.VisitorAuthName, &x.VisitorAuthCredential, &profileURL, &x.LastMessage, &x.LastSender, &x.LastMessageAt, &x.CreatedAt); err != nil {
			writeError(w, 500, "Unable to load chats.")
			return
		}
		if x.VisitorAuthProvider != "" && profileURL != "" {
			x.VisitorAvatarURL = "/api/admin/chats/" + x.ID + "/avatar"
		}
		items = append(items, x)
	}
	if err := rows.Err(); err != nil {
		writeError(w, 500, "Unable to load chats.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items, "unread": unread, "websocket": a.chat.adminCount() > 0, "retention_days": 7,
		"page": page, "page_size": pageSize, "total_items": total, "total_pages": totalPages,
		"has_previous": page > 1, "has_next": page < totalPages,
	})
}

func (a *app) adminChatMessages(w http.ResponseWriter, r *http.Request) {
	thread := clean(r.PathValue("id"), 120)
	messages, err := a.loadChatMessages(thread, 500)
	if err != nil {
		writeError(w, 500, "Unable to load messages.")
		return
	}
	var x chatThread
	var profileURL string
	err = a.db.QueryRow(`SELECT id,status,admin_unread,visitor_unread,visitor_ip,visitor_ip_hash,visitor_user_agent,visitor_agent,visitor_platform,visitor_country,visitor_referrer,visitor_fingerprint,visitor_auth_provider,visitor_auth_name,visitor_auth_credential,visitor_profile_url,last_message_at,created_at FROM chat_threads WHERE id=?`, thread).Scan(
		&x.ID, &x.Status, &x.AdminUnread, &x.VisitorUnread, &x.VisitorIP, &x.VisitorIPHash, &x.VisitorUserAgent, &x.VisitorAgent, &x.VisitorPlatform, &x.VisitorCountry, &x.VisitorReferrer, &x.VisitorFingerprint, &x.VisitorAuthProvider, &x.VisitorAuthName, &x.VisitorAuthCredential, &profileURL, &x.LastMessageAt, &x.CreatedAt)
	if err != nil {
		writeError(w, 404, "Chat not found.")
		return
	}
	if x.VisitorAuthProvider != "" && profileURL != "" {
		x.VisitorAvatarURL = "/api/admin/chats/" + x.ID + "/avatar"
	}
	_, _ = a.db.Exec(`UPDATE chat_threads SET admin_unread=0,updated_at=clock_timestamp() WHERE id=?`, thread)
	writeJSON(w, http.StatusOK, map[string]any{"thread_id": thread, "thread": x, "messages": messages})
}

func (a *app) adminChatAvatar(w http.ResponseWriter, r *http.Request) {
	thread := clean(r.PathValue("id"), 120)
	var provider, profileURL string
	if err := a.db.QueryRow(`SELECT visitor_auth_provider,visitor_profile_url FROM chat_threads WHERE id=?`, thread).Scan(&provider, &profileURL); err != nil || provider == "" || profileURL == "" {
		http.NotFound(w, r)
		return
	}
	a.proxyFeedbackAvatar(w, r, provider, profileURL)
}
func (a *app) adminDeleteChat(w http.ResponseWriter, r *http.Request) {
	thread := clean(r.PathValue("id"), 120)
	res, err := a.db.Exec(`DELETE FROM chat_threads WHERE id=?`, thread)
	if err != nil {
		writeError(w, 500, "Unable to delete chat.")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeError(w, 404, "Chat not found.")
		return
	}
	a.chat.sendThread(thread, map[string]any{"type": "closed", "thread_id": thread})
	writeJSON(w, http.StatusOK, map[string]string{"message": "Chat deleted."})
}

func drainBody(r *http.Request) { _, _ = io.Copy(io.Discard, io.LimitReader(r.Body, 1024)) }
