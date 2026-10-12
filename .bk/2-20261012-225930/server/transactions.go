package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Financial history is only accessible through the existing authenticated
// Admin session. Never publish all customer emails or payment IDs to visitors.
func (a *app) adminTransactions(w http.ResponseWriter, r *http.Request) {
	status := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status")))
	archiveView := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("archived")))
	if archiveView != "all" && archiveView != "archived" && archiveView != "active" && archiveView != "" {
		writeError(w, 400, "Invalid transaction archive filter.")
		return
	}
	if status != "" && status != "pending" && status != "paid" && status != "failed" {
		writeError(w, 400, "Invalid transaction filter.")
		return
	}
	p := 1
	if _, err := fmt.Sscan(r.URL.Query().Get("page"), &p); err != nil || p < 1 {
		p = 1
	}
	if p > 10000 {
		p = 10000
	}
	where := ""
	args := []any{}
	if archiveView == "archived" {
		where = " WHERE a.archived_at IS NOT NULL"
	} else if archiveView != "all" {
		where = " WHERE a.archived_at IS NULL"
	}
	if status != "" {
		if where == "" {
			where = " WHERE "
		} else {
			where += " AND "
		}
		where += "a.status=?"
		args = append(args, status)
	}
	var total int
	if err := a.db.QueryRow(`SELECT COUNT(*) FROM portfolio.project_payment_attempts a`+where, args...).Scan(&total); err != nil {
		writeError(w, 503, "Unable to load transactions.")
		return
	}
	args = append(args, 25, (p-1)*25)
	rows, err := a.db.Query(`SELECT a.id,a.offer_id,a.amount_centavos,a.checkout_session_id,COALESCE(a.payment_id,''),a.status,a.customer_email,a.customer_phone,a.created_at,a.paid_at,o.description,a.archived_at,o.title,o.price_centavos,o.paid_centavos,o.status,COALESCE(NULLIF(o.owner_name,''),t.visitor_auth_name,''),COALESCE(NULLIF(o.owner_provider,''),t.visitor_auth_provider,'')
 FROM portfolio.project_payment_attempts a JOIN portfolio.project_offers o ON o.id=a.offer_id
 LEFT JOIN chat_threads t ON t.id=o.thread_id`+where+` ORDER BY a.created_at DESC LIMIT ? OFFSET ?`, args...)
	if err != nil {
		writeError(w, 503, "Unable to read transaction history.")
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, offer, session, payment, status, email, phone, title, description, projectStatus, owner, ownerProvider string
		var amount, price, paid int64
		var created time.Time
		var paidAt, archivedAt sql.NullTime
		if rows.Scan(&id, &offer, &amount, &session, &payment, &status, &email, &phone, &created, &paidAt, &description, &archivedAt, &title, &price, &paid, &projectStatus, &owner, &ownerProvider) != nil {
			continue
		}
		item := map[string]any{"id": id, "offer_id": offer, "amount_centavos": amount, "checkout_session_id": session, "payment_id": payment, "status": status, "customer_email": email, "customer_phone": phone, "created_at": created, "project_title": title, "project_description": description, "archived": archivedAt.Valid, "project_price_centavos": price, "project_paid_centavos": paid, "project_status": projectStatus, "owner_name": owner, "owner_provider": ownerProvider}
		if paidAt.Valid {
			item["paid_at"] = paidAt.Time
		}
		items = append(items, item)
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": total, "page": p, "pages": (total + 24) / 25})
}

// A one-off acceptance email is only triggered from a committed, verified
// downpayment or full-payment webhook. Never from the visitor's redirect.
func (a *app) notifyAcceptedPayment(offerID string) {
	if strings.TrimSpace(a.smtpUser) == "" || strings.TrimSpace(a.smtpPass) == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 28*time.Second)
	defer cancel()
	var recipient, title, status string
	var paid, total int64
	err := a.db.QueryRowContext(ctx, `UPDATE portfolio.project_offers SET acceptance_email_sent_at=NOW() WHERE id=$1 AND acceptance_email_sent_at IS NULL AND status IN ('payment_approved','paid') AND contact_email<>'' RETURNING contact_email,title,status,paid_centavos,price_centavos`, offerID).Scan(&recipient, &title, &status, &paid, &total)
	if err != nil || !validEmail(recipient) {
		return
	}
	// Transactional receipts are generated from committed payment records,
	// NEVER rewritten by AI or filled with invented customer details.
	htmlBody := paymentAcknowledgementHTML(title, status, paid, total)
	if err := a.sendHTMLEmail(recipient, "JPano · Project payment verified", htmlBody); err != nil {
		_, _ = a.db.Exec(`UPDATE portfolio.project_offers SET acceptance_email_sent_at=NULL WHERE id=?`, offerID)
	}
}

// paymentAcknowledgementHTML is deliberately deterministic. paid_centavos is
// the cumulative amount received, not necessarily the latest installment.
func paymentAcknowledgementHTML(title, status string, paid, total int64) string {
	statusLabel := "Downpayment confirmed"
	if status == "paid" {
		statusLabel = "Fully paid"
	}
	content := fmt.Sprintf(`<p style="margin:0 0 15px">Hello,</p><p style="margin:0 0 16px">A payment has been verified for the project <strong>%s</strong>.</p><table role="presentation" cellpadding="0" cellspacing="0" width="100%%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px"><tr><td style="padding:15px 18px;font-size:13px;color:#64748b">Payment status</td><td align="right" style="padding:15px 18px;font-weight:bold;color:#15803d">%s</td></tr><tr><td style="padding:10px 18px;font-size:13px;color:#64748b">Total received to date</td><td align="right" style="padding:10px 18px;font-weight:bold;color:#0f172a">₱%.2f</td></tr><tr><td style="padding:15px 18px;font-size:13px;color:#64748b">Total project price</td><td align="right" style="padding:15px 18px;font-weight:bold;color:#0f172a">₱%.2f</td></tr></table><p style="margin:18px 0 0">Thank you for your payment. If you have any questions about your project, simply reply to this email.</p>`, emailHTMLText(title), statusLabel, float64(paid)/100, float64(total)/100)
	return brandedPortfolioEmail("Verified project payment", "Project payment received", content, "This is an automated acknowledgement based on a payment verified by the server. It is not a tax invoice or official receipt.")
}

// Archive a record without touching its gateway status or the paid balance.
// Paid records are never physically deleted, so reports remain reconstructable.
func (a *app) adminArchiveTransaction(w http.ResponseWriter, r *http.Request) {
	result, err := a.db.Exec(`UPDATE portfolio.project_payment_attempts SET archived_at=COALESCE(archived_at,NOW()) WHERE id=?`, r.PathValue("id"))
	if err != nil {
		writeError(w, 503, "Transaction could not be archived.")
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		writeError(w, 404, "Transaction not found.")
		return
	}
	writeJSON(w, 200, map[string]any{"archived": true, "paid_balance_preserved": true})
}
func (a *app) adminClearPaidTransactions(w http.ResponseWriter, r *http.Request) {
	result, err := a.db.Exec(`UPDATE portfolio.project_payment_attempts SET archived_at=NOW() WHERE status='paid' AND archived_at IS NULL`)
	if err != nil {
		writeError(w, 503, "Unable to archive paid records.")
		return
	}
	count, _ := result.RowsAffected()
	writeJSON(w, 200, map[string]any{"archived_count": count, "paid_balance_preserved": true})
}
