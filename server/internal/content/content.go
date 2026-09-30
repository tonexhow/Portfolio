// Package content returns only publishable data. Sessions, messages, drafts and
// hidden certificates/projects never enter a public snapshot or static export.
package content

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"jpano.dev/portfolio/internal/database"
	"strings"
	"time"
)

type Project struct {
	Key          string     `json:"key"`
	Source       string     `json:"source"`
	Editable     bool       `json:"editable"`
	Name         string     `json:"name"`
	Description  string     `json:"description"`
	URL          string     `json:"url"`
	SourceURL    string     `json:"source_url"`
	Type         string     `json:"type"`
	Stack        []string   `json:"stack"`
	Icon         string     `json:"icon"`
	Images       []string   `json:"images"`
	Status       string     `json:"status"`
	CheckedAt    *time.Time `json:"checked_at"`
	Visible      bool       `json:"visible"`
	DisplayOrder int        `json:"display_order"`
}
type Certificate struct {
	ID          int64  `json:"id"`
	Date        string `json:"date"`
	Provider    string `json:"provider"`
	Pinned      bool   `json:"pinned"`
	ImageURL    string `json:"image_url"`
	DownloadURL string `json:"download_url"`
}
type Feedback struct {
	ID           int64     `json:"id"`
	DisplayName  string    `json:"display_name"`
	Rating       int       `json:"rating"`
	Comment      string    `json:"comment"`
	Pinned       bool      `json:"pinned"`
	AuthProvider string    `json:"auth_provider"`
	Credential   string    `json:"credential"`
	AvatarURL    string    `json:"avatar_url,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}
type CareerProfile struct {
	ID           int64     `json:"id"`
	DocumentType string    `json:"document_type"`
	Title        string    `json:"title"`
	Description  string    `json:"description"`
	StorageURL   string    `json:"storage_url"`
	FileName     string    `json:"file_name"`
	FileSize     int64     `json:"file_size"`
	DisplayOrder int       `json:"display_order"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type Profiles struct {
	Items           []string `json:"items"`
	RotationSeconds int      `json:"rotation_seconds"`
}
type Snapshot struct {
	SchemaVersion  int             `json:"schema_version"`
	Revision       int64           `json:"revision"`
	UpdatedAt      time.Time       `json:"updated_at"`
	Information    json.RawMessage `json:"information"`
	Profiles       Profiles        `json:"profiles"`
	Projects       []Project       `json:"projects"`
	Certificates   []Certificate   `json:"certificates"`
	Feedback       []Feedback      `json:"feedback"`
	CareerProfiles []CareerProfile `json:"career_profiles"`
}
type Querier interface {
	Query(string, ...any) (*sql.Rows, error)
	QueryRow(string, ...any) *sql.Row
}

func LoadProjects(q Querier, public bool) ([]Project, error) {
	filter := ""
	if public {
		filter = " WHERE visible=1"
	}
	rows, err := q.Query(`SELECT id,name,description,url,source_url,type,icon,technologies_json,images_json,visible,display_order,status,checked_at FROM projects` + filter + ` ORDER BY display_order,created_at,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		var p Project
		var stack, images []byte
		var checked sql.NullTime
		if err = rows.Scan(&p.Key, &p.Name, &p.Description, &p.URL, &p.SourceURL, &p.Type, &p.Icon, &stack, &images, &p.Visible, &p.DisplayOrder, &p.Status, &checked); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(stack, &p.Stack); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(images, &p.Images); err != nil {
			return nil, err
		}
		if p.Stack == nil {
			p.Stack = []string{}
		}
		if p.Images == nil {
			p.Images = []string{}
		}
		p.Source = "database"
		p.Editable = !public
		if checked.Valid {
			t := checked.Time
			p.CheckedAt = &t
		}
		if !checked.Valid || time.Since(checked.Time) > 5*time.Minute {
			p.Status = "unknown"
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
func Load(ctx context.Context, db *database.DB) (Snapshot, error) {
	s := Snapshot{SchemaVersion: 1, Projects: []Project{}, Certificates: []Certificate{}, Feedback: []Feedback{}, CareerProfiles: []CareerProfile{}}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return s, err
	}
	defer tx.Rollback()
	if err = tx.QueryRow(`SELECT revision,updated_at FROM sync_state WHERE id=1`).Scan(&s.Revision, &s.UpdatedAt); err != nil {
		return s, err
	}
	if err = tx.QueryRow(`SELECT content FROM personal_information WHERE id=1`).Scan(&s.Information); err != nil {
		return s, err
	}
	var info struct {
		ProfileImages []string `json:"profile_images"`
	}
	if err = json.Unmarshal(s.Information, &info); err != nil {
		return s, err
	}
	s.Profiles = Profiles{Items: info.ProfileImages, RotationSeconds: 60}
	if s.Profiles.Items == nil {
		s.Profiles.Items = []string{}
	}
	if s.Projects, err = LoadProjects(tx, true); err != nil {
		return s, err
	}
	rows, err := tx.Query(`SELECT id,certificate_date,provider,pinned,md5(updated_at::text),storage_url FROM certificates WHERE visible=1 ORDER BY pinned DESC,certificate_date DESC,created_at DESC,id DESC`)
	if err != nil {
		return s, err
	}
	for rows.Next() {
		var item Certificate
		var revision, storageURL string
		if err = rows.Scan(&item.ID, &item.Date, &item.Provider, &item.Pinned, &revision, &storageURL); err != nil {
			rows.Close()
			return s, err
		}
		if strings.TrimSpace(storageURL) != "" {
			item.ImageURL = storageURL
			item.DownloadURL = storageURL + "?download"
		} else {
			item.ImageURL = fmt.Sprintf("/api/public/certificates/%d/image?v=%s", item.ID, revision)
			item.DownloadURL = fmt.Sprintf("/api/public/certificates/%d/download", item.ID)
		}
		s.Certificates = append(s.Certificates, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return s, err
	}
	rows, err = tx.Query(`SELECT id,document_type,title,description,storage_url,file_name,file_size,display_order,updated_at FROM career_profiles WHERE visible=1 ORDER BY display_order,updated_at DESC,id DESC`)
	if err != nil {
		return s, err
	}
	for rows.Next() {
		var item CareerProfile
		if err = rows.Scan(&item.ID, &item.DocumentType, &item.Title, &item.Description, &item.StorageURL, &item.FileName, &item.FileSize, &item.DisplayOrder, &item.UpdatedAt); err != nil {
			rows.Close()
			return s, err
		}
		s.CareerProfiles = append(s.CareerProfiles, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return s, err
	}

	rows, err = tx.Query(`SELECT id,display_name,rating,comment,pinned,auth_provider,credential,profile_url,created_at FROM feedback WHERE status='approved' ORDER BY pinned DESC,created_at DESC,id DESC`)
	if err != nil {
		return s, err
	}
	for rows.Next() {
		var item Feedback
		var profile string
		if err = rows.Scan(&item.ID, &item.DisplayName, &item.Rating, &item.Comment, &item.Pinned, &item.AuthProvider, &item.Credential, &profile, &item.CreatedAt); err != nil {
			rows.Close()
			return s, err
		}
		if item.AuthProvider != "" && item.AuthProvider != "legacy" {
			item.DisplayName = maskFeedbackName(item.DisplayName)
			item.Credential = maskFeedbackCredential(item.Credential)
			if profile != "" {
				item.AvatarURL = fmt.Sprintf("/api/public/feedback/%d/avatar", item.ID)
			}
		}
		s.Feedback = append(s.Feedback, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return s, err
	}
	return s, tx.Commit()
}

func maskFeedbackName(name string) string {
	parts := strings.Fields(name)
	for i, part := range parts {
		runes := []rune(part)
		if len(runes) <= 1 {
			parts[i] = "*"
			continue
		}
		visible := 1
		if len(runes) >= 6 {
			visible = 2
		}
		parts[i] = string(runes[:visible]) + strings.Repeat("*", min(6, len(runes)-visible))
	}
	return strings.Join(parts, " ")
}

func maskFeedbackCredential(value string) string {
	value = strings.TrimSpace(value)
	if at := strings.Index(value, "@"); at > 0 && strings.Contains(value[at+1:], ".") {
		local := []rune(value[:at])
		domain := value[at+1:]
		domainParts := strings.SplitN(domain, ".", 2)
		maskedLocal := string(local[:1]) + "***"
		maskedDomain := "***"
		if domainParts[0] != "" {
			maskedDomain = string([]rune(domainParts[0])[:1]) + "***"
		}
		tld := ""
		if len(domainParts) == 2 {
			tld = "." + domainParts[1]
		}
		return maskedLocal + "@" + maskedDomain + tld
	}
	if strings.HasPrefix(value, "@") {
		runes := []rune(strings.TrimPrefix(value, "@"))
		if len(runes) == 0 {
			return "@***"
		}
		return "@" + string(runes[:1]) + strings.Repeat("*", min(6, max(3, len(runes)-1)))
	}
	if strings.HasPrefix(value, "Telegram ID ") || strings.HasPrefix(value, "Facebook ID ") {
		prefix, id, _ := strings.Cut(value, "ID ")
		if len(id) > 4 {
			return prefix + "ID ***" + id[len(id)-3:]
		}
		return prefix + "ID ***"
	}
	if value == "" {
		return ""
	}
	runes := []rune(value)
	return string(runes[:1]) + strings.Repeat("*", min(8, max(3, len(runes)-1)))
}
