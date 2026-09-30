package main

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	mediastore "jpano.dev/portfolio/internal/storage"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	certificatePublicPageSize = 6
	certificateAdminPageSize  = 18
	certificateMaxBytes       = 5 * 1024 * 1024
	certificateFetchMaxBytes  = 24 * 1024 * 1024
)

type certificateRecord struct {
	ID              int64     `json:"id"`
	CertificateDate string    `json:"date"`
	Provider        string    `json:"provider"`
	Visible         bool      `json:"visible,omitempty"`
	Pinned          bool      `json:"pinned,omitempty"`
	SourceURL       string    `json:"source_url,omitempty"`
	ImageURL        string    `json:"image_url"`
	DownloadURL     string    `json:"download_url"`
	CreatedAt       time.Time `json:"created_at,omitempty"`
	UpdatedAt       time.Time `json:"updated_at,omitempty"`
}

func (a *app) publicCertificates(w http.ResponseWriter, r *http.Request) {
	page := positiveInt(r.URL.Query().Get("page"), 1)
	limit := positiveInt(r.URL.Query().Get("limit"), certificatePublicPageSize)
	if limit > certificatePublicPageSize {
		limit = certificatePublicPageSize
	}

	var total int
	if err := a.db.QueryRow(`SELECT COUNT(*) FROM certificates WHERE visible=1`).Scan(&total); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load certificates.")
		return
	}
	pages := pageCount(total, limit)
	if page > pages {
		page = pages
	}
	offset := (page - 1) * limit

	rows, err := a.db.Query(`SELECT id, certificate_date, provider, pinned, md5(updated_at::text), storage_url FROM certificates
		WHERE visible=1 ORDER BY pinned DESC, certificate_date DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load certificates.")
		return
	}
	defer rows.Close()

	items := make([]certificateRecord, 0, limit)
	for rows.Next() {
		var item certificateRecord
		var revision, storageURL string
		if err := rows.Scan(&item.ID, &item.CertificateDate, &item.Provider, &item.Pinned, &revision, &storageURL); err != nil {
			writeError(w, http.StatusInternalServerError, "Unable to load certificates.")
			return
		}
		if revision == "" {
			revision = strconv.FormatInt(item.ID, 10)
		}
		if strings.TrimSpace(storageURL) != "" {
			item.ImageURL = storageURL
		} else {
			item.ImageURL = fmt.Sprintf("/api/public/certificates/%d/image?v=%s", item.ID, revision)
		}
		item.DownloadURL = fmt.Sprintf("/api/public/certificates/%d/download", item.ID)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load certificates.")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items":        items,
		"page":         page,
		"page_size":    limit,
		"total":        total,
		"total_pages":  pages,
		"has_previous": page > 1,
		"has_next":     page < pages,
	})
}

func (a *app) publicCertificateImage(w http.ResponseWriter, r *http.Request) {
	a.serveCertificateImage(w, r, false, false)
}

func (a *app) publicCertificateDownload(w http.ResponseWriter, r *http.Request) {
	a.serveCertificateImage(w, r, false, true)
}

func (a *app) adminCertificateImage(w http.ResponseWriter, r *http.Request) {
	a.serveCertificateImage(w, r, true, false)
}

func (a *app) adminCertificateURLPreview(w http.ResponseWriter, r *http.Request) {
	rawURL := strings.TrimSpace(r.URL.Query().Get("url"))
	if rawURL == "" {
		writeError(w, http.StatusBadRequest, "Image URL is required.")
		return
	}
	data, mimeType, err := a.fetchCertificateImage(rawURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Disposition", "inline")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (a *app) serveCertificateImage(w http.ResponseWriter, r *http.Request, admin, download bool) {
	id, err := strconv.ParseInt(strings.TrimSpace(r.PathValue("id")), 10, 64)
	if err != nil || id <= 0 {
		http.NotFound(w, r)
		return
	}

	query := `SELECT image_blob, image_mime, provider, certificate_date, storage_url FROM certificates WHERE id=?`
	if !admin {
		query += ` AND visible=1`
	}
	var data []byte
	var mimeType, provider, certificateDate, storageURL string
	if err := a.db.QueryRow(query, id).Scan(&data, &mimeType, &provider, &certificateDate, &storageURL); err != nil {
		http.NotFound(w, r)
		return
	}

	if strings.TrimSpace(storageURL) != "" {
		target := storageURL
		if download {
			ext := certificateExtension(mimeType)
			name := certificateFileName(provider, certificateDate, ext)
			separator := "?"
			if strings.Contains(target, "?") {
				separator = "&"
			}
			target += separator + "download=" + url.QueryEscape(name)
		}
		http.Redirect(w, r, target, http.StatusTemporaryRedirect)
		return
	}
	if len(data) == 0 {
		http.NotFound(w, r)
		return
	}

	if mimeType == "" {
		mimeType = http.DetectContentType(data)
	}
	w.Header().Set("Content-Type", mimeType)
	if admin {
		w.Header().Set("Cache-Control", "private, no-store")
	} else if download {
		w.Header().Set("Cache-Control", "public, max-age=0, must-revalidate")
	} else if strings.TrimSpace(r.URL.Query().Get("v")) != "" {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=600")
	}
	if download {
		ext := certificateExtension(mimeType)
		name := certificateFileName(provider, certificateDate, ext)
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, name))
	} else {
		w.Header().Set("Content-Disposition", "inline")
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (a *app) adminCertificatesPage(w http.ResponseWriter, r *http.Request) {
	page := positiveInt(r.URL.Query().Get("page"), 1)
	status := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status")))
	q := clean(r.URL.Query().Get("q"), 120)

	where := []string{"1=1"}
	args := []any{}
	switch status {
	case "shown":
		where = append(where, "visible=1")
	case "hidden":
		where = append(where, "visible=0")
	case "pinned":
		where = append(where, "pinned=1")
	case "":
	default:
		writeError(w, http.StatusBadRequest, "Invalid certificate filter.")
		return
	}
	if q != "" {
		where = append(where, "LOWER(provider) LIKE ?")
		args = append(args, "%"+strings.ToLower(q)+"%")
	}
	whereSQL := strings.Join(where, " AND ")

	var total int
	if err := a.db.QueryRow(`SELECT COUNT(*) FROM certificates WHERE `+whereSQL, args...).Scan(&total); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load certificates.")
		return
	}
	pages := pageCount(total, certificateAdminPageSize)
	if page > pages {
		page = pages
	}
	offset := (page - 1) * certificateAdminPageSize
	queryArgs := append(append([]any{}, args...), certificateAdminPageSize, offset)

	rows, err := a.db.Query(`SELECT id, certificate_date, provider, visible, pinned, source_url, storage_url, created_at, updated_at
		FROM certificates WHERE `+whereSQL+` ORDER BY pinned DESC, certificate_date DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load certificates.")
		return
	}
	defer rows.Close()

	items := make([]certificateRecord, 0, certificateAdminPageSize)
	for rows.Next() {
		var item certificateRecord
		var storageURL string
		if err := rows.Scan(&item.ID, &item.CertificateDate, &item.Provider, &item.Visible, &item.Pinned, &item.SourceURL, &storageURL, &item.CreatedAt, &item.UpdatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "Unable to load certificates.")
			return
		}
		if strings.TrimSpace(storageURL) != "" {
			item.ImageURL = storageURL
		} else {
			item.ImageURL = fmt.Sprintf("/api/admin/certificates/%d/image", item.ID)
		}
		item.DownloadURL = fmt.Sprintf("/api/public/certificates/%d/download", item.ID)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load certificates.")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items":       items,
		"page":        page,
		"page_size":   certificateAdminPageSize,
		"total":       total,
		"total_pages": pages,
	})
}

