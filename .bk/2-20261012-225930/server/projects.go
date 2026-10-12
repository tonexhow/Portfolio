package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"jpano.dev/portfolio/internal/content"
	mediastore "jpano.dev/portfolio/internal/storage"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"
)

type managedProject = content.Project

func (a *app) collectManagedProjects(_ bool) ([]managedProject, error) {
	return content.LoadProjects(a.db, false)
}
func projectPage(w http.ResponseWriter, r *http.Request, all []managedProject, limit int) {
	page := positiveInt(r.URL.Query().Get("page"), 1)
	pages := max(1, (len(all)+limit-1)/limit)
	page = min(page, pages)
	start := (page - 1) * limit
	end := min(start+limit, len(all))
	items := append([]managedProject{}, all[start:end]...)
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "page": page, "page_size": limit, "total": len(all), "total_pages": pages, "has_previous": page > 1, "has_next": page < pages})
}
func (a *app) publicProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := content.LoadProjects(a.db, true)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "Projects are temporarily unavailable.")
		return
	}
	// Nine is the public maximum, even when a caller asks for a larger page.
	projectPage(w, r, projects, min(9, positiveInt(r.URL.Query().Get("limit"), 9)))
}
func (a *app) adminProjectsPage(w http.ResponseWriter, r *http.Request) {
	all, err := a.collectManagedProjects(false)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "Unable to load projects.")
		return
	}
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	filter := r.URL.Query().Get("source")
	items := []managedProject{}
	for _, p := range all {
		if filter == "shown" && !p.Visible || filter == "hidden" && p.Visible {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(p.Name+" "+p.Description+" "+p.URL), q) {
			continue
		}
		items = append(items, p)
	}
	projectPage(w, r, items, 20)
}

type projectInput struct {
	Name         *string   `json:"name"`
	Description  *string   `json:"description"`
	URL          *string   `json:"url"`
	SourceURL    *string   `json:"source_url"`
	Type         *string   `json:"type"`
	Icon         *string   `json:"icon"`
	Technologies *[]string `json:"technologies"`
	Images       *[]string `json:"images"`
	Visible      *bool     `json:"visible"`
}

