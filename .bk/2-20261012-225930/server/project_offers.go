package main

// Project offer + PayMongo QR Ph Hosted Checkout. No invoice is considered paid
// because of a client redirect: only a signed checkout_session.payment.paid
// webhook matching the exact stored session and centavo amount can approve it.

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type projectOffer struct {
	ID                 string    `json:"id"`
	ThreadID           string    `json:"-"`
	Title              string    `json:"title"`
	Description        string    `json:"description"`
	AdminNote          string    `json:"admin_note"`
	Archived           bool      `json:"archived"`
	PriceCentavos      int64     `json:"price_centavos"`
	DownpaymentPercent int       `json:"downpayment_percent"`
	PaidCentavos       int64     `json:"paid_centavos"`
	Status             string    `json:"status"`
	CreatedAt          time.Time `json:"created_at"`
}

func offerMin(o projectOffer) int64 { return (o.PriceCentavos*int64(o.DownpaymentPercent) + 99) / 100 }
func randomOfferToken(prefix string) (string, error) {
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return prefix + base64.RawURLEncoding.EncodeToString(b), nil
}
func (a *app) getOffer(id string) (projectOffer, error) {
	var o projectOffer
	if a.db == nil {
		return o, errors.New("database unavailable")
	}
	err := a.db.QueryRow(`SELECT id,thread_id,title,description,price_centavos,downpayment_percent,paid_centavos,status,created_at,COALESCE(admin_note,''),archived_at IS NOT NULL FROM portfolio.project_offers WHERE id=?`, id).
		Scan(&o.ID, &o.ThreadID, &o.Title, &o.Description, &o.PriceCentavos, &o.DownpaymentPercent, &o.PaidCentavos, &o.Status, &o.CreatedAt, &o.AdminNote, &o.Archived)
	return o, err
}
func (a *app) listOffers(thread string) ([]projectOffer, error) {
	rows, err := a.db.Query(`SELECT id,thread_id,title,description,price_centavos,downpayment_percent,paid_centavos,status,created_at,COALESCE(admin_note,''),archived_at IS NOT NULL FROM portfolio.project_offers WHERE thread_id=? AND archived_at IS NULL ORDER BY created_at DESC LIMIT 30`, thread)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []projectOffer{}
	for rows.Next() {
		var o projectOffer
		if err := rows.Scan(&o.ID, &o.ThreadID, &o.Title, &o.Description, &o.PriceCentavos, &o.DownpaymentPercent, &o.PaidCentavos, &o.Status, &o.CreatedAt, &o.AdminNote, &o.Archived); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}
func (a *app) adminCreateProjectOffer(w http.ResponseWriter, r *http.Request) {
	if !a.allow(r, "create-project-offer", 12, time.Hour) {
		writeError(w, 429, "Too many offers created. Try later.")
		return
	}
	thread := r.PathValue("id")
	var exists bool
	if err := a.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM chat_threads WHERE id=? AND status='open')`, thread).Scan(&exists); err != nil || !exists {
		writeError(w, 404, "Chat thread not found.")
		return
	}
	var in struct {
		Title              string  `json:"title"`
		Description        string  `json:"description"`
		Price              float64 `json:"price"`
		DownpaymentPercent int     `json:"downpayment_percent"`
		InquiryID          string  `json:"inquiry_id"`
		Note               string  `json:"note"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, 400, "Invalid offer data.")
		return
	}
	in.Title = clean(in.Title, 120)
	in.Description = strings.TrimSpace(in.Description)
	in.Note = clean(in.Note, 1000)
	if len([]rune(in.Description)) > 1400 || len([]rune(in.Title)) < 3 || math.IsNaN(in.Price) || math.IsInf(in.Price, 0) || in.Price < 1 || in.Price > 5000000 || in.DownpaymentPercent < 1 || in.DownpaymentPercent > 100 {
		writeError(w, 400, "Check title, description, price (PHP 1–5,000,000), and downpayment percent (1–100). ")
		return
	}
	id, err := randomOfferToken("po_")
	if err != nil {
		writeError(w, 500, "Unable to create offer.")
		return
	}
	price := int64(math.Round(in.Price * 100))
	if price < 100 {
		writeError(w, 400, "Price must be at least PHP 1.")
		return
	}
	// Preserve verified visitor display name/provider even after old chat data
	// expires. Payment records outlive seven-day chat retention.
	var ownerName, ownerProvider string
	_ = a.db.QueryRow(`SELECT COALESCE(visitor_auth_name,''),COALESCE(visitor_auth_provider,'') FROM chat_threads WHERE id=?`, thread).Scan(&ownerName, &ownerProvider)
	if in.InquiryID != "" {
		tx, e := a.db.BeginTx(r.Context(), nil)
		if e != nil {
			writeError(w, 503, "Project agreement unavailable.")
			return
		}
		defer tx.Rollback()
		var existingThread, state string
		e = tx.QueryRowContext(r.Context(), `SELECT thread_id,status FROM portfolio.project_inquiries WHERE id=$1 FOR UPDATE`, in.InquiryID).Scan(&existingThread, &state)
		if e != nil || existingThread != thread || state != "pending" {
			writeError(w, 409, "Project inquiry is no longer pending in this conversation.")
			return
		}
		_, e = tx.ExecContext(r.Context(), `INSERT INTO portfolio.project_offers(id,thread_id,title,description,price_centavos,downpayment_percent,owner_name,owner_provider,admin_note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, id, thread, in.Title, in.Description, price, in.DownpaymentPercent, ownerName, ownerProvider, in.Note)
		if e == nil {
			_, e = tx.ExecContext(r.Context(), `UPDATE portfolio.project_inquiries SET status='accepted',offer_id=$1,admin_note=$2,updated_at=NOW() WHERE id=$3 AND status='pending'`, id, in.Note, in.InquiryID)
		}
		if e == nil {
			e = tx.Commit()
		}
		if e != nil {
			writeError(w, 503, "Unable to accept the project inquiry.")
			return
		}
	} else {
		if _, err = a.db.Exec(`INSERT INTO portfolio.project_offers(id,thread_id,title,description,price_centavos,downpayment_percent,owner_name,owner_provider,admin_note) VALUES(?,?,?,?,?,?,?,?,?)`, id, thread, in.Title, in.Description, price, in.DownpaymentPercent, ownerName, ownerProvider, in.Note); err != nil {
			writeError(w, 503, "Project offer database migration is required before creating offers.")
			return
		}
	}
	offer, err := a.getOffer(id)
	if err != nil {
		writeError(w, 500, "Unable to read offer.")
		return
	}
	// Persist a plain announcement for Admin history and Live Chat history.
	body := fmt.Sprintf("**Project proposal:** %s\n\nPrice: PHP %.2f · Minimum downpayment: %d%%. Open the Project card to view payment options.", in.Title, float64(price)/100, in.DownpaymentPercent)
	if m, e := a.saveChatMessage(thread, "admin", body); e == nil {
		a.chat.sendThread(thread, map[string]any{"type": "message", "message": m})
		a.chat.sendAdmins(map[string]any{"type": "message", "message": m})
	}
	a.chat.sendThread(thread, map[string]any{"type": "project_offer", "offer": offer})
	a.chat.sendAdmins(map[string]any{"type": "project_offer", "offer": offer, "thread_id": thread})
	writeJSON(w, 201, map[string]any{"offer": offer})
}
func (a *app) publicChatOffers(w http.ResponseWriter, r *http.Request) {
	thread, err := a.currentChatThread(r)
	if err != nil {
		writeJSON(w, 200, map[string]any{"offers": []projectOffer{}})
		return
	}
	offers, err := a.listOffers(thread)
	if err != nil {
		writeError(w, 503, "Project offers are unavailable. Apply the reviewed database schema first.")
		return
	}
	writeJSON(w, 200, map[string]any{"offers": offers})
}
func (a *app) publicChatOfferCheckout(w http.ResponseWriter, r *http.Request) {
	if !a.allow(r, "project-checkout", 5, time.Hour) {
		writeError(w, 429, "Checkout limit reached. Try again later.")
		return
	}
	thread, err := a.currentChatThread(r)
	if err != nil {
		writeError(w, 401, "Open your original Live Chat session to pay.")
		return
	}
	offer, err := a.getOffer(r.PathValue("id"))
	if err != nil || offer.ThreadID != thread {
		writeError(w, 404, "Project proposal not found for this chat.")
		return
	}
	if offer.Status == "paid" || offer.Status == "cancelled" || offer.Archived {
		writeError(w, 409, "This proposal is not awaiting payment.")
		return
	}
	var in struct {
		AmountCentavos int64  `json:"amount_centavos"`
		Email          string `json:"email"`
		Phone          string `json:"phone"`
	}
	if decodeJSON(r, &in) != nil {
		writeError(w, 400, "Invalid amount.")
		return
	}
	// Customer details are optional. A validated OAuth email is used only if
	// checkout omitted an email; never trust a client-provided identity claim.
	in.Email = strings.TrimSpace(strings.ToLower(in.Email))
	in.Phone = strings.TrimSpace(in.Phone)
	if in.Email == "" {
		if identity, ok := a.currentContactIdentity(r); ok && validEmail(identity.Credential) {
			in.Email = strings.TrimSpace(strings.ToLower(identity.Credential))
		} else if identity, ok := a.currentFeedbackIdentity(r); ok && validEmail(identity.Credential) {
			in.Email = strings.TrimSpace(strings.ToLower(identity.Credential))
		}
	}
	if (in.Email != "" && (len(in.Email) > 180 || !validEmail(in.Email))) || (in.Phone != "" && (len(in.Phone) > 25 || !regexp.MustCompile(`^[+0-9 ()-]+$`).MatchString(in.Phone))) {
		writeError(w, 400, "Provide a valid optional email or contact number.")
		return
	}
	// Reopening an existing checkout should not create another chargeable link.
	// There can be at most one pending attempt per offer (enforced by SQL).
	var existingURL string
	var existingAmount int64
	if err := a.db.QueryRow(`SELECT checkout_url,amount_centavos FROM portfolio.project_payment_attempts WHERE offer_id=? AND status='pending' ORDER BY created_at DESC LIMIT 1`, offer.ID).Scan(&existingURL, &existingAmount); err == nil {
		writeJSON(w, 200, map[string]any{"checkout_url": existingURL, "amount_centavos": existingAmount, "status": "pending", "qrph": true, "reused": true})
		return
	} else if err != sql.ErrNoRows {
		writeError(w, 503, "Unable to inspect existing checkout.")
		return
	}
	remaining := offer.PriceCentavos - offer.PaidCentavos
	minimum := offerMin(offer) - offer.PaidCentavos
	if minimum < 100 {
		minimum = 100
	}
	if remaining < 100 || in.AmountCentavos < minimum || in.AmountCentavos > remaining {
		writeError(w, 400, "Choose an amount from the remaining required downpayment through the outstanding total.")
		return
	}
	secret := strings.TrimSpace(os.Getenv("PAYMONGO_SECRET"))
	// A live secret is deliberately not enough to charge real money: deployment
	// must opt in independently with PAYMONGO_ALLOW_LIVE=true after testing.
	if secret == "" {
		writeError(w, 503, "Secure checkout is not configured. Contact the portfolio owner.")
		return
	}
	if strings.HasPrefix(secret, "sk_live_") && os.Getenv("PAYMONGO_ALLOW_LIVE") != "true" {
		writeError(w, 503, "Live checkout is currently disabled. Contact the portfolio owner.")
		return
	}
	if !strings.HasPrefix(secret, "sk_test_") && !strings.HasPrefix(secret, "sk_live_") {
		writeError(w, 503, "Secure checkout configuration is invalid. Contact the portfolio owner.")
		return
	}
	attempt, err := randomOfferToken("pc_")
	if err != nil {
		writeError(w, 500, "Unable to start checkout.")
		return
	}
	// Only a fixed PayMongo host is contacted. Customer-selected amount is checked
	// against the immutable Admin-defined offer; all amounts use centavos.
	attributes := map[string]any{"line_items": []map[string]any{{"name": offer.Title, "amount": in.AmountCentavos, "currency": "PHP", "quantity": 1}},
		"payment_method_types": []string{"qrph"}, "reference_number": attempt,
		"success_url": strings.TrimRight(a.appURL, "/") + "/?checkout_return=1#contact",
		"cancel_url":  strings.TrimRight(a.appURL, "/") + "/#contact"}
	// PayMongo uses `billing` to prefill hosted-checkout contact fields.
	// Avoid billing entirely when both fields are blank.
	if in.Email != "" || in.Phone != "" {
		billing := map[string]string{}
		if in.Email != "" {
			billing["email"] = in.Email
		}
		if in.Phone != "" {
			billing["phone"] = in.Phone
		}
		attributes["billing"] = billing
	}
	payload, _ := json.Marshal(map[string]any{"data": map[string]any{"attributes": attributes}})
	req, err := http.NewRequestWithContext(r.Context(), "POST", "https://api.paymongo.com/v2/checkout_sessions", bytes.NewReader(payload))
	if err != nil {
		writeError(w, 502, "Checkout unavailable.")
		return
	}
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(secret+":")))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Idempotency-Key", attempt)
	client := http.Client{Timeout: 12 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		writeError(w, 502, "PayMongo could not be reached.")
		return
	}
	defer res.Body.Close()
	if res.StatusCode != 200 && res.StatusCode != 201 {
		writeError(w, 502, "PayMongo did not accept the checkout request.")
		return
	}
	var created struct {
		Data struct {
			ID         string `json:"id"`
			Attributes struct {
				CheckoutURL string `json:"checkout_url"`
			} `json:"attributes"`
		} `json:"data"`
	}
	if json.NewDecoder(io.LimitReader(res.Body, 100*1024)).Decode(&created) != nil || !strings.HasPrefix(created.Data.ID, "cs_") {
		writeError(w, 502, "Invalid checkout response.")
		return
	}
	link, err := url.Parse(created.Data.Attributes.CheckoutURL)
	if err != nil || link.Scheme != "https" || link.Host != "checkout.paymongo.com" || link.User != nil {
		writeError(w, 502, "Unsafe checkout URL was rejected.")
		return
	}
	if _, err = a.db.Exec(`INSERT INTO portfolio.project_payment_attempts(id,offer_id,amount_centavos,checkout_session_id,checkout_url,customer_email,customer_phone) VALUES(?,?,?,?,?,?,?)`, attempt, offer.ID, in.AmountCentavos, created.Data.ID, link.String(), in.Email, in.Phone); err != nil {
		// The gateway may have created a session. Never claim a payment was approved.
		writeError(w, 503, "Checkout was created but could not be recorded. Contact Admin; do not make a second payment.")
		return
	}
	// Contact details become the default for the project owner only after
	// a successfully created and recorded checkout. Payment is NOT approved.
	_, _ = a.db.Exec(`UPDATE portfolio.project_offers SET contact_email=CASE WHEN ?='' THEN contact_email ELSE ? END,contact_phone=CASE WHEN ?='' THEN contact_phone ELSE ? END WHERE id=?`, in.Email, in.Email, in.Phone, in.Phone, offer.ID)
	writeJSON(w, 200, map[string]any{"checkout_url": link.String(), "amount_centavos": in.AmountCentavos, "status": "pending", "qrph": true})
}

// Header format: t=timestamp,te=<test HMAC>,li=<live HMAC>; use raw bytes.
func verifyPayMongoSignature(header string, body []byte, secret string, live bool, now time.Time) bool {
	var t, sig string
	for _, part := range strings.Split(header, ",") {
		v := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(v) != 2 {
			continue
		}
		switch v[0] {
		case "t":
			t = v[1]
		case "te":
			if !live {
				sig = v[1]
			}
		case "li":
			if live {
				sig = v[1]
			}
		}
	}
	stamp, err := strconv.ParseInt(t, 10, 64)
	if err != nil || sig == "" || len(sig) != 64 || secret == "" {
		return false
	}
	if delta := now.Unix() - stamp; delta > 300 || delta < -300 {
		return false
	}
	bytesSig, err := hex.DecodeString(sig)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(t + "."))
	_, _ = mac.Write(body)
	return subtle.ConstantTimeCompare(mac.Sum(nil), bytesSig) == 1
}

type paidCheckout struct {
	ID         string `json:"id"`
	Attributes struct {
		Reference string `json:"reference_number"`
		Payments  []struct {
			ID         string `json:"id"`
			Attributes struct {
				Status   string `json:"status"`
				Amount   int64  `json:"amount"`
				Currency string `json:"currency"`
			} `json:"attributes"`
		} `json:"payments"`
	} `json:"attributes"`
}

func parseCheckoutPaymentEvent(body []byte) (string, bool, paidCheckout, error) {
	var event struct {
		Data struct {
			Type       string       `json:"type"`
			Livemode   bool         `json:"livemode"`
			Data       paidCheckout `json:"data"`
			Attributes struct {
				Type     string       `json:"type"`
				Livemode bool         `json:"livemode"`
				Data     paidCheckout `json:"data"`
			} `json:"attributes"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &event); err != nil {
		return "", false, paidCheckout{}, err
	}
	eventType, eventLive, session := event.Data.Type, event.Data.Livemode, event.Data.Data
	if eventType == "event" {
		eventType, eventLive, session = event.Data.Attributes.Type, event.Data.Attributes.Livemode, event.Data.Attributes.Data
	}
	return eventType, eventLive, session, nil
}

