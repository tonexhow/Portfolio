package content

import "testing"

func TestPublicIdentityMasking(t *testing.T) {
	if got := maskFeedbackName("Alice Smith"); got != "A**** S****" {
		t.Errorf("unexpected masked name %q", got)
	}
	if got := maskFeedbackCredential("alice@example.com"); got != "a***@e***.com" {
		t.Errorf("unexpected masked credential %q", got)
	}
	if got := maskFeedbackCredential(""); got != "" {
		t.Error("empty credential changed")
	}
}
