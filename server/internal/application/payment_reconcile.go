package application

// PayMongo reconciliation is initiated only by an authenticated Admin or the
// owning Live Chat session. A customer's redirect never changes payment state.
// All amounts, reference IDs, currency and livemode come from PayMongo's
// authenticated API response; errors fail closed and leave the ledger intact.
import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

var errCheckoutNotVerified = errors.New("PayMongo has not confirmed a matching payment yet")

func paymongoSessionPaid(session paidCheckout, reference, sessionID string, amount int64) (string, bool) {
	if subtle.ConstantTimeCompare([]byte(session.ID), []byte(sessionID)) != 1 || subtle.ConstantTimeCompare([]byte(session.Attributes.Reference), []byte(reference)) != 1 {
		return "", false
	}
	for _, pay := range session.Attributes.Payments {
		if pay.ID != "" && pay.Attributes.Status == "paid" && pay.Attributes.Currency == "PHP" && pay.Attributes.Amount == amount {
			return pay.ID, true
		}
	}
	return "", false
}

// Only the fixed PayMongo API host is contacted. The session ID comes from a
// database record created by our own checkout request, never a caller URL.
func queryPayMongoCheckout(ctx context.Context, sessionID string) (paidCheckout, error) {
	var out paidCheckout
	secret := strings.TrimSpace(os.Getenv("PAYMONGO_SECRET"))
	live := strings.HasPrefix(secret, "sk_live_")
	if (!strings.HasPrefix(secret, "sk_test_") && !live) || (live && os.Getenv("PAYMONGO_ALLOW_LIVE") != "true") {
		return out, errors.New("payment credentials unavailable")
	}
	if len(sessionID) < 6 || len(sessionID) > 120 || !strings.HasPrefix(sessionID, "cs_") {
		return out, errors.New("invalid checkout identifier")
	}
	for _, c := range sessionID {
		if (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') && (c < '0' || c > '9') && c != '_' && c != '-' {
			return out, errors.New("invalid checkout identifier")
		}
	}
	client := &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	// Older Checkout Sessions may use v1; start with the v2 retrieval endpoint.
	for _, version := range []string{"v2", "v1"} {
		req, e := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.paymongo.com/"+version+"/checkout_sessions/"+sessionID, nil)
		if e != nil {
			return out, e
		}
		req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(secret+":")))
		req.Header.Set("Accept", "application/json")
		resp, e := client.Do(req)
		if e != nil {
			return out, errors.New("payment gateway temporarily unreachable")
		}
		if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusMethodNotAllowed {
			resp.Body.Close()
			continue
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return out, fmt.Errorf("payment gateway returned status %d", resp.StatusCode)
		}
		var payload struct {
			Data struct {
				ID         string `json:"id"`
				Live       *bool  `json:"livemode"`
				Attributes struct {
					Reference string `json:"reference_number"`
					Live      *bool  `json:"livemode"`
					Payments  []struct {
						ID         string `json:"id"`
						Attributes struct {
							Status   string `json:"status"`
							Amount   int64  `json:"amount"`
							Currency string `json:"currency"`
						} `json:"attributes"`
					} `json:"payments"`
				} `json:"attributes"`
			} `json:"data"`
		}
		e = json.NewDecoder(io.LimitReader(resp.Body, 128*1024)).Decode(&payload)
		resp.Body.Close()
		if e != nil {
			return out, errors.New("unrecognized payment status response")
		}
		if payload.Data.Live == nil {
			payload.Data.Live = payload.Data.Attributes.Live
		}
		if payload.Data.Live == nil || *payload.Data.Live != live {
			return out, errors.New("payment mode could not be verified")
		}
		encoded, _ := json.Marshal(payload.Data)
		if json.Unmarshal(encoded, &out) != nil {
			return out, errors.New("invalid checkout details")
		}
		// The model contains only fields needed for exact ledger verification.
		out.ID = payload.Data.ID
		out.Attributes.Reference = payload.Data.Attributes.Reference
		return out, nil
	}
	return out, errors.New("payment session not found at gateway")
}