func (a *app) paymongoWebhook(w http.ResponseWriter, r *http.Request) {
	secret := os.Getenv("PAYMONGO_WEBHOOK_SECRET")
	key := strings.TrimSpace(os.Getenv("PAYMONGO_SECRET"))
	live := strings.HasPrefix(key, "sk_live_")
	if secret == "" || (!strings.HasPrefix(key, "sk_test_") && !(live && os.Getenv("PAYMONGO_ALLOW_LIVE") == "true")) {
		writeError(w, 503, "PayMongo webhook not configured.")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 160*1024))
	if err != nil {
		writeError(w, 413, "Webhook too large.")
		return
	}
	if !verifyPayMongoSignature(r.Header.Get("Paymongo-Signature"), body, secret, live, time.Now()) {
		writeError(w, 401, "Invalid webhook signature.")
		return
	}
	eventType, eventLive, session, err := parseCheckoutPaymentEvent(body)
	if err != nil {
		writeError(w, 400, "Invalid event JSON.")
		return
	}
	if eventType != "checkout_session.payment.paid" {
		writeJSON(w, 200, map[string]string{"status": "ignored"})
		return
	}
	if eventLive != live {
		writeError(w, 401, "PayMongo mode mismatch.")
		return
	}
	var amount int64
	var offerID, paymentStatus, sessionID string
	err = a.db.QueryRow(`SELECT offer_id,amount_centavos,status,checkout_session_id FROM portfolio.project_payment_attempts WHERE id=?`, session.Attributes.Reference).
		Scan(&offerID, &amount, &paymentStatus, &sessionID)
	if err != nil {
		writeError(w, 404, "Unknown checkout reference.")
		return
	}
	if sessionID != session.ID {
		writeError(w, 409, "Checkout session mismatch.")
		return
	}
	if paymentStatus == "paid" {
		writeJSON(w, 200, map[string]string{"status": "already_processed"})
		return
	}
	paidID := ""
	for _, payment := range session.Attributes.Payments {
		if payment.Attributes.Status == "paid" && payment.Attributes.Currency == "PHP" && payment.Attributes.Amount == amount && payment.ID != "" {
			paidID = payment.ID
			break
		}
	}
	if paidID == "" {
		writeError(w, 409, "Signed event does not contain a matching paid payment.")
		return
	}
	// Use the same idempotent financial transaction as trusted API reconciliation.
	// A signed event is accepted only when PayMongo provides a matching paid
	// payment for our immutable session ID, reference, amount and currency.
	result, e := a.commitConfirmedCheckout(r.Context(), session)
	if e != nil {
		writeError(w, 503, "Payment confirmation is temporarily unavailable.")
		return
	}
	writeJSON(w, 200, map[string]string{"status": result})
}

// The existing authenticated Admin session authorizes access to a thread's
// offers. Visitor endpoint remains cookie-scoped to its own thread.
func (a *app) adminChatOffers(w http.ResponseWriter, r *http.Request) {
	offers, err := a.listOffers(r.PathValue("id"))
	if err != nil {
		writeError(w, 503, "Project offers are unavailable.")
		return
	}
	writeJSON(w, 200, map[string]any{"offers": offers})
}
