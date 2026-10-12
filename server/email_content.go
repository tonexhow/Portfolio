package main

import (
	"regexp"
	"strings"
)

var generatedNamePlaceholder = regexp.MustCompile(`(?i)\[\s*(?:your\s+name(?:\s*/\s*team)?|your\s+team|name\s*/\s*team|sender\s+name|your\s+full\s+name)\s*\]`)
var generatedSignOff = regexp.MustCompile(`(?i)^(?:(?:best|kind|warm)\s+regards|regards|sincerely|cheers|yours\s+(?:truly|sincerely))[,.!]?\s*(?:\[\s*(?:your\s+name(?:\s*/\s*team)?|your\s+team|name\s*/\s*team)\s*\])?\s*$`)

// AI may include "Best regards, [Your Name]" or other draft tokens. Keep the
// actual message but remove its unfinished closing; the server signs the final
// email with the configured owner name exactly once.
func normalizeAIEmailDraft(raw string) string {
	raw = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(raw, "\r\n", "\n"), "\r", "\n"))
	lines := strings.Split(raw, "\n")
	// Only treat an obvious signoff in the final part of the message as a
	// signature. Do not truncate paragraphs discussing the word "regards".
	start := len(lines) - 7
	if start < 0 {
		start = 0
	}
	for i := start; i < len(lines); i++ {
		if generatedSignOff.MatchString(strings.TrimSpace(lines[i])) {
			lines = lines[:i]
			break
		}
	}
	raw = strings.TrimSpace(strings.Join(lines, "\n"))
	// Unknown placeholders are never permitted in customer-facing email.
	raw = generatedNamePlaceholder.ReplaceAllString(raw, emailSignatureName())
	return strings.TrimSpace(raw)
}