// A shared, idempotent transaction guarantees that a webhook and an API
// reconciliation racing each other can credit the exact payment at most once.
func (a *app) commitConfirmedCheckout(ctx context.Context, session paidCheckout) (string, error) {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	var offerID, storedID, status string
	var amount int64
	err = tx.QueryRowContext(ctx, `SELECT offer_id,checkout_session_id,status,amount_centavos FROM portfolio.project_payment_attempts WHERE id=$1 FOR UPDATE`, session.Attributes.Reference).Scan(&offerID, &storedID, &status, &amount)
	if err != nil {
		return "", err
	}
	if status == "paid" {
		return "already_processed", nil
	}
	if status != "pending" {
		return "", errCheckoutNotVerified
	}
	paymentID, ok := paymongoSessionPaid(session, session.Attributes.Reference, storedID, amount)
	if !ok {
		return "", errCheckoutNotVerified
	}
	if _, err = tx.ExecContext(ctx, `UPDATE portfolio.project_payment_attempts SET status='paid',payment_id=$1,paid_at=NOW() WHERE id=$2 AND status='pending'`, paymentID, session.Attributes.Reference); err != nil {
		return "", err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE portfolio.project_offers SET paid_centavos=(SELECT COALESCE(SUM(amount_centavos),0) FROM portfolio.project_payment_attempts WHERE offer_id=$1 AND status='paid'),updated_at=NOW() WHERE id=$1`, offerID); err != nil {
		return "", err
	}
	var total, price int64
	var pct int
	var thread string
	err = tx.QueryRowContext(ctx, `SELECT paid_centavos,price_centavos,downpayment_percent,thread_id FROM portfolio.project_offers WHERE id=$1 FOR UPDATE`, offerID).Scan(&total, &price, &pct, &thread)
	if err != nil {
		return "", err
	}
	next := "pending"
	if total >= price {
		next = "paid"
	} else if total >= (price*int64(pct)+99)/100 {
		next = "payment_approved"
	}
	if _, err = tx.ExecContext(ctx, `UPDATE portfolio.project_offers SET status=$1 WHERE id=$2`, next, offerID); err != nil {
		return "", err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE portfolio.project_offers o SET contact_email=CASE WHEN p.customer_email='' THEN o.contact_email ELSE p.customer_email END, contact_phone=CASE WHEN p.customer_phone='' THEN o.contact_phone ELSE p.customer_phone END FROM portfolio.project_payment_attempts p WHERE p.id=$1 AND o.id=p.offer_id`, session.Attributes.Reference); err != nil {
		return "", err
	}
	if err = tx.Commit(); err != nil {
		return "", err
	}
	if offer, e := a.getOffer(offerID); e == nil && a.chat != nil {
		a.chat.sendThread(thread, map[string]any{"type": "project_offer", "offer": offer})
		a.chat.sendAdmins(map[string]any{"type": "project_offer", "offer": offer, "thread_id": thread})
	}
	if next == "paid" || next == "payment_approved" {
		go a.notifyAcceptedPayment(offerID)
	}
	return next, nil
}

