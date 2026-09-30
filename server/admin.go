package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const informationChallengeLifetime = 2 * time.Minute

type recentAdminItem struct {
	Kind      string    `json:"kind"`
	Title     string    `json:"title"`
	Detail    string    `json:"detail"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

func (a *app) publicVisit(w http.ResponseWriter, r *http.Request) {
	a.recordVisitIfNeeded(w, r)
	writeJSON(w, http.StatusOK, map[string]bool{"recorded": true})
}

func (a *app) recordVisitIfNeeded(w http.ResponseWriter, r *http.Request) {
	const cookieName = "jp_visit_window"
	if cookie, err := r.Cookie(cookieName); err == nil && cookie.Value == "1" {
		return
	}
	visitor := a.secretDigest("visit", clientIP(r), clean(r.UserAgent(), 500))
	_, _ = a.db.Exec(`INSERT INTO page_visits(visitor_hash, path, created_at) VALUES(?,?,?)`, visitor, "/", time.Now())
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: "1", Path: "/", MaxAge: 30 * 60,
		HttpOnly: true, Secure: isHTTPS(r, a.apiURL), SameSite: sessionSameSite(),
	})
}

func (a *app) adminOverviewV2(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	startDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	startMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())

	var totalVisits, todayVisits, monthVisits, uniqueVisitors int
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM page_visits`).Scan(&totalVisits)
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM page_visits WHERE created_at>=?`, startDay).Scan(&todayVisits)
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM page_visits WHERE created_at>=?`, startMonth).Scan(&monthVisits)
	_ = a.db.QueryRow(`SELECT COUNT(DISTINCT visitor_hash) FROM page_visits`).Scan(&uniqueVisitors)

	var pendingFeedback, approvedFeedback, hiddenFeedback int
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM feedback WHERE status='pending'`).Scan(&pendingFeedback)
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM feedback WHERE status='approved'`).Scan(&approvedFeedback)
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM feedback WHERE status='hidden'`).Scan(&hiddenFeedback)

	var newContacts, readContacts, archivedContacts int
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM contact_messages WHERE status='new'`).Scan(&newContacts)
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM contact_messages WHERE status='read'`).Scan(&readContacts)
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM contact_messages WHERE status='archived'`).Scan(&archivedContacts)

	projects, _ := a.collectManagedProjects(false)
	visibleProjects := 0
	externalProjects := 0
	for _, p := range projects {
		if p.Visible {
			visibleProjects++
		}
		if p.Source == "database" {
			externalProjects++
		}
	}

	recent := make([]recentAdminItem, 0, 10)
	rows, err := a.db.Query(`
		SELECT 'feedback', display_name, comment, status, created_at FROM feedback
		UNION ALL
		SELECT 'contact', full_name, subject, status, created_at FROM contact_messages
		ORDER BY created_at DESC LIMIT 8`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var item recentAdminItem
			_ = rows.Scan(&item.Kind, &item.Title, &item.Detail, &item.Status, &item.CreatedAt)
			recent = append(recent, item)
		}
		if err := rows.Err(); err != nil {
			writeError(w, http.StatusInternalServerError, "Unable to load recent activity.")
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"visits": map[string]int{
			"total": totalVisits, "today": todayVisits, "month": monthVisits, "unique": uniqueVisitors,
		},
		"feedback": map[string]int{
			"pending": pendingFeedback, "approved": approvedFeedback, "hidden": hiddenFeedback,
		},
		"contacts": map[string]int{
			"new": newContacts, "read": readContacts, "archived": archivedContacts,
		},
		"projects": map[string]int{
			"total": len(projects), "visible": visibleProjects, "external": externalProjects,
		},
		"recent":       recent,
		"generated_at": now,
	})
}