func mergeProject(p *managedProject, in projectInput) {
	if in.Name != nil {
		p.Name = strings.TrimSpace(*in.Name)
	}
	if in.Description != nil {
		p.Description = strings.TrimSpace(*in.Description)
	}
	if in.URL != nil {
		p.URL = strings.TrimSpace(*in.URL)
	}
	if in.SourceURL != nil {
		p.SourceURL = strings.TrimSpace(*in.SourceURL)
	}
	if in.Type != nil {
		p.Type = strings.TrimSpace(*in.Type)
	}
	if in.Icon != nil {
		p.Icon = strings.TrimSpace(*in.Icon)
	}
	if in.Technologies != nil {
		p.Stack = cleanStringSlice(*in.Technologies, 30, 80)
	}
	if in.Images != nil {
		p.Images = *in.Images
	}
	if in.Visible != nil {
		p.Visible = *in.Visible
	}
	if p.Stack == nil {
		p.Stack = []string{}
	}
	if p.Images == nil {
		p.Images = []string{}
	}
	if p.Type == "" {
		p.Type = "Project"
	}
}
func validateProject(p managedProject) error {
	if utf8.RuneCountInString(p.Name) < 1 || utf8.RuneCountInString(p.Name) > 160 {
		return errors.New("Enter a project title of 1 to 160 characters.")
	}
	if utf8.RuneCountInString(p.Description) > 20000 {
		return errors.New("Project descriptions can contain up to 20,000 characters.")
	}
	if utf8.RuneCountInString(p.Type) > 80 {
		return errors.New("Project type is too long.")
	}
	for _, link := range []string{p.URL, p.SourceURL} {
		if link != "" && !safePublicURL(link) {
			return errors.New("Project links must use a public HTTP or HTTPS URL.")
		}
	}
	if p.Icon != "" && !validMediaURL(p.Icon) {
		return errors.New("The logo must use an HTTPS image URL, an uploaded image or an /assets/ path.")
	}
	if len(p.Images) > 12 {
		return errors.New("Choose up to 12 project images.")
	}
	for _, image := range p.Images {
		if !validMediaURL(image) {
			return errors.New("Each project image must use an HTTPS URL, an uploaded image or an /assets/ path.")
		}
	}
	return nil
}
func validMediaURL(value string) bool {
	if strings.HasPrefix(value, "/assets/") || strings.HasPrefix(value, "/api/public/project-media/") {
		u, e := url.Parse(value)
		return e == nil && u.Host == "" && !strings.Contains(u.Path, "..") && !strings.ContainsAny(value, "\r\n\\")
	}
	u, e := url.Parse(value)
	return e == nil && u.Scheme == "https" && u.User == nil && safePublicURL(value)
}
func (a *app) adminAddProject(w http.ResponseWriter, r *http.Request) {
	var in projectInput
	if decodeJSON(r, &in) != nil {
		writeError(w, http.StatusBadRequest, "Invalid project details.")
		return
	}
	p := managedProject{Visible: true}
	mergeProject(&p, in)
	if err := validateProject(p); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	id, err := randomToken(12)
	if err != nil {
		writeError(w, 500, "Unable to create project.")
		return
	}
	stack, _ := json.Marshal(p.Stack)
	images, _ := json.Marshal(p.Images)
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, 500, "Unable to create project.")
		return
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`SELECT pg_advisory_xact_lock(724193)`); err == nil {
		_, err = tx.Exec(`UPDATE projects SET display_order=display_order+1`)
	}
	if err == nil {
		_, err = tx.Exec(`INSERT INTO projects(id,name,description,url,source_url,type,icon,technologies_json,images_json,visible,display_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,1)`, id, p.Name, p.Description, p.URL, p.SourceURL, p.Type, p.Icon, string(stack), string(images), boolInt(p.Visible))
	}
	if err != nil || tx.Commit() != nil {
		writeError(w, 500, "Unable to create project.")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"message": "Project added.", "key": id})
}
func (a *app) findProject(key string) (managedProject, error) {
	all, err := a.collectManagedProjects(false)
	if err != nil {
		return managedProject{}, err
	}
	for _, p := range all {
		if p.Key == key {
			return p, nil
		}
	}
	return managedProject{}, sql.ErrNoRows
}
func (a *app) adminUpdateProject(w http.ResponseWriter, r *http.Request) {
	var in projectInput
	if decodeJSON(r, &in) != nil {
		writeError(w, 400, "Invalid project details.")
		return
	}
	p, err := a.findProject(r.PathValue("key"))
	if err == sql.ErrNoRows {
		writeError(w, 404, "Project not found.")
		return
	}
	if err != nil {
		writeError(w, 503, "Unable to read project.")
		return
	}
	oldURL := p.URL
	mergeProject(&p, in)
	if err = validateProject(p); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	stack, _ := json.Marshal(p.Stack)
	images, _ := json.Marshal(p.Images)
	_, err = a.db.ExecContext(r.Context(), `UPDATE projects SET name=$1,description=$2,url=$3,source_url=$4,type=$5,icon=$6,technologies_json=$7::jsonb,images_json=$8::jsonb,visible=$9,updated_at=clock_timestamp(),status=CASE WHEN $11 THEN 'unknown' ELSE status END,checked_at=CASE WHEN $11 THEN NULL ELSE checked_at END WHERE id=$10`, p.Name, p.Description, p.URL, p.SourceURL, p.Type, p.Icon, string(stack), string(images), boolInt(p.Visible), p.Key, oldURL != p.URL)
	if err != nil {
		writeError(w, 500, "Unable to update project.")
		return
	}
	writeJSON(w, 200, map[string]string{"message": "Project updated."})
}
func (a *app) adminDeleteProject(w http.ResponseWriter, r *http.Request) {
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, 500, "Unable to delete project.")
		return
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`SELECT pg_advisory_xact_lock(724193)`); err != nil {
		writeError(w, 500, "Unable to delete project.")
		return
	}
	result, err := tx.Exec(`DELETE FROM projects WHERE id=$1`, r.PathValue("key"))
	if err != nil {
		writeError(w, 500, "Unable to delete project.")
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		writeError(w, 404, "Project not found.")
		return
	}
	_, err = tx.Exec(`WITH ranked AS (SELECT id,ROW_NUMBER() OVER (ORDER BY display_order,created_at,id) AS n FROM projects) UPDATE projects SET display_order=ranked.n FROM ranked WHERE projects.id=ranked.id`)
	if err != nil || tx.Commit() != nil {
		writeError(w, 500, "Unable to delete project.")
		return
	}
	writeJSON(w, 200, map[string]string{"message": "Project deleted."})
}
func (a *app) adminReorderProjects(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Keys  []string `json:"keys"`
		Start int      `json:"start"`
	}
	if decodeJSON(r, &in) != nil || len(in.Keys) == 0 || len(in.Keys) > 20 || in.Start < 1 {
		writeError(w, 400, "Invalid project order.")
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, 500, "Unable to save project order.")
		return
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`SELECT pg_advisory_xact_lock(724193)`); err != nil {
		writeError(w, 500, "Unable to save project order.")
		return
	}
	all, err := content.LoadProjects(tx, false)
	if err != nil {
		writeError(w, 500, "Unable to read project order.")
		return
	}
	start := in.Start - 1
	if start+len(in.Keys) > len(all) {
		writeError(w, 409, "The project list changed. Refresh before reordering.")
		return
	}
	valid := map[string]bool{}
	for _, p := range all[start : start+len(in.Keys)] {
		valid[p.Key] = true
	}
	for i, key := range in.Keys {
		if !valid[key] {
			writeError(w, 409, "The project list changed. Refresh before reordering.")
			return
		}
		delete(valid, key)
		if _, err = tx.Exec(`UPDATE projects SET display_order=$1,updated_at=clock_timestamp() WHERE id=$2`, in.Start+i, key); err != nil {
			writeError(w, 500, "Unable to save project order.")
			return
		}
	}
	if tx.Commit() != nil {
		writeError(w, 500, "Unable to save project order.")
		return
	}
	writeJSON(w, 200, map[string]string{"message": "Project order saved."})
}
func (a *app) checkProject(ctx context.Context, p managedProject) string {
	status := "offline"
	if p.URL == "" {
		status = "unknown"
	} else if projectURLReachableContext(ctx, p.URL) {
		status = "online"
	}
	_, _ = a.db.ExecContext(ctx, `UPDATE projects SET status=$1,checked_at=clock_timestamp() WHERE id=$2 AND url=$3`, status, p.Key, p.URL)
	return status
}
func (a *app) adminPingProject(w http.ResponseWriter, r *http.Request) {
	if !a.allow(r, "project-status", 60, time.Minute) {
		writeError(w, 429, "Please wait before checking again.")
		return
	}
	p, err := a.findProject(r.PathValue("key"))
	if err != nil {
		writeError(w, 404, "Project not found.")
		return
	}
	status := a.checkProject(r.Context(), p)
	writeJSON(w, 200, map[string]any{"status": status, "checked_at": time.Now()})
}
func (a *app) cleanupProjectMedia(ctx context.Context) {
	rows, err := a.db.QueryContext(ctx, `SELECT m.id,m.storage_path FROM project_media m
		WHERE m.created_at < NOW()-INTERVAL '1 day'
		AND NOT EXISTS(SELECT 1 FROM projects p WHERE
			p.icon='/api/public/project-media/'||m.id OR (m.storage_url<>'' AND p.icon=m.storage_url) OR
			p.images_json @> jsonb_build_array('/api/public/project-media/'||m.id) OR
			(m.storage_url<>'' AND p.images_json @> jsonb_build_array(m.storage_url)))
		AND NOT EXISTS(SELECT 1 FROM personal_information i WHERE
			(i.content->'profile_images') @> jsonb_build_array('/api/public/project-media/'||m.id) OR
			(m.storage_url<>'' AND (i.content->'profile_images') @> jsonb_build_array(m.storage_url)))`)
	if err != nil {
		return
	}
	type orphan struct{ id, path string }
	orphans := []orphan{}
	for rows.Next() {
		var item orphan
		if rows.Scan(&item.id, &item.path) == nil {
			orphans = append(orphans, item)
		}
	}
	rows.Close()
	for _, item := range orphans {
		if result, e := a.db.ExecContext(ctx, `DELETE FROM project_media WHERE id=$1`, item.id); e == nil {
			if n, _ := result.RowsAffected(); n > 0 && a.mediaStore != nil && item.path != "" {
				_ = a.mediaStore.Delete(context.Background(), item.path)
			}
		}
	}
}