func (a *app) persistCertificateImage(ctx context.Context, idHint string, data []byte, mimeType string) (blob []byte, storagePath, storageURL string, err error) {
	if a.mediaStore == nil {
		return data, "", "", nil
	}
	if strings.TrimSpace(idHint) == "" {
		idHint, err = randomToken(10)
		if err != nil {
			return nil, "", "", err
		}
	}
	storagePath, err = mediastore.ObjectPath("certificates", idHint, mimeType, data)
	if err != nil {
		return nil, "", "", err
	}
	storageURL, err = a.mediaStore.Upload(ctx, storagePath, mimeType, data)
	if err != nil {
		return nil, "", "", err
	}
	return nil, storagePath, storageURL, nil
}

func (a *app) adminAddCertificate(w http.ResponseWriter, r *http.Request) {
	input, err := a.readCertificateForm(r, false)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	blob, storagePath, storageURL, err := a.persistCertificateImage(r.Context(), "", input.ImageData, input.ImageMime)
	if err != nil {
		writeError(w, http.StatusBadGateway, "Unable to store certificate image in Supabase Storage.")
		return
	}
	var id int64
	err = a.db.QueryRow(`INSERT INTO certificates(image_blob,image_mime,storage_path,storage_url,source_url,certificate_date,provider,visible,pinned,created_at,updated_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?) RETURNING id`, blob, input.ImageMime, storagePath, storageURL, input.SourceURL, input.Date, input.Provider, boolInt(input.Visible), boolInt(input.Pinned), time.Now(), time.Now()).Scan(&id)
	if err != nil {
		if a.mediaStore != nil && storagePath != "" {
			_ = a.mediaStore.Delete(context.Background(), storagePath)
		}
		writeError(w, http.StatusInternalServerError, "Unable to add certificate.")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"message": "Certificate added.", "id": id})
}

