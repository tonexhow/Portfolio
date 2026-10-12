package application

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"html"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"os"
	"regexp"
	"strings"
	"time"
)

// sendHTMLEmail sends a standards-compliant multipart/alternative email. The
// SMTP account remains the envelope sender and From address: using a different,
// unverified From identity can break SPF/DMARC alignment. DKIM signing is the
// responsibility of the configured mail provider, not this HTML template.
func (a *app) sendHTMLEmail(recipient, subject, body string) error {
	recipient = strings.TrimSpace(strings.ToLower(recipient))
	if !validEmail(recipient) {
		return fmt.Errorf("invalid email recipient")
	}
	if strings.TrimSpace(a.smtpUser) == "" || strings.TrimSpace(a.smtpPass) == "" {
		return fmt.Errorf("smtp is not configured")
	}
	fromAddress, err := mail.ParseAddress(strings.TrimSpace(a.smtpUser))
	if err != nil || fromAddress.Address != strings.TrimSpace(a.smtpUser) {
		return fmt.Errorf("invalid SMTP sender address")
	}
	message, err := prepareSMTPMessage(fromAddress.Address, recipient, subject, body)
	if err != nil {
		return err
	}
	addr := net.JoinHostPort(a.smtpHost, a.smtpPort)
	auth := smtp.PlainAuth("", a.smtpUser, a.smtpPass, a.smtpHost)
	// An accepted SMTP DATA response is NOT guaranteed final delivery; an
	// asynchronous rejection/bounce may still be returned by the recipient.
	return smtp.SendMail(addr, auth, fromAddress.Address, []string{recipient}, message)
}

func prepareSMTPMessage(from, to, subject, body string) ([]byte, error) {
	if !validEmail(to) || !validEmail(from) {
		return nil, fmt.Errorf("invalid mail address")
	}
	subject = strings.TrimSpace(strings.NewReplacer("\r", " ", "\n", " ").Replace(subject))
	if subject == "" {
		subject = "JPano.dev"
	}
	// A bounded subject prevents excessively long headers; mail.QEncoding
	// also protects non-ASCII subjects in strict mail clients.
	if len([]rune(subject)) > 170 {
		subject = string([]rune(subject)[:170])
	}
	fromHeader := (&mail.Address{Name: "JPano.dev", Address: from}).String()
	toHeader := (&mail.Address{Address: to}).String()
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return nil, err
	}
	domain := strings.SplitN(from, "@", 2)[1]
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	// Preserve generated boundary, which is random and standards-conformant.
	headers := []string{
		"From: " + fromHeader,
		"To: " + toHeader,
		"Reply-To: " + (&mail.Address{Address: from}).String(),
		"Subject: " + mime.QEncoding.Encode("UTF-8", subject),
		"Date: " + time.Now().Format(time.RFC1123Z),
		"Message-ID: <" + hex.EncodeToString(id[:]) + "@" + domain + ">",
		"MIME-Version: 1.0",
		"Content-Type: multipart/alternative; boundary=" + fmt.Sprintf("%q", writer.Boundary()),
	}
	for _, header := range headers {
		if _, err := io.WriteString(&buf, header+"\r\n"); err != nil {
			return nil, err
		}
	}
	if _, err := io.WriteString(&buf, "\r\n"); err != nil {
		return nil, err
	}
	for _, part := range []struct{ contentType, content string }{
		{"text/plain; charset=UTF-8", plainTextFromEmailHTML(body)},
		{"text/html; charset=UTF-8", body},
	} {
		h := make(textproto.MIMEHeader)
		h.Set("Content-Type", part.contentType)
		h.Set("Content-Transfer-Encoding", "quoted-printable")
		output, err := writer.CreatePart(h)
		if err != nil {
			return nil, err
		}
		qp := quotedprintable.NewWriter(output)
		if _, err := io.WriteString(qp, normalizeEmailLineEndings(part.content)); err != nil {
			return nil, err
		}
		if err := qp.Close(); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func normalizeEmailLineEndings(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	return strings.ReplaceAll(s, "\n", "\r\n")
}

var emailStyleElement = regexp.MustCompile(`(?is)<(?:style|head|script)\b[^>]*>.*?</(?:style|head|script)>`)
var emailBlockBreak = regexp.MustCompile(`(?i)<\s*(?:br\s*/?|/p|/div|/h[1-6]|/tr|/table|/li)\s*>`)
var emailAllTags = regexp.MustCompile(`(?s)<[^>]*>`)

func plainTextFromEmailHTML(body string) string {
	body = emailStyleElement.ReplaceAllString(body, "")
	body = emailBlockBreak.ReplaceAllString(body, "\n")
	body = emailAllTags.ReplaceAllString(body, "")
	body = html.UnescapeString(body)
	lines := strings.Split(normalizeEmailLineEndings(body), "\r\n")
	result := make([]string, 0, len(lines))
	blank := false
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			if len(result) > 0 && !blank {
				result = append(result, "")
			}
			blank = true
			continue
		}
		result = append(result, line)
		blank = false
	}
	return strings.TrimSpace(strings.Join(result, "\n"))
}

func emailHTMLText(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	return strings.ReplaceAll(html.EscapeString(value), "\n", "<br>")
}

// The owner controls the display signature; the AI must never guess it.
// The default is the portfolio owner's published professional name.
func emailSignatureName() string {
	name := strings.TrimSpace(os.Getenv("EMAIL_SIGNATURE_NAME"))
	if name == "" {
		name = "Jhon Anthony Pano"
	}
	name = strings.NewReplacer("\r", " ", "\n", " ", "<", "", ">", "").Replace(name)
	if len([]rune(name)) > 100 {
		name = string([]rune(name)[:100])
	}
	return name
}

func emailSignatureHTML() string {
	return `<p style="font-size:14px;line-height:1.7;color:#334155;margin:24px 0 0">Best regards,<br><strong style="color:#0f172a">` + html.EscapeString(emailSignatureName()) + `</strong><br><a href="https://jpano.dev" style="color:#15803d;text-decoration:none">JPano.dev</a></p>`
}

func brandedPortfolioEmail(kicker, heading, contentHTML, notice string) string {
	return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>` + html.EscapeString(heading) + `</title></head><body style="margin:0;padding:0;background:#f3f6f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f6f9"><tr><td align="center" style="padding:28px 12px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;border-collapse:separate;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px"><tr><td style="padding:22px 28px;background:#152135;border-radius:16px 16px 0 0;color:#ffffff;font-size:22px;font-weight:bold">JPano<span style="color:#4ade80">.dev</span></td></tr><tr><td style="padding:28px"><p style="margin:0;color:#15803d;text-transform:uppercase;font-size:11px;letter-spacing:1.1px;font-weight:bold">` + html.EscapeString(kicker) + `</p><h1 style="margin:12px 0 20px;font-size:25px;line-height:1.3;color:#0f172a">` + html.EscapeString(heading) + `</h1><div style="font-size:14px;line-height:1.75;color:#334155">` + contentHTML + `</div>` + emailSignatureHTML() + `</td></tr><tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px;line-height:1.6">` + html.EscapeString(notice) + `</td></tr></table><p style="color:#94a3b8;font-size:11px;margin:18px 0 0">JPano.dev · Professional portfolio</p></td></tr></table></body></html>`
}