func (a *app) runProjectChecks(ctx context.Context) {
	if a.db == nil {
		return
	}
	interval := time.Duration(max(30, positiveInt(env("PROJECT_CHECK_INTERVAL_SECONDS", "120"), 120))) * time.Second
	tick := time.NewTicker(interval)
	defer tick.Stop()
	run := func() {
		items, err := a.collectManagedProjects(false)
		if err != nil {
			return
		}
		slots := make(chan struct{}, 4)
		done := make(chan struct{}, len(items))
		count := 0
		for _, p := range items {
			if p.URL == "" {
				continue
			}
			select {
			case slots <- struct{}{}:
			case <-ctx.Done():
				return
			}
			count++
			go func(p managedProject) { defer func() { <-slots; done <- struct{}{} }(); a.checkProject(ctx, p) }(p)
		}
		for i := 0; i < count; i++ {
			select {
			case <-done:
			case <-ctx.Done():
				return
			}
		}
		a.cleanupProjectMedia(ctx)
	}
	run()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			run()
		}
	}
}
func (a *app) uploadProjectMedia(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 6<<20)
	if err := r.ParseMultipartForm(6 << 20); err != nil {
		writeError(w, 400, "Upload a PNG, JPG, GIF or WebP image up to 5 MB.")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, 400, "Choose an image.")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 5*1024*1024+1))
	if err != nil || len(data) == 0 || len(data) > 5*1024*1024 {
		writeError(w, 400, "Each image must be 5 MB or smaller.")
		return
	}
	mime := http.DetectContentType(data)
	if !contains([]string{"image/png", "image/jpeg", "image/gif", "image/webp"}, mime) {
		writeError(w, 400, "Only PNG, JPG, GIF and WebP images are accepted.")
		return
	}
	id, err := randomToken(18)
	if err != nil {
		writeError(w, 500, "Unable to store image.")
		return
	}

	var blob []byte = data
	storagePath, storageURL := "", ""
	if a.mediaStore != nil {
		storagePath, err = mediastore.ObjectPath("projects", id, mime, data)
		if err == nil {
			storageURL, err = a.mediaStore.Upload(r.Context(), storagePath, mime, data)
		}
		if err != nil {
			writeError(w, http.StatusBadGateway, "Unable to store image in Supabase Storage.")
			return
		}
		blob = nil
	}
	if _, err = a.db.ExecContext(r.Context(), `INSERT INTO project_media(id,image_blob,image_mime,storage_path,storage_url) VALUES($1,$2,$3,$4,$5)`, id, blob, mime, storagePath, storageURL); err != nil {
		if a.mediaStore != nil && storagePath != "" {
			_ = a.mediaStore.Delete(context.Background(), storagePath)
		}
		writeError(w, 500, "Unable to store image.")
		return
	}
	if storageURL != "" {
		writeJSON(w, 201, map[string]string{"url": storageURL, "preview_url": storageURL})
		return
	}
	writeJSON(w, 201, map[string]string{"url": "/api/public/project-media/" + id, "preview_url": "/api/admin/project-media/" + id})
}

