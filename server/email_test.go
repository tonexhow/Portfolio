package main

import (
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"strings"
	"testing"
)

func TestAIEmailDoesNotLeaveUnfinishedSignature(t *testing.T) {
	t.Setenv("EMAIL_SIGNATURE_NAME", "Jhon Anthony Pano")
	for _, original := range []string{
		"Thank you for contacting me.\n\nBest regards,\n[Your Name]",
		"Thank you for the payment.\n\nSincerely,\n[Your Name/Team]",
		"Thank you for getting in touch.\n\nKind regards,\n[Your Name]",
		"Thank you for your message.\n\nBest regards, [Your Name/Team]",
	} {
		cleaned := normalizeAIEmailDraft(original)
		if !strings.HasPrefix(cleaned, "Thank you") || strings.Contains(cleaned, "[Your Name") || strings.Contains(cleaned, "Best regards") || strings.Contains(cleaned, "Sincerely,") {
			t.Fatalf("AI email still has a signature placeholder: %q", cleaned)
		}
		final := brandedPortfolioEmail("Inquiry", "Thanks", emailHTMLText(cleaned), "Auto-generated")
		if strings.Count(final, "Jhon Anthony Pano") != 1 || strings.Contains(final, "[Your Name") {
			t.Fatal("final email must contain exactly one real owner signature")
		}
	}
}

func TestPaymentAcknowledgementUsesVerifiedFacts(t *testing.T) {
	t.Setenv("EMAIL_SIGNATURE_NAME", "Jhon Anthony Pano")
	body := paymentAcknowledgementHTML("Site <unsafe>", "payment_approved", 100, 13500)
	for _, expected := range []string{"Downpayment confirmed", "₱1.00", "₱135.00", "Jhon Anthony Pano", "Site &lt;unsafe&gt;"} {
		if !strings.Contains(body, expected) {
			t.Errorf("receipt missing %q", expected)
		}
	}
	for _, forbidden := range []string{"[Your Name]", "Your Name/Team", "AI assistance", "<unsafe>"} {
		if strings.Contains(body, forbidden) {
			t.Errorf("receipt includes unwanted content %q", forbidden)
		}
	}
	if !strings.Contains(paymentAcknowledgementHTML("Site", "paid", 13500, 13500), "Fully paid") {
		t.Error("fully paid status must be distinct from downpayment")
	}
}

func TestSMTPMessageIsAlternativeMime(t *testing.T) {
	body := brandedPortfolioEmail("Notice", "Project payment received", `<p>₱1.00 received.</p>`, "Automated")
	raw, err := prepareSMTPMessage("sender@gmail.com", "visitor@example.com", "₱ Project payment", body)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := mail.ReadMessage(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	mediaType, params, err := mime.ParseMediaType(parsed.Header.Get("Content-Type"))
	if err != nil || mediaType != "multipart/alternative" {
		t.Fatalf("expected multipart/alternative MIME, got %q (%v)", mediaType, err)
	}
	sender, err := mail.ParseAddress(parsed.Header.Get("From"))
	if err != nil || sender.Address != "sender@gmail.com" || sender.Name != "JPano.dev" {
		t.Fatalf("unexpected sender: %q (%v)", parsed.Header.Get("From"), err)
	}
	reader := multipart.NewReader(parsed.Body, params["boundary"])
	var parts []string
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := io.ReadAll(quotedprintable.NewReader(part))
		if err != nil {
			t.Fatal(err)
		}
		parts = append(parts, string(decoded))
	}
	if len(parts) != 2 || !strings.Contains(parts[0], "₱1.00 received") || !strings.Contains(parts[1], "<html") {
		t.Fatalf("expected usable text and HTML alternatives, got %d parts", len(parts))
	}
}