func (a *app) adminAnalytics(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	days := 14
	months := 12

	type point struct {
		Label string `json:"label"`
		Value int    `json:"value"`
	}
	dailyMap := map[string]int{}
	monthlyMap := map[string]int{}

	start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).AddDate(0, -(months - 1), 0)
	rows, err := a.db.Query(`SELECT created_at FROM page_visits WHERE created_at>=? ORDER BY created_at ASC`, start)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load visit analytics.")
		return
	}
	defer rows.Close()
	for rows.Next() {
		var t time.Time
		if rows.Scan(&t) == nil {
			dailyMap[t.In(now.Location()).Format("2006-01-02")]++
			monthlyMap[t.In(now.Location()).Format("2006-01")]++
		}
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load visit analytics.")
		return
	}

	daily := make([]point, 0, days)
	for i := days - 1; i >= 0; i-- {
		d := now.AddDate(0, 0, -i)
		key := d.Format("2006-01-02")
		daily = append(daily, point{Label: d.Format("Jan 02"), Value: dailyMap[key]})
	}
	monthly := make([]point, 0, months)
	for i := months - 1; i >= 0; i-- {
		d := now.AddDate(0, -i, 0)
		key := d.Format("2006-01")
		monthly = append(monthly, point{Label: d.Format("Jan 2006"), Value: monthlyMap[key]})
	}

	var total, today, month, unique int
	startDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	startMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM page_visits`).Scan(&total)
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM page_visits WHERE created_at>=?`, startDay).Scan(&today)
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM page_visits WHERE created_at>=?`, startMonth).Scan(&month)
	_ = a.db.QueryRow(`SELECT COUNT(DISTINCT visitor_hash) FROM page_visits`).Scan(&unique)

	writeJSON(w, http.StatusOK, map[string]any{
		"summary": map[string]int{"total": total, "today": today, "month": month, "unique": unique},
		"daily":   daily,
		"monthly": monthly,
	})
}

func pageParams(r *http.Request, max int) (page, limit, offset int) {
	page, limit = 1, 20
	if v, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && v > 0 {
		page = v
	}
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 {
		limit = v
	}
	if limit > max {
		limit = max
	}
	if limit < 1 {
		limit = 20
	}
	offset = (page - 1) * limit
	return
}

func (a *app) adminFeedbackPage(w http.ResponseWriter, r *http.Request) {
	page, limit, offset := pageParams(r, 20)
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	search := strings.TrimSpace(r.URL.Query().Get("q"))

	where := []string{"1=1"}
	args := []any{}
	if contains([]string{"pending", "approved", "hidden"}, status) {
		where = append(where, "status=?")
		args = append(args, status)
	}
	if search != "" {
		where = append(where, "(display_name ILIKE ? OR credential ILIKE ? OR auth_provider ILIKE ? OR comment ILIKE ?)")
		like := "%" + search + "%"
		args = append(args, like, like, like, like)
	}
	whereSQL := strings.Join(where, " AND ")

	var total int
	if err := a.db.QueryRow(`SELECT COUNT(*) FROM feedback WHERE `+whereSQL, args...).Scan(&total); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load feedback.")
		return
	}
	totalPages := max(1, (total+limit-1)/limit)
	if page > totalPages {
		page = totalPages
		offset = (page - 1) * limit
	}

	queryArgs := append(append([]any{}, args...), limit, offset)
	rows, err := a.db.Query(`SELECT id, display_name, rating, comment, status, pinned, auth_provider, credential, profile_url, created_at
		FROM feedback WHERE `+whereSQL+` ORDER BY pinned DESC, created_at DESC LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load feedback.")
		return
	}
	defer rows.Close()
	items := []feedback{}
	for rows.Next() {
		var f feedback
		if rows.Scan(&f.ID, &f.DisplayName, &f.Rating, &f.Comment, &f.Status, &f.Pinned, &f.AuthProvider, &f.Credential, &f.ProfileURL, &f.CreatedAt) == nil {
			if f.ProfileURL != "" && f.AuthProvider != "legacy" {
				f.AvatarURL = fmt.Sprintf("/api/admin/feedback/%d/avatar", f.ID)
			}
			items = append(items, f)
		}
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load feedback.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items, "page": page, "page_size": limit, "total": total, "total_pages": totalPages,
		"has_previous": page > 1, "has_next": page < totalPages,
	})
}