func (a *app) publicProjectMedia(w http.ResponseWriter, r *http.Request) {
	a.serveProjectMedia(w, r, false)
}
func (a *app) adminProjectMedia(w http.ResponseWriter, r *http.Request) {
	a.serveProjectMedia(w, r, true)
}
func (a *app) serveProjectMedia(w http.ResponseWriter, r *http.Request, admin bool) {
	id := r.PathValue("id")
	query := `SELECT image_blob,image_mime,storage_url FROM project_media m WHERE id=$1`
	if !admin {
		query += ` AND (EXISTS(SELECT 1 FROM projects p WHERE p.visible=1 AND (p.icon='/api/public/project-media/'||m.id OR p.images_json @> jsonb_build_array('/api/public/project-media/'||m.id))) OR EXISTS(SELECT 1 FROM personal_information i WHERE (i.content->'profile_images') @> jsonb_build_array('/api/public/project-media/'||m.id)))`
	}
	var data []byte
	var mime, storageURL string
	if a.db.QueryRowContext(r.Context(), query, id).Scan(&data, &mime, &storageURL) != nil {
		http.NotFound(w, r)
		return
	}
	if strings.TrimSpace(storageURL) != "" {
		http.Redirect(w, r, storageURL, http.StatusTemporaryRedirect)
		return
	}
	if len(data) == 0 {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Length", fmt.Sprint(len(data)))
	w.Header().Set("Content-Disposition", "inline")
	_, _ = w.Write(data)
}
