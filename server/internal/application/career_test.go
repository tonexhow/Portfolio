package application

import (
	"bytes"
	"mime/multipart"
	"net/http/httptest"
	"testing"
)

// The career_profiles.visible column is SMALLINT (0/1), not PostgreSQL BOOLEAN.
// Preserve the same conversion used by other application handlers.
func TestCareerVisibilityDatabaseValues(t *testing.T) {
	if got := boolInt(true); got != 1 {
		t.Fatalf("visible=true must be stored as 1, got %d", got)
	}
	if got := boolInt(false); got != 0 {
		t.Fatalf("visible=false must be stored as 0, got %d", got)
	}
}

func TestReadCareerFormWithPDF(t *testing.T) {
	for _, tc := range []struct {
		visible string
		want    bool
	}{
		{visible: "true", want: true},
		{visible: "false", want: false},
	} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		for key, value := range map[string]string{
			"document_type": "resume", "title": "Software Development OJT",
			"description": "ATS resume", "visible": tc.visible,
			"display_order": "2",
		} {
			if err := writer.WriteField(key, value); err != nil {
				t.Fatal(err)
			}
		}
		file, err := writer.CreateFormFile("file", "resume.pdf")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte("%PDF-1.7\n%%EOF")); err != nil {
			t.Fatal(err)
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}

		request := httptest.NewRequest("POST", "/api/admin/career-profiles", &body)
		request.Header.Set("Content-Type", writer.FormDataContentType())
		profile, pdf, fileName, err := readCareerForm(request)
		if err != nil {
			t.Fatalf("visible=%s: unexpected form error: %v", tc.visible, err)
		}
		if profile.Visible != tc.want || profile.DisplayOrder != 2 || profile.DocumentType != "resume" || fileName != "resume.pdf" || !bytes.HasPrefix(pdf, []byte("%PDF-")) {
			t.Fatalf("visible=%s: unexpected parsed form: profile=%+v file=%q", tc.visible, profile, fileName)
		}
	}
}

func TestReadCareerFormRejectsNonPDF(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("document_type", "resume")
	_ = writer.WriteField("title", "Resume")
	file, err := writer.CreateFormFile("file", "not-a-pdf.pdf")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = file.Write([]byte("not a PDF"))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/api/admin/career-profiles", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if _, _, _, err := readCareerForm(request); err == nil {
		t.Fatal("expected non-PDF content to be rejected")
	}
}
