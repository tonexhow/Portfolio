package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"jpano.dev/portfolio/internal/content"
	"net/http"
	"strings"
	"time"
)

func (a *app) publicSnapshot(w http.ResponseWriter, r *http.Request) {
	snapshot, err := content.Load(r.Context(), a.db)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "Portfolio updates are temporarily unavailable.")
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}
func (a *app) publicInformation(w http.ResponseWriter, r *http.Request) {
	var raw json.RawMessage
	if err := a.db.QueryRowContext(r.Context(), `SELECT content FROM personal_information WHERE id=1`).Scan(&raw); err != nil {
		writeError(w, http.StatusServiceUnavailable, "Portfolio information is temporarily unavailable.")
		return
	}
	writeRawJSON(w, http.StatusOK, raw)
}
func (a *app) publicProfiles(w http.ResponseWriter, r *http.Request) {
	var raw []byte
	if err := a.db.QueryRowContext(r.Context(), `SELECT COALESCE(content->'profile_images','[]'::jsonb) FROM personal_information WHERE id=1`).Scan(&raw); err != nil {
		writeError(w, http.StatusServiceUnavailable, "Profile images are temporarily unavailable.")
		return
	}
	items := []string{}
	_ = json.Unmarshal(raw, &items)
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "rotation_seconds": 60})
}
func (a *app) adminInformation(w http.ResponseWriter, r *http.Request) {
	var raw json.RawMessage
	var updated time.Time
	var version int64
	if err := a.db.QueryRowContext(r.Context(), `SELECT content,version,updated_at FROM personal_information WHERE id=1`).Scan(&raw, &version, &updated); err != nil {
		writeError(w, http.StatusServiceUnavailable, "Unable to read portfolio information.")
		return
	}
	var value any
	_ = json.Unmarshal(raw, &value)
	pretty, _ := json.MarshalIndent(value, "", "  ")
	writeJSON(w, http.StatusOK, map[string]any{"content": string(pretty), "valid": true, "modified_at": updated, "version": version})
}
func validateInformation(raw []byte) error {
	if len(raw) == 0 || len(raw) > 512*1024 {
		return errors.New("Portfolio information must be between 1 byte and 512 KB.")
	}
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) != nil || object == nil {
		return errors.New("Portfolio information must be a JSON object.")
	}
	var name struct {
		Full string `json:"full"`
	}
	if json.Unmarshal(object["name"], &name) != nil || strings.TrimSpace(name.Full) == "" {
		return errors.New("name.full is required.")
	}
	for _, key := range []string{"contact", "education", "experience", "skills", "portfolio", "greeting"} {
		if v, ok := object[key]; ok {
			var m map[string]json.RawMessage
			if json.Unmarshal(v, &m) != nil || m == nil {
				return errors.New(key + " must be an object.")
			}
		}
	}
	for _, key := range []string{"role", "headline", "intro", "location"} {
		if v, ok := object[key]; ok {
			var text string
			if json.Unmarshal(v, &text) != nil {
				return errors.New(key + " must be text.")
			}
		}
	}
	if v, ok := object["profile_images"]; ok {
		var images []string
		if json.Unmarshal(v, &images) != nil || len(images) > 20 {
			return errors.New("profile_images must contain up to 20 image paths or URLs.")
		}
		for _, image := range images {
			if !validMediaURL(image) {
				return errors.New("A profile image URL is not allowed.")
			}
		}
	}

	// Typed structural validation prevents a valid-but-incompatible JSON edit from
	// breaking every public page. Unknown extension fields remain allowed.
	type job struct {
		CompanyName      string   `json:"company_name"`
		Position         string   `json:"position"`
		StartDate        string   `json:"start_date"`
		EndDate          string   `json:"end_date"`
		Responsibilities []string `json:"responsibilities"`
	}
	type education struct {
		SchoolName    string `json:"school_name"`
		SchoolAddress string `json:"school_address"`
		Course        string `json:"course"`
		Strand        string `json:"strand"`
		YearGraduated string `json:"year_graduated"`
	}
	var shape struct {
		Contact struct {
			Email  string            `json:"email"`
			Links  map[string]string `json:"links"`
			Mobile []string          `json:"mobile"`
		} `json:"contact"`
		Greeting struct {
			Morning   string   `json:"morning"`
			Afternoon string   `json:"afternoon"`
			Evening   string   `json:"evening"`
			Messages  []string `json:"messages"`
		} `json:"greeting"`
		Experience struct {
			Current  *job  `json:"current"`
			Previous []job `json:"previous"`
		} `json:"experience"`
		Education map[string]education `json:"education"`
		Skills    struct {
			IT   map[string][]string `json:"it"`
			Soft []string            `json:"soft"`
		} `json:"skills"`
		Portfolio struct {
			CapstoneCount int `json:"capstone_count"`
			Earnings      struct {
				Currency string  `json:"currency"`
				Min      float64 `json:"min"`
				Max      float64 `json:"max"`
				Label    string  `json:"label"`
			} `json:"earnings"`
			Projects struct {
				Count          int    `json:"count"`
				Intro          string `json:"intro"`
				VisibilityNote string `json:"visibility_note"`
			} `json:"projects"`
			AboutTemplates []string `json:"about_templates"`
			TabMessages    []string `json:"tab_messages"`
		} `json:"portfolio"`
	}
	if err := json.Unmarshal(raw, &shape); err != nil {
		return errors.New("A profile field has an incompatible value. Keep text, number, object, and list fields in their existing formats.")
	}
	for _, link := range shape.Contact.Links {
		if strings.TrimSpace(link) != "" && !safePublicURL(link) {
			return errors.New("Social links must be public HTTP or HTTPS URLs.")
		}
	}
	if shape.Contact.Email != "" && !validEmail(shape.Contact.Email) {
		return errors.New("Enter a valid public contact email.")
	}
	currency := shape.Portfolio.Earnings.Currency
	if currency != "" {
		if len(currency) != 3 {
			return errors.New("Use a three-letter currency code such as PHP.")
		}
		for _, c := range currency {
			if c < 'A' || c > 'Z' {
				return errors.New("Currency codes must use three uppercase letters.")
			}
		}
	}
	return nil
}
func (a *app) adminSaveInformation(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Content     string `json:"content"`
		ChallengeID string `json:"challenge_id"`
		Key         string `json:"key"`
		Version     int64  `json:"version"`
	}
	if decodeJSONWithLimit(r, &in, 1<<20) != nil {
		writeError(w, http.StatusBadRequest, "Invalid save request.")
		return
	}
	raw := []byte(strings.TrimSpace(in.Content))
	if err := validateInformation(raw); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if in.Version < 1 {
		writeError(w, http.StatusConflict, "Reload the current information before saving.")
		return
	}
	if !a.consumeChallenge(in.ChallengeID, in.Key, clientIP(r)) {
		writeError(w, http.StatusUnauthorized, "The save challenge is incorrect or expired.")
		return
	}
	var version int64
	var saved time.Time
	err := a.db.QueryRowContext(r.Context(), `UPDATE personal_information SET content=$1::jsonb,version=version+1,updated_at=clock_timestamp() WHERE id=1 AND version=$2 RETURNING version,updated_at`, string(raw), in.Version).Scan(&version, &saved)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusConflict, "Another page updated this information. Reload and review your changes before saving.")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to save portfolio information. Nothing was changed.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"message": "Portfolio information saved. Connected pages are syncing.", "version": version, "saved_at": saved})
}