func (a *app) adminUpdateCertificate(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(strings.TrimSpace(r.PathValue("id")), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "Invalid certificate id.")
		return
	}

	var current struct {
		ImageData   []byte
		ImageMime   string
		SourceURL   string
		StoragePath string
		StorageURL  string
	}
	if err := a.db.QueryRow(`SELECT image_blob,image_mime,source_url,storage_path,storage_url FROM certificates WHERE id=?`, id).Scan(&current.ImageData, &current.ImageMime, &current.SourceURL, &current.StoragePath, &current.StorageURL); err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "Certificate not found.")
			return
		}
		writeError(w, http.StatusInternalServerError, "Unable to read certificate.")
		return
	}

	input, err := a.readCertificateForm(r, true)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	blob, storagePath, storageURL := current.ImageData, current.StoragePath, current.StorageURL
	if len(input.ImageData) == 0 {
		input.ImageMime = current.ImageMime
		input.SourceURL = current.SourceURL
	} else {
		blob, storagePath, storageURL, err = a.persistCertificateImage(r.Context(), strconv.FormatInt(id, 10), input.ImageData, input.ImageMime)
		if err != nil {
			writeError(w, http.StatusBadGateway, "Unable to store certificate image in Supabase Storage.")
			return
		}
	}

	result, err := a.db.Exec(`UPDATE certificates SET image_blob=?,image_mime=?,storage_path=?,storage_url=?,source_url=?,certificate_date=?,provider=?,visible=?,pinned=?,updated_at=? WHERE id=?`,
		blob, input.ImageMime, storagePath, storageURL, input.SourceURL, input.Date, input.Provider, boolInt(input.Visible), boolInt(input.Pinned), time.Now(), id)
	if err != nil {
		if a.mediaStore != nil && storagePath != "" && storagePath != current.StoragePath {
			_ = a.mediaStore.Delete(context.Background(), storagePath)
		}
		writeError(w, http.StatusInternalServerError, "Unable to update certificate.")
		return
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		writeError(w, http.StatusNotFound, "Certificate not found.")
		return
	}
	if a.mediaStore != nil && current.StoragePath != "" && current.StoragePath != storagePath {
		_ = a.mediaStore.Delete(context.Background(), current.StoragePath)
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Certificate updated."})
}

