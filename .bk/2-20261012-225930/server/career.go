package main

import (
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	mediastore "jpano.dev/portfolio/internal/storage"
)

type careerProfile struct {
	ID           int64     `json:"id"`
	DocumentType string    `json:"document_type"`
	Title        string    `json:"title"`
	Description  string    `json:"description"`
	StoragePath  string    `json:"storage_path,omitempty"`
	StorageURL   string    `json:"storage_url"`
	FileName     string    `json:"file_name"`
	FileSize     int64     `json:"file_size"`
	Visible      bool      `json:"visible"`
	DisplayOrder int       `json:"display_order"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func validCareerType(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "resume", "cv", "biodata":
		return true
	}
	return false
}

func (a *app) publicCareerProfiles(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(`SELECT id,document_type,title,description,storage_url,file_name,file_size,visible,display_order,updated_at FROM career_profiles WHERE visible=1 ORDER BY display_order,updated_at DESC,id DESC`)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "Career Profile is temporarily unavailable.")
		return
	}
	defer rows.Close()
	out := []careerProfile{}
	for rows.Next() {
		var x careerProfile
		if err = rows.Scan(&x.ID, &x.DocumentType, &x.Title, &x.Description, &x.StorageURL, &x.FileName, &x.FileSize, &x.Visible, &x.DisplayOrder, &x.UpdatedAt); err != nil {
			writeError(w, 500, "Unable to load Career Profile.")
			return
		}
		out = append(out, x)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (a *app) adminCareerProfiles(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(`SELECT id,document_type,title,description,storage_path,storage_url,file_name,file_size,visible,display_order,updated_at FROM career_profiles ORDER BY display_order,updated_at DESC,id DESC`)
	if err != nil {
		writeError(w, 500, "Unable to load Career Profile documents.")
		return
	}
	defer rows.Close()
	out := []careerProfile{}
	for rows.Next() {
		var x careerProfile
		if err = rows.Scan(&x.ID, &x.DocumentType, &x.Title, &x.Description, &x.StoragePath, &x.StorageURL, &x.FileName, &x.FileSize, &x.Visible, &x.DisplayOrder, &x.UpdatedAt); err != nil {
			writeError(w, 500, "Unable to load Career Profile documents.")
			return
		}
		out = append(out, x)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func readCareerForm(r *http.Request) (careerProfile, []byte, string, error) {
	var x careerProfile
	if err := r.ParseMultipartForm(12 << 20); err != nil {
		return x, nil, "", fmt.Errorf("invalid upload")
	}
	x.DocumentType = strings.ToLower(strings.TrimSpace(r.FormValue("document_type")))
	x.Title = clean(r.FormValue("title"), 160)
	x.Description = clean(r.FormValue("description"), 2000)
	x.Visible = r.FormValue("visible") != "false"
	x.DisplayOrder = 1
	if n, e := strconv.Atoi(r.FormValue("display_order")); e == nil && n > 0 {
		x.DisplayOrder = n
	}
	if !validCareerType(x.DocumentType) {
		return x, nil, "", fmt.Errorf("choose Resume, Curriculum Vitae, or Biodata")
	}
	if x.Title == "" {
		return x, nil, "", fmt.Errorf("title is required")
	}
	f, h, err := r.FormFile("file")
	if err == http.ErrMissingFile {
		return x, nil, "", nil
	}
	if err != nil {
		return x, nil, "", fmt.Errorf("invalid PDF upload")
	}
	defer f.Close()
	if h.Size > 10<<20 {
		return x, nil, "", fmt.Errorf("PDF must be 10 MB or smaller")
	}
	data, err := io.ReadAll(io.LimitReader(f, 10<<20+1))
	if err != nil || len(data) > 10<<20 {
		return x, nil, "", fmt.Errorf("PDF must be 10 MB or smaller")
	}
	if len(data) < 5 || string(data[:5]) != "%PDF-" {
		return x, nil, "", fmt.Errorf("only PDF documents are accepted")
	}
	return x, data, clean(h.Filename, 240), nil
}

func (a *app) adminAddCareerProfile(w http.ResponseWriter, r *http.Request) {
	if a.mediaStore == nil {
		writeError(w, http.StatusServiceUnavailable, "Supabase Storage must be configured before uploading Career Profile documents.")
		return
	}
	x, data, fileName, err := readCareerForm(r)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	if len(data) == 0 {
		writeError(w, 400, "Choose a PDF document.")
		return
	}
	token, _ := randomToken(12)
	objectPath, err := mediastore.ObjectPath("career", x.DocumentType+"-"+token, "application/pdf", data)
	if err != nil {
		writeError(w, 500, "Unable to prepare the PDF.")
		return
	}
	url, err := a.mediaStore.Upload(r.Context(), objectPath, "application/pdf", data)
	if err != nil {
		writeError(w, 502, "Unable to upload the PDF to Supabase Storage.")
		return
	}
	var id int64
	err = a.db.QueryRow(`INSERT INTO career_profiles(document_type,title,description,storage_path,storage_url,file_name,file_size,visible,display_order) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id`, x.DocumentType, x.Title, x.Description, objectPath, url, fileName, len(data), x.Visible, x.DisplayOrder).Scan(&id)
	if err != nil {
		_ = a.mediaStore.Delete(r.Context(), objectPath)
		writeError(w, 500, "Unable to save the Career Profile document.")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"message": "Career Profile document added.", "id": id})
}

func (a *app) adminUpdateCareerProfile(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		writeError(w, 400, "Invalid document.")
		return
	}
	x, data, fileName, err := readCareerForm(r)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	var oldPath, oldURL, oldName string
	var oldSize int64
	if err = a.db.QueryRow(`SELECT storage_path,storage_url,file_name,file_size FROM career_profiles WHERE id=?`, id).Scan(&oldPath, &oldURL, &oldName, &oldSize); err == sql.ErrNoRows {
		writeError(w, 404, "Document not found.")
		return
	} else if err != nil {
		writeError(w, 500, "Unable to read the document.")
		return
	}
	newPath, newURL, newName, newSize := oldPath, oldURL, oldName, oldSize
	if len(data) > 0 {
		if a.mediaStore == nil {
			writeError(w, 503, "Supabase Storage is unavailable.")
			return
		}
		token, _ := randomToken(12)
		newPath, err = mediastore.ObjectPath("career", x.DocumentType+"-"+token, "application/pdf", data)
		if err != nil {
			writeError(w, 500, "Unable to prepare the PDF.")
			return
		}
		newURL, err = a.mediaStore.Upload(r.Context(), newPath, "application/pdf", data)
		if err != nil {
			writeError(w, 502, "Unable to upload the replacement PDF.")
			return
		}
		newName = fileName
		newSize = int64(len(data))
	}
	_, err = a.db.Exec(`UPDATE career_profiles SET document_type=?,title=?,description=?,storage_path=?,storage_url=?,file_name=?,file_size=?,visible=?,display_order=?,updated_at=clock_timestamp() WHERE id=?`, x.DocumentType, x.Title, x.Description, newPath, newURL, newName, newSize, x.Visible, x.DisplayOrder, id)
	if err != nil {
		if newPath != oldPath && a.mediaStore != nil {
			_ = a.mediaStore.Delete(r.Context(), newPath)
		}
		writeError(w, 500, "Unable to update the document.")
		return
	}
	if newPath != oldPath && oldPath != "" && a.mediaStore != nil {
		_ = a.mediaStore.Delete(r.Context(), oldPath)
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Career Profile document updated."})
}

func (a *app) adminDeleteCareerProfile(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		writeError(w, 400, "Invalid document.")
		return
	}
	var path string
	if err = a.db.QueryRow(`DELETE FROM career_profiles WHERE id=? RETURNING storage_path`, id).Scan(&path); err == sql.ErrNoRows {
		writeError(w, 404, "Document not found.")
		return
	} else if err != nil {
		writeError(w, 500, "Unable to delete the document.")
		return
	}
	if path != "" && a.mediaStore != nil {
		_ = a.mediaStore.Delete(r.Context(), path)
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Career Profile document deleted."})
}
