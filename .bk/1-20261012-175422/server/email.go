package main

import (
	"fmt"
	"html"
	"mime"
	"net"
	"net/smtp"
	"strings"
)

func (a *app) sendHTMLEmail(recipient, subject, body string) error {
	recipient = strings.TrimSpace(strings.ToLower(recipient))
	if !validEmail(recipient) {
		return fmt.Errorf("invalid email recipient")
	}
	if strings.TrimSpace(a.smtpUser) == "" || strings.TrimSpace(a.smtpPass) == "" {
		return fmt.Errorf("smtp is not configured")
	}

	subject = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(subject, "\r", " "), "\n", " "))
	if subject == "" {
		subject = "JPano.dev"
	}
	encodedSubject := mime.QEncoding.Encode("UTF-8", subject)
	from := fmt.Sprintf("JPano.dev <%s>", a.smtpUser)

	message := strings.Join([]string{
		"From: " + from,
		"To: " + recipient,
		"Reply-To: " + a.smtpUser,
		"Subject: " + encodedSubject,
		"MIME-Version: 1.0",
		`Content-Type: text/html; charset="UTF-8"`,
		`Content-Transfer-Encoding: 8bit`,
		"",
		body,
	}, "\r\n")

	addr := net.JoinHostPort(a.smtpHost, a.smtpPort)
	auth := smtp.PlainAuth("", a.smtpUser, a.smtpPass, a.smtpHost)
	return smtp.SendMail(addr, auth, a.smtpUser, []string{recipient}, []byte(message))
}

func emailHTMLText(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	return strings.ReplaceAll(html.EscapeString(value), "\n", "<br>")
}