func (a *app) adminSetCertificateState(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(strings.TrimSpace(r.PathValue("id")), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "Invalid certificate id.")
		return
	}
	var input struct {
		Visible *bool `json:"visible"`
		Pinned  *bool `json:"pinned"`
	}
	if err := decodeJSON(r, &input); err != nil || (input.Visible == nil && input.Pinned == nil) {
		writeError(w, http.StatusBadRequest, "Invalid certificate update.")
		return
	}

	var visible, pinned bool
	if err := a.db.QueryRow(`SELECT visible,pinned FROM certificates WHERE id=?`, id).Scan(&visible, &pinned); err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "Certificate not found.")
			return
		}
		writeError(w, http.StatusInternalServerError, "Unable to read certificate.")
		return
	}
	if input.Visible != nil {
		visible = *input.Visible
	}
	if input.Pinned != nil {
		pinned = *input.Pinned
	}
	if _, err := a.db.Exec(`UPDATE certificates SET visible=?, pinned=?, updated_at=? WHERE id=?`, boolInt(visible), boolInt(pinned), time.Now(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to update certificate.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Certificate display updated."})
}

func (a *app) adminDeleteCertificate(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(strings.TrimSpace(r.PathValue("id")), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "Invalid certificate id.")
		return
	}
	var storagePath string
	if err := a.db.QueryRow(`SELECT storage_path FROM certificates WHERE id=?`, id).Scan(&storagePath); err != nil {
		if err == sql.ErrNoRows {
			writeError(w, http.StatusNotFound, "Certificate not found.")
			return
		}
		writeError(w, http.StatusInternalServerError, "Unable to read certificate.")
		return
	}
	result, err := a.db.Exec(`DELETE FROM certificates WHERE id=?`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to delete certificate.")
		return
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		writeError(w, http.StatusNotFound, "Certificate not found.")
		return
	}
	if a.mediaStore != nil && storagePath != "" {
		_ = a.mediaStore.Delete(context.Background(), storagePath)
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Certificate deleted."})
}

type certificateFormInput struct {
	ImageData []byte
	ImageMime string
	SourceURL string
	Date      string
	Provider  string
	Visible   bool
	Pinned    bool
}

func (a *app) readCertificateForm(r *http.Request, allowNoImage bool) (certificateFormInput, error) {
	var input certificateFormInput
	r.Body = http.MaxBytesReader(nil, r.Body, certificateFetchMaxBytes+2*1024*1024)
	if err := r.ParseMultipartForm(certificateFetchMaxBytes + 1024*1024); err != nil {
		return input, fmt.Errorf("Certificate form is too large.")
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()

	input.Provider = clean(r.FormValue("provider"), 120)
	input.Date = strings.TrimSpace(r.FormValue("date"))
	input.Visible = formBool(r.FormValue("visible"), true)
	input.Pinned = formBool(r.FormValue("pinned"), false)
	if input.Provider == "" {
		return input, fmt.Errorf("Provider is required.")
	}
	year, err := strconv.Atoi(input.Date)
	if err != nil || len(input.Date) != 4 || year < 1900 || year > 2100 {
		return input, fmt.Errorf("A valid four-digit certificate year is required.")
	}
	input.Date = strconv.Itoa(year)

	file, _, fileErr := r.FormFile("image")
	if fileErr == nil {
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, certificateFetchMaxBytes+1))
		if err != nil || len(data) == 0 {
			return input, fmt.Errorf("Unable to read the certificate image.")
		}
		if len(data) > certificateFetchMaxBytes {
			return input, fmt.Errorf("Certificate image is too large to process.")
		}
		data, mimeType, err := normalizeCertificateImage(data)
		if err != nil {
			return input, err
		}
		input.ImageData, input.ImageMime = data, mimeType
		return input, nil
	}

	imageURL := strings.TrimSpace(r.FormValue("image_url"))
	if imageURL != "" {
		data, mimeType, err := a.fetchCertificateImage(imageURL)
		if err != nil {
			return input, err
		}
		input.ImageData, input.ImageMime, input.SourceURL = data, mimeType, imageURL
		return input, nil
	}

	if !allowNoImage {
		return input, fmt.Errorf("Add a certificate image or image URL.")
	}
	return input, nil
}

func (a *app) fetchCertificateImage(rawURL string) ([]byte, string, error) {
	if !publicNetworkURL(rawURL) {
		return nil, "", fmt.Errorf("Use a valid public HTTP(S) image URL.")
	}
	client := publicHTTPClient(15 * time.Second)
	defer client.CloseIdleConnections()
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("Unable to read the image URL.")
	}
	req.Header.Set("User-Agent", "JPano-Portfolio-Certificate/1.0")
	req.Header.Set("Accept", "image/*")
	response, err := client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("Unable to download the certificate image.")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, "", fmt.Errorf("Certificate image URL returned HTTP %d.", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, certificateFetchMaxBytes+1))
	if err != nil || len(data) == 0 {
		return nil, "", fmt.Errorf("Unable to download the certificate image.")
	}
	if len(data) > certificateFetchMaxBytes {
		return nil, "", fmt.Errorf("Certificate image is too large to process.")
	}
	return normalizeCertificateImage(data)
}