func (a *app) refreshCheckoutStatus(ctx context.Context, attempt string) (string, error) {
	var sessionID, status string
	err := a.db.QueryRowContext(ctx, `SELECT checkout_session_id,status FROM portfolio.project_payment_attempts WHERE id=$1`, attempt).Scan(&sessionID, &status)
	if err != nil {
		return "", err
	}
	if status == "paid" {
		return "paid", nil
	}
	if status != "pending" {
		return status, nil
	}
	session, err := queryPayMongoCheckout(ctx, sessionID)
	if err != nil {
		return "", err
	}
	if session.Attributes.Reference != attempt {
		return "", errCheckoutNotVerified
	}
	return a.commitConfirmedCheckout(ctx, session)
}
func (a *app) adminVerifyTransaction(w http.ResponseWriter, r *http.Request) {
	if !a.allow(r, "admin-payment-refresh", 30, time.Hour) {
		writeError(w, 429, "Please wait before checking again.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 16*time.Second)
	defer cancel()
	status, err := a.refreshCheckoutStatus(ctx, r.PathValue("id"))
	if err != nil {
		if errors.Is(err, errCheckoutNotVerified) {
			writeJSON(w, 200, map[string]any{"verified": false, "message": "Payment not yet confirmed by PayMongo."})
			return
		}
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, 404, "Transaction not found.")
			return
		}
		writeError(w, 503, "Could not confirm payment. Check your webhook configuration and retry later.")
		return
	}
	writeJSON(w, 200, map[string]any{"verified": status == "paid" || status == "payment_approved" || status == "already_processed", "status": status})
}
func (a *app) publicVerifyOffer(w http.ResponseWriter, r *http.Request) {
	if !a.allow(r, "visitor-payment-refresh", 25, time.Hour) {
		writeError(w, 429, "Please wait before checking again.")
		return
	}
	thread, err := a.currentChatThread(r)
	if err != nil {
		writeError(w, 401, "Return to your original chat to check the payment.")
		return
	}
	offer, err := a.getOffer(r.PathValue("id"))
	if err != nil || offer.ThreadID != thread {
		writeError(w, 404, "Project not found in this chat.")
		return
	}
	var attempt, status string
	err = a.db.QueryRow(`SELECT id,status FROM portfolio.project_payment_attempts WHERE offer_id=$1 ORDER BY created_at DESC LIMIT 1`, offer.ID).Scan(&attempt, &status)
	if err != nil {
		writeJSON(w, 200, map[string]any{"verified": false, "message": "No checkout has been created yet."})
		return
	}
	if status != "pending" {
		writeJSON(w, 200, map[string]any{"verified": status == "paid", "status": status})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 16*time.Second)
	defer cancel()
	updated, e := a.refreshCheckoutStatus(ctx, attempt)
	if e != nil {
		writeJSON(w, 200, map[string]any{"verified": false, "message": "Still awaiting trusted payment confirmation."})
		return
	}
	writeJSON(w, 200, map[string]any{"verified": updated == "paid" || updated == "payment_approved" || updated == "already_processed", "status": updated})
}

// Background reconciliation safely repairs payment updates missed during an
// outage. Webhooks remain primary. Only server-created, pending sessions are
// checked; commitConfirmedCheckout independently verifies amount, reference,
// currency, livemode and single-credit idempotency. Never mark redirects paid.
func (a *app) reconcilePendingPayments(ctx context.Context) {
	if a.db == nil {
		return
	}
	key := strings.TrimSpace(os.Getenv("PAYMONGO_SECRET"))
	if (!strings.HasPrefix(key, "sk_test_") && !strings.HasPrefix(key, "sk_live_")) ||
		(strings.HasPrefix(key, "sk_live_") && os.Getenv("PAYMONGO_ALLOW_LIVE") != "true") {
		return
	}
	ticker := time.NewTicker(25 * time.Second)
	// Failed/unpaid attempts may remain pending for hours. Do not contact the
	// PayMongo API on every tick for the same checkout; webhooks are primary.
	lastChecked := make(map[string]time.Time)
	defer ticker.Stop()
	// Allow webhooks time to arrive before fetching. Pending attempts are
	// limited to a recent window and a small batch, to respect API quotas.
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		cycle, cancel := context.WithTimeout(ctx, 52*time.Second)
		rows, err := a.db.QueryContext(cycle, `SELECT id FROM portfolio.project_payment_attempts WHERE status='pending' AND created_at > NOW()-INTERVAL '48 hours' AND created_at < NOW()-INTERVAL '10 seconds' ORDER BY created_at DESC LIMIT 8`)
		if err != nil {
			cancel()
			continue
		}
		ids := []string{}
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil {
				ids = append(ids, id)
			}
		}
		scanErr := rows.Err()
		rows.Close()
		if scanErr == nil {
			now := time.Now()
			for key, last := range lastChecked {
				if now.Sub(last) > 2*time.Hour {
					delete(lastChecked, key)
				}
			}
			for _, id := range ids {
				if cycle.Err() != nil {
					break
				}
				if last, ok := lastChecked[id]; ok && now.Sub(last) < 65*time.Second {
					continue
				}
				lastChecked[id] = now
				_, _ = a.refreshCheckoutStatus(cycle, id)
			}
		}
		cancel()
	}
}