func (a *app) adminUpdateFeedbackV2(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid feedback id.")
		return
	}
	var in struct {
		Status *string `json:"status"`
		Pinned *bool   `json:"pinned"`
	}
	if decodeJSON(r, &in) != nil || (in.Status == nil && in.Pinned == nil) {
		writeError(w, http.StatusBadRequest, "Invalid feedback update.")
		return
	}
	var currentStatus string
	var currentPinned int
	if err := a.db.QueryRow(`SELECT status, pinned FROM feedback WHERE id=?`, id).Scan(&currentStatus, &currentPinned); err != nil {
		writeError(w, http.StatusNotFound, "Feedback not found.")
		return
	}
	if in.Status != nil {
		status := strings.TrimSpace(*in.Status)
		if !contains([]string{"pending", "approved", "hidden"}, status) {
			writeError(w, http.StatusBadRequest, "Invalid feedback status.")
			return
		}
		currentStatus = status
	}
	if in.Pinned != nil {
		if currentStatus == "pending" && *in.Pinned {
			writeError(w, http.StatusBadRequest, "Accept feedback before pinning it.")
			return
		}
		currentPinned = boolInt(*in.Pinned)
	}
	if currentStatus == "pending" {
		currentPinned = 0
	}
	result, err := a.db.Exec(`UPDATE feedback SET status=?, pinned=?, updated_at=? WHERE id=?`, currentStatus, currentPinned, time.Now(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to update feedback.")
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "Feedback not found.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Feedback updated."})
}

func (a *app) adminDeleteFeedback(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid feedback id.")
		return
	}
	result, err := a.db.Exec(`DELETE FROM feedback WHERE id=?`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to delete feedback.")
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "Feedback not found.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Feedback deleted."})
}

func (a *app) adminContactsPage(w http.ResponseWriter, r *http.Request) {
	page, limit, offset := pageParams(r, 20)
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	search := strings.TrimSpace(r.URL.Query().Get("q"))

	where := []string{"1=1"}
	args := []any{}
	if contains([]string{"new", "read", "archived"}, status) {
		where = append(where, "status=?")
		args = append(args, status)
	}
	if search != "" {
		where = append(where, "(full_name ILIKE ? OR email ILIKE ? OR subject ILIKE ? OR message ILIKE ?)")
		like := "%" + search + "%"
		args = append(args, like, like, like, like)
	}
	whereSQL := strings.Join(where, " AND ")

	var total, unreadTotal int
	if err := a.db.QueryRow(`SELECT COUNT(*) FROM contact_messages WHERE `+whereSQL, args...).Scan(&total); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load contact messages.")
		return
	}
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM contact_messages WHERE status='new'`).Scan(&unreadTotal)

	totalPages := max(1, (total+limit-1)/limit)
	if page > totalPages {
		page = totalPages
		offset = (page - 1) * limit
	}

	queryArgs := append(append([]any{}, args...), limit, offset)
	rows, err := a.db.Query(`SELECT id, full_name, email, profile_url, subject, message, status, created_at FROM contact_messages WHERE `+whereSQL+` ORDER BY created_at DESC LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load contact messages.")
		return
	}
	defer rows.Close()
	items := []contactMessage{}
	for rows.Next() {
		var c contactMessage
		if rows.Scan(&c.ID, &c.FullName, &c.Email, &c.ProfileURL, &c.Subject, &c.Message, &c.Status, &c.CreatedAt) == nil {
			if c.ProfileURL != "" {
				c.AvatarURL = fmt.Sprintf("/api/admin/contacts/%d/avatar", c.ID)
			}
			items = append(items, c)
		}
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load contact messages.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items, "page": page, "page_size": limit, "total": total, "total_pages": totalPages,
		"unread_total": unreadTotal,
		"has_previous": page > 1, "has_next": page < totalPages,
	})
}

func (a *app) adminContactAvatar(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	var profileURL string
	if err := a.db.QueryRow(`SELECT profile_url FROM contact_messages WHERE id=?`, id).Scan(&profileURL); err != nil || strings.TrimSpace(profileURL) == "" {
		http.NotFound(w, r)
		return
	}
	a.proxyFeedbackAvatar(w, r, "google", profileURL)
}

