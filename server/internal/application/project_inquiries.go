package application

// Visitor project inquiries remain separate from seven-day chat messages;
// only the matching HTTP-only chat session can create or withdraw them.
import (
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type projectInquiry struct {
	ID                string    `json:"id"`
	ThreadID          string    `json:"-"`
	Title             string    `json:"title"`
	Description       string    `json:"description"`
	RequestedCentavos int64     `json:"requested_centavos"`
	Status            string    `json:"status"`
	AdminNote         string    `json:"admin_note"`
	OfferID           string    `json:"offer_id"`
	CreatedAt         time.Time `json:"created_at"`
}

func (a *app) readInquiries(thread string) ([]projectInquiry, error) {
	rows, err := a.db.Query(`SELECT id,thread_id,title,description,requested_centavos,status,admin_note,COALESCE(offer_id,''),created_at FROM portfolio.project_inquiries WHERE thread_id=? ORDER BY created_at DESC LIMIT 60`, thread)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []projectInquiry{}
	for rows.Next() {
		var x projectInquiry
		if e := rows.Scan(&x.ID, &x.ThreadID, &x.Title, &x.Description, &x.RequestedCentavos, &x.Status, &x.AdminNote, &x.OfferID, &x.CreatedAt); e == nil {
			list = append(list, x)
		}
	}
	return list, rows.Err()
}
func (a *app) publicCreateInquiry(w http.ResponseWriter, r *http.Request) {
	thread, err := a.currentChatThread(r)
	if err != nil {
		writeError(w, 401, "Open a Live Chat before requesting a project.")
		return
	}
	if !a.allow(r, "create-project-inquiry", 8, time.Hour) {
		writeError(w, 429, "Too many project requests.")
		return
	}
	var in struct {
		Title       string  `json:"title"`
		Description string  `json:"description"`
		Amount      float64 `json:"amount"`
	}
	if decodeJSONWithLimit(r, &in, 4*1024) != nil {
		writeError(w, 400, "Invalid project request.")
		return
	}
	in.Title = clean(in.Title, 120)
	in.Description = strings.TrimSpace(in.Description)
	if len([]rune(in.Title)) < 3 || len([]rune(in.Description)) < 10 || len([]rune(in.Description)) > 1400 || math.IsNaN(in.Amount) || math.IsInf(in.Amount, 0) || in.Amount < 1 || in.Amount > 5000000 {
		writeError(w, 400, "Enter a title, description (10-1400 characters), and estimated PHP amount.")
		return
	}
	id, e := randomOfferToken("pi_")
	if e != nil {
		writeError(w, 503, "Cannot create request.")
		return
	}
	cents := int64(math.Round(in.Amount * 100))
	_, err = a.db.Exec(`INSERT INTO portfolio.project_inquiries(id,thread_id,title,description,requested_centavos) VALUES(?,?,?,?,?)`, id, thread, in.Title, in.Description, cents)
	if err != nil {
		writeError(w, 503, "Project inquiry storage unavailable. Apply the reviewed schema update.")
		return
	}
	text := "**New project inquiry:** " + in.Title + "\n\n" + in.Description + "\n\nRequested budget: PHP " + fmtAmountPHP(cents) + ". Admin can review this inquiry before proposing an agreement."
	if m, e := a.saveChatMessage(thread, "visitor", text); e == nil && a.chat != nil {
		a.chat.sendThread(thread, map[string]any{"type": "message", "message": m})
		a.chat.sendAdmins(map[string]any{"type": "message", "message": m})
	}
	if a.chat != nil {
		a.chat.sendAdmins(map[string]any{"type": "project_inquiry", "thread_id": thread})
	}
	writeJSON(w, 201, map[string]any{"created": true, "id": id})
}
func fmtAmountPHP(c int64) string { return fmtMoney(c) }
func fmtMoney(c int64) string {
	whole, part := c/100, c%100
	return strconv.FormatInt(whole, 10) + "." + fmt.Sprintf("%02d", part)
}
func (a *app) publicInquiries(w http.ResponseWriter, r *http.Request) {
	thread, e := a.currentChatThread(r)
	if e != nil {
		writeJSON(w, 200, map[string]any{"items": []projectInquiry{}})
		return
	}
	list, e := a.readInquiries(thread)
	if e != nil {
		writeError(w, 503, "Project inquiries temporarily unavailable.")
		return
	}
	writeJSON(w, 200, map[string]any{"items": list})
}
func (a *app) adminInquiries(w http.ResponseWriter, r *http.Request) {
	list, e := a.readInquiries(r.PathValue("id"))
	if e != nil {
		writeError(w, 503, "Project inquiries temporarily unavailable.")
		return
	}
	writeJSON(w, 200, map[string]any{"items": list})
}
func (a *app) publicWithdrawInquiry(w http.ResponseWriter, r *http.Request) {
	thread, e := a.currentChatThread(r)
	if e != nil {
		writeError(w, 401, "Chat session required.")
		return
	}
	res, e := a.db.Exec(`UPDATE portfolio.project_inquiries SET status='withdrawn',updated_at=NOW() WHERE id=? AND thread_id=? AND status='pending'`, r.PathValue("id"), thread)
	if e != nil {
		writeError(w, 503, "Unable to withdraw project request.")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeError(w, 409, "Only your own pending request may be withdrawn.")
		return
	}
	writeJSON(w, 200, map[string]any{"withdrawn": true})
}
func (a *app) adminUpdateInquiry(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if decodeJSONWithLimit(r, &in, 3*1024) != nil {
		writeError(w, 400, "Invalid update.")
		return
	}
	in.Note = clean(in.Note, 1000)
	if in.Status != "declined" && in.Status != "pending" {
		writeError(w, 400, "Only pending or declined states are editable here.")
		return
	}
	res, e := a.db.Exec(`UPDATE portfolio.project_inquiries SET status=?,admin_note=?,updated_at=NOW() WHERE id=? AND status IN ('pending','declined')`, in.Status, in.Note, r.PathValue("id"))
	if e != nil {
		writeError(w, 503, "Unable to update inquiry.")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeError(w, 404, "Pending inquiry not found.")
		return
	}
	writeJSON(w, 200, map[string]any{"updated": true})
}

// Remove project cards from the conversation without removing their payment ledger.
func (a *app) adminArchiveProjectOffer(w http.ResponseWriter, r *http.Request) {
	res, e := a.db.Exec(`UPDATE portfolio.project_offers SET archived_at=COALESCE(archived_at,NOW()) WHERE id=?`, r.PathValue("id"))
	if e != nil {
		writeError(w, 503, "Unable to archive project.")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeError(w, 404, "Project not found.")
		return
	}
	var thread string
	_ = a.db.QueryRow(`SELECT thread_id FROM portfolio.project_offers WHERE id=?`, r.PathValue("id")).Scan(&thread)
	if a.chat != nil && thread != "" {
		message := map[string]any{"type": "project_offer_archived", "id": r.PathValue("id"), "thread_id": thread}
		a.chat.sendThread(thread, message)
		a.chat.sendAdmins(message)
	}
	writeJSON(w, 200, map[string]any{"archived": true, "payment_ledger_preserved": true})
}
