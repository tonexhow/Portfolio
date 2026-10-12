package application

import "jpano.dev/portfolio/internal/mailer"

func normalizeAIEmailDraft(raw string) string {
	return mailer.NormalizeDraft(raw, emailSignatureName())
}