func (a *app) adminUpdateContactV2(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid contact id.")
		return
	}
	var in struct {
		Status string `json:"status"`
	}
	if decodeJSON(r, &in) != nil || !contains([]string{"new", "read", "archived"}, in.Status) {
		writeError(w, http.StatusBadRequest, "Invalid contact status.")
		return
	}
	result, err := a.db.Exec(`UPDATE contact_messages SET status=?, updated_at=? WHERE id=?`, in.Status, time.Now(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to update contact.")
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "Contact message not found.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Contact updated."})
}

func (a *app) adminDeleteContact(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid contact id.")
		return
	}
	result, err := a.db.Exec(`DELETE FROM contact_messages WHERE id=?`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to delete contact message.")
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "Contact message not found.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Contact message deleted."})
}

func (a *app) adminReplyContact(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid contact id.")
		return
	}

	var in struct {
		Subject string `json:"subject"`
		Message string `json:"message"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid reply request.")
		return
	}
	in.Subject = clean(in.Subject, 160)
	in.Message = strings.TrimSpace(in.Message)
	if len([]rune(in.Message)) > 5000 {
		in.Message = string([]rune(in.Message)[:5000])
	}
	if in.Message == "" {
		writeError(w, http.StatusBadRequest, "Write a reply before sending.")
		return
	}

	var contact contactMessage
	if err := a.db.QueryRow(`SELECT id, full_name, email, subject, message, status, created_at FROM contact_messages WHERE id=?`, id).Scan(
		&contact.ID, &contact.FullName, &contact.Email, &contact.Subject, &contact.Message, &contact.Status, &contact.CreatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "Contact message not found.")
			return
		}
		writeError(w, http.StatusInternalServerError, "Unable to load contact message.")
		return
	}
	if !validEmail(contact.Email) {
		writeError(w, http.StatusBadRequest, "This contact does not have a valid reply email.")
		return
	}

	if in.Subject == "" {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(contact.Subject)), "re:") {
			in.Subject = contact.Subject
		} else {
			in.Subject = "Re: " + contact.Subject
		}
	}

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
table{border-spacing:0;border-collapse:collapse}img{border:0;display:block}.email-bg{background:#f7f8fa}.card{background:#ffffff;border:1px solid #e0e5eb}.muted{color:#758195}.copy{color:#526071}.reply-box{background:#f0f3f6;border:1px solid #e0e5eb}.original{background:#fbfcfd;border-left:3px solid #16a34a}.brandbar{background:#172033;color:#f0f4f8}.accent{color:#16a34a}
@media only screen and (max-width:620px){.outer-pad{padding:0!important}.card{border-left:0!important;border-right:0!important;border-radius:0!important}.pad{padding:20px 18px!important}.headline{font-size:24px!important;line-height:30px!important}.reply-box,.original{padding:14px!important}.mobile-full{width:100%%!important}}
@media (prefers-color-scheme:dark){body,.email-bg{background:#0b0f14!important;color:#f0f4f8!important}.card{background:#121820!important;border-color:#26313d!important}.brandbar{background:#10161d!important}.copy{color:#b2becd!important}.muted{color:#8290a2!important}.reply-box{background:#18202a!important;border-color:#26313d!important}.original{background:#10161d!important;border-left-color:#4ade80!important}.accent{color:#73e89a!important}}
[data-ogsc] .email-bg{background:#0b0f14!important}[data-ogsc] .card{background:#121820!important;border-color:#26313d!important}[data-ogsc] .copy{color:#b2becd!important}[data-ogsc] .muted{color:#8290a2!important}[data-ogsc] .reply-box{background:#18202a!important;border-color:#26313d!important}[data-ogsc] .original{background:#10161d!important;border-left-color:#4ade80!important}
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden;opacity:0">A reply to your JPano.dev portfolio message.</div>
<table role="presentation" width="100%%" class="email-bg" style="width:100%%;background:#f7f8fa"><tr><td align="center" class="outer-pad" style="padding:24px 12px">
<table role="presentation" width="100%%" class="card mobile-full" style="width:100%%;max-width:620px;background:#ffffff;border:1px solid #e0e5eb;border-radius:20px;overflow:hidden">
<tr><td class="brandbar pad" style="padding:22px 24px;background:#172033;color:#f0f4f8"><div style="font-size:22px;line-height:28px;font-weight:800">JPano<span style="color:#4ade80">.dev</span></div><div style="margin-top:4px;color:#b2becd;font-size:12px;line-height:18px">Portfolio contact reply</div></td></tr>
<tr><td class="pad" style="padding:26px 24px">
<div class="accent" style="color:#16a34a;font-size:11px;line-height:16px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase">Message reply</div>
<h1 class="headline" style="margin:10px 0 8px;color:inherit;font-size:28px;line-height:34px">Hi %s,</h1>
<p class="copy" style="margin:0;color:#526071;font-size:14px;line-height:22px">Thanks for reaching out through my portfolio. Here is my response to your message.</p>
<div class="reply-box" style="margin:20px 0 0;padding:17px 18px;background:#f0f3f6;border:1px solid #e0e5eb;border-radius:14px;color:inherit;font-size:14px;line-height:23px">%s</div>
<div style="margin-top:24px;padding-top:18px;border-top:1px solid #e0e5eb">
<div class="muted" style="margin-bottom:8px;color:#758195;font-size:10px;line-height:15px;font-weight:800;letter-spacing:1px;text-transform:uppercase">Your original message</div>
<div class="original" style="padding:14px 16px;background:#fbfcfd;border-left:3px solid #16a34a;border-radius:0 10px 10px 0">
<div style="font-size:13px;line-height:19px;font-weight:800">%s</div>
<div class="copy" style="margin-top:7px;color:#526071;font-size:12px;line-height:19px">%s</div>
</div>
</div>
</td></tr>
<tr><td class="pad muted" style="padding:18px 24px 22px;border-top:1px solid #e0e5eb;color:#758195;font-size:11px;line-height:18px">Sent from JPano.dev. You can reply directly to this email to continue the conversation.</td></tr>
</table>
</td></tr></table>
</body>
</html>`,
		emailHTMLText(firstNonEmpty(contact.FullName, "there")),
		emailHTMLText(in.Message),
		emailHTMLText(contact.Subject),
		emailHTMLText(contact.Message),
	)

	if err := a.sendHTMLEmail(contact.Email, in.Subject, body); err != nil {
		writeError(w, http.StatusBadGateway, "Unable to send the reply email. Check the SMTP configuration and try again.")
		return
	}
	_, _ = a.db.Exec(`UPDATE contact_messages SET status='read', updated_at=? WHERE id=?`, time.Now(), id)
	writeJSON(w, http.StatusOK, map[string]string{"message": "Reply sent successfully."})
}

func cleanStringSlice(items []string, maxItems, maxLen int) []string {
	result := make([]string, 0, min(len(items), maxItems))
	seen := map[string]bool{}
	for _, item := range items {
		item = clean(item, maxLen)
		key := strings.ToLower(item)
		if item == "" || seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, item)
		if len(result) >= maxItems {
			break
		}
	}
	return result
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func (a *app) adminInformationChallenge(w http.ResponseWriter, r *http.Request) {
	if !a.allow(r, "information-challenge", 20, time.Hour) {
		writeError(w, http.StatusTooManyRequests, "Too many save challenges. Try again later.")
		return
	}
	value, err := generateChallengeKey(20)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to create save challenge.")
		return
	}
	id, err := randomToken(18)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to create save challenge.")
		return
	}
	expires := time.Now().Add(informationChallengeLifetime)
	a.access.mu.Lock()
	a.access.challenges[id] = accessChallengeState{Value: value, IP: clientIP(r), ExpiresAt: expires}
	a.access.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"challenge_id": id, "challenge": value, "expires_at": expires, "expires_in": int(informationChallengeLifetime.Seconds()),
	})
}

func decodeJSONWithLimit(r *http.Request, dst any, limit int64) error {
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, limit))
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}