func normalizeCertificateImage(data []byte) ([]byte, string, error) {
	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(http.DetectContentType(data), ";")[0]))
	if !allowedCertificateMime(mimeType) {
		return nil, "", fmt.Errorf("Use a JPG, PNG, GIF, or WebP image.")
	}
	if len(data) <= certificateMaxBytes {
		return data, mimeType, nil
	}

	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", fmt.Errorf("This image is above 5 MB and cannot be resized automatically. Use a JPG or PNG version.")
	}
	working := flattenCertificateImage(img, img.Bounds().Dx(), img.Bounds().Dy())
	qualities := []int{90, 84, 78, 72, 66, 60}
	for scalePass := 0; scalePass < 8; scalePass++ {
		for _, quality := range qualities {
			var out bytes.Buffer
			if err := jpeg.Encode(&out, working, &jpeg.Options{Quality: quality}); err != nil {
				return nil, "", fmt.Errorf("Unable to resize the certificate image.")
			}
			if out.Len() <= certificateMaxBytes {
				return out.Bytes(), "image/jpeg", nil
			}
		}
		newW := int(float64(working.Bounds().Dx()) * 0.82)
		newH := int(float64(working.Bounds().Dy()) * 0.82)
		if newW < 1 || newH < 1 || newW >= working.Bounds().Dx() || newH >= working.Bounds().Dy() {
			break
		}
		working = flattenCertificateImage(working, newW, newH)
	}
	return nil, "", fmt.Errorf("Unable to reduce this image below 5 MB without making it too small.")
}

func flattenCertificateImage(src image.Image, width, height int) *image.RGBA {
	bounds := src.Bounds()
	if width <= 0 || height <= 0 {
		width, height = bounds.Dx(), bounds.Dy()
	}
	dst := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		sy := bounds.Min.Y + y*bounds.Dy()/height
		for x := 0; x < width; x++ {
			sx := bounds.Min.X + x*bounds.Dx()/width
			r, g, b, a := src.At(sx, sy).RGBA()
			inv := uint32(0xffff) - a
			r = minUint32(0xffff, r+inv)
			g = minUint32(0xffff, g+inv)
			b = minUint32(0xffff, b+inv)
			dst.SetRGBA(x, y, color.RGBA{R: uint8(r >> 8), G: uint8(g >> 8), B: uint8(b >> 8), A: 255})
		}
	}
	return dst
}

func allowedCertificateMime(mimeType string) bool {
	switch mimeType {
	case "image/jpeg", "image/png", "image/gif", "image/webp":
		return true
	default:
		return false
	}
}

func certificateExtension(mimeType string) string {
	switch mimeType {
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	default:
		return ".jpg"
	}
}

func certificateFileName(provider, date, ext string) string {
	base := strings.ToLower(strings.TrimSpace(provider))
	var b strings.Builder
	for _, r := range base {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else if b.Len() > 0 && !strings.HasSuffix(b.String(), "-") {
			b.WriteByte('-')
		}
	}
	name := strings.Trim(b.String(), "-")
	if name == "" {
		name = "certificate"
	}
	date = strings.ReplaceAll(strings.TrimSpace(date), "/", "-")
	if date != "" {
		name += "-" + date
	}
	return filepath.Base(name + ext)
}

func positiveInt(raw string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func pageCount(total, limit int) int {
	if limit <= 0 || total <= 0 {
		return 1
	}
	return (total + limit - 1) / limit
}

func formBool(raw string, fallback bool) bool {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" {
		return fallback
	}
	return raw == "1" || raw == "true" || raw == "on" || raw == "yes"
}

func minUint32(a, b uint32) uint32 {
	if a < b {
		return a
	}
	return b
}
