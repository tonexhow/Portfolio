package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
)

const (
	feedbackAuthCookie       = "jp_feedback_auth"
	feedbackOAuthStateCookie = "jp_feedback_oauth_state"
	contactAuthCookie        = "jp_contact_auth"
	contactOAuthStateCookie  = "jp_contact_oauth_state"
	feedbackAuthLifetime     = 24 * time.Hour
	feedbackOAuthStateTTL    = 10 * time.Minute
)

type feedbackIdentity struct {
	Provider       string
	ProviderUserID string
	DisplayName    string
	Credential     string
	ProfileURL     string
}

type feedbackAuthSessionResponse struct {
	Authenticated bool   `json:"authenticated"`
	Provider      string `json:"provider,omitempty"`
	DisplayName   string `json:"display_name,omitempty"`
	Credential    string `json:"credential,omitempty"`
	Email         string `json:"email,omitempty"`
	EmailVerified bool   `json:"email_verified,omitempty"`
	AvatarURL     string `json:"avatar_url,omitempty"`
}

type oauthStateCookie struct {
	Provider string `json:"provider"`
	State    string `json:"state"`
	Expires  int64  `json:"expires"`
}

func (a *app) feedbackAuthProviders(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"providers": []map[string]any{
			{"id": "google", "label": "Google", "configured": os.Getenv("GOOGLE_CLIENT_ID") != "" && os.Getenv("GOOGLE_CLIENT_SECRET") != "", "account_type": "email"},
			{"id": "github", "label": "GitHub", "configured": os.Getenv("GITHUB_CLIENT_ID") != "" && os.Getenv("GITHUB_CLIENT_SECRET") != "", "account_type": "username"},
			{"id": "facebook", "label": "Facebook", "configured": os.Getenv("FACEBOOK_CLIENT_ID") != "" && os.Getenv("FACEBOOK_CLIENT_SECRET") != "", "account_type": "email_or_id"},
			{"id": "telegram", "label": "Telegram", "configured": os.Getenv("TELEGRAM_BOT_TOKEN") != "" && os.Getenv("TELEGRAM_BOT_USERNAME") != "", "account_type": "username_or_id", "note": "Phone number requires Telegram OIDC phone scope and separate Login Client credentials."},
		},
	})
}

func (a *app) feedbackAuthSession(w http.ResponseWriter, r *http.Request) {
	identity, ok := a.currentFeedbackIdentity(r)
	if !ok {
		writeJSON(w, http.StatusOK, feedbackAuthSessionResponse{Authenticated: false})
		return
	}
	verifiedEmail := ""
	if validEmail(identity.Credential) {
		verifiedEmail = strings.ToLower(strings.TrimSpace(identity.Credential))
	}
	writeJSON(w, http.StatusOK, feedbackAuthSessionResponse{
		Authenticated: true,
		Provider:      identity.Provider,
		DisplayName:   identity.DisplayName,
		Credential:    identity.Credential,
		Email:         verifiedEmail,
		EmailVerified: verifiedEmail != "",
		AvatarURL:     "/api/public/feedback-auth/avatar",
	})
}

func (a *app) feedbackAuthLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(feedbackAuthCookie); err == nil && cookie.Value != "" {
		_, _ = a.db.Exec(`DELETE FROM feedback_auth_sessions WHERE token_hash=?`, tokenHash(cookie.Value))
	}
	a.clearFeedbackAuthCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]string{"message": "Feedback identity cleared."})
}

func (a *app) contactAuthSession(w http.ResponseWriter, r *http.Request) {
	identity, ok := a.currentContactIdentity(r)
	if !ok || !validEmail(identity.Credential) {
		writeJSON(w, http.StatusOK, feedbackAuthSessionResponse{Authenticated: false})
		return
	}
	email := strings.ToLower(strings.TrimSpace(identity.Credential))
	avatarURL := ""
	if identity.ProfileURL != "" {
		avatarURL = "/api/public/contact-auth/avatar"
	}
	writeJSON(w, http.StatusOK, feedbackAuthSessionResponse{
		Authenticated: true,
		Provider:      "google",
		DisplayName:   identity.DisplayName,
		Credential:    email,
		Email:         email,
		EmailVerified: true,
		AvatarURL:     avatarURL,
	})
}

func (a *app) contactAuthStart(w http.ResponseWriter, r *http.Request) {
	if !feedbackProviderConfigured("google") {
		a.contactAuthRedirect(w, r, "unavailable")
		return
	}
	state, err := randomToken(24)
	if err != nil {
		a.contactAuthRedirect(w, r, "failed")
		return
	}
	a.setContactOAuthStateCookie(w, r, state)
	callback := a.feedbackOAuthCallbackURL(r, "google")
	q := url.Values{
		"client_id":     {os.Getenv("GOOGLE_CLIENT_ID")},
		"redirect_uri":  {callback},
		"response_type": {"code"},
		"scope":         {"openid email profile"},
		"state":         {state},
		"prompt":        {"select_account"},
	}
	http.Redirect(w, r, "https://accounts.google.com/o/oauth2/v2/auth?"+q.Encode(), http.StatusSeeOther)
}

func (a *app) contactAuthRedirect(w http.ResponseWriter, r *http.Request, status string) {
	http.Redirect(w, r, a.appURL+"/?contact_auth="+url.QueryEscape(status)+"#contact", http.StatusSeeOther)
}

func (a *app) setContactOAuthStateCookie(w http.ResponseWriter, r *http.Request, state string) {
	value, _ := json.Marshal(oauthStateCookie{Provider: "google", State: state, Expires: time.Now().Add(feedbackOAuthStateTTL).Unix()})
	http.SetCookie(w, &http.Cookie{
		Name:     contactOAuthStateCookie,
		Value:    url.QueryEscape(string(value)),
		Path:     "/auth/feedback/",
		MaxAge:   int(feedbackOAuthStateTTL.Seconds()),
		HttpOnly: true,
		Secure:   isHTTPS(r, a.apiURL),
		SameSite: sessionSameSite(),
	})
}

func (a *app) validContactOAuthState(r *http.Request, state string) bool {
	cookie, err := r.Cookie(contactOAuthStateCookie)
	if err != nil || state == "" {
		return false
	}
	raw, err := url.QueryUnescape(cookie.Value)
	if err != nil {
		return false
	}
	var saved oauthStateCookie
	if json.Unmarshal([]byte(raw), &saved) != nil || time.Now().Unix() > saved.Expires {
		return false
	}
	return saved.Provider == "google" && hmac.Equal([]byte(saved.State), []byte(state))
}

func (a *app) clearContactOAuthStateCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: contactOAuthStateCookie, Value: "", Path: "/auth/feedback/", MaxAge: -1, HttpOnly: true, Secure: isHTTPS(r, a.apiURL), SameSite: sessionSameSite()})
}

func (a *app) currentContactIdentity(r *http.Request) (feedbackIdentity, bool) {
	if cookie, err := r.Cookie(contactAuthCookie); err == nil && cookie.Value != "" {
		var identity feedbackIdentity
		var expires time.Time
		err = a.db.QueryRow(`SELECT provider, provider_user_id, display_name, email, profile_url, expires_at FROM contact_auth_sessions WHERE token_hash=?`, tokenHash(cookie.Value)).Scan(
			&identity.Provider, &identity.ProviderUserID, &identity.DisplayName, &identity.Credential, &identity.ProfileURL, &expires,
		)
		if err == nil && time.Now().Before(expires) && identity.Provider == "google" && validEmail(identity.Credential) {
			// Older contact sessions predate profile_url. Reuse the current Google
			// feedback avatar when both sessions represent the same verified email.
			if identity.ProfileURL == "" {
				if feedback, feedbackOK := a.currentFeedbackIdentity(r); feedbackOK && feedback.Provider == "google" && strings.EqualFold(feedback.Credential, identity.Credential) {
					identity.ProfileURL = feedback.ProfileURL
				}
			}
			return identity, true
		}
	}
	identity, ok := a.currentFeedbackIdentity(r)
	if ok && identity.Provider == "google" && validEmail(identity.Credential) {
		return identity, true
	}
	return feedbackIdentity{}, false
}

func (a *app) createContactAuthSession(w http.ResponseWriter, r *http.Request, identity feedbackIdentity) error {
	token, err := randomToken(32)
	if err != nil {
		return err
	}
	now := time.Now()
	expires := now.Add(feedbackAuthLifetime)
	_, _ = a.db.Exec(`DELETE FROM contact_auth_sessions WHERE expires_at < ?`, now)
	_, err = a.db.Exec(`INSERT INTO contact_auth_sessions(token_hash,provider,provider_user_id,display_name,email,profile_url,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
		tokenHash(token), "google", identity.ProviderUserID, identity.DisplayName, strings.ToLower(strings.TrimSpace(identity.Credential)), identity.ProfileURL, expires, now, now)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     contactAuthCookie,
		Value:    token,
		Path:     "/",
		Expires:  expires,
		MaxAge:   int(feedbackAuthLifetime.Seconds()),
		HttpOnly: true,
		Secure:   isHTTPS(r, a.apiURL),
		SameSite: sessionSameSite(),
	})
	return nil
}

func (a *app) feedbackAuthStart(w http.ResponseWriter, r *http.Request) {
	provider := strings.ToLower(strings.TrimSpace(r.PathValue("provider")))
	if !contains([]string{"google", "github", "facebook", "telegram"}, provider) {
		writeError(w, http.StatusNotFound, "Unknown sign-in provider.")
		return
	}
	if !feedbackProviderConfigured(provider) {
		writeError(w, http.StatusServiceUnavailable, "This sign-in provider is not configured yet.")
		return
	}

	state, err := randomToken(24)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to start sign-in.")
		return
	}
	a.setFeedbackOAuthStateCookie(w, r, provider, state)
	callback := a.feedbackOAuthCallbackURL(r, provider)

	switch provider {
	case "google":
		q := url.Values{
			"client_id":     {os.Getenv("GOOGLE_CLIENT_ID")},
			"redirect_uri":  {callback},
			"response_type": {"code"},
			"scope":         {"openid email profile"},
			"state":         {state},
			"prompt":        {"select_account"},
		}
		http.Redirect(w, r, "https://accounts.google.com/o/oauth2/v2/auth?"+q.Encode(), http.StatusSeeOther)
	case "github":
		q := url.Values{
			"client_id":    {os.Getenv("GITHUB_CLIENT_ID")},
			"redirect_uri": {callback},
			"scope":        {"read:user"},
			"state":        {state},
		}
		http.Redirect(w, r, "https://github.com/login/oauth/authorize?"+q.Encode(), http.StatusSeeOther)
	case "facebook":
		q := url.Values{
			"client_id":     {os.Getenv("FACEBOOK_CLIENT_ID")},
			"redirect_uri":  {callback},
			"response_type": {"code"},
			"scope":         {"public_profile,email"},
			"state":         {state},
		}
		http.Redirect(w, r, "https://www.facebook.com/dialog/oauth?"+q.Encode(), http.StatusSeeOther)
	case "telegram":
		a.serveTelegramFeedbackLogin(w, callback, state)
	}
}

func (a *app) maybeHandleContactGoogleCallback(w http.ResponseWriter, r *http.Request, provider string) bool {
	if provider != "google" {
		return false
	}
	if _, err := r.Cookie(contactOAuthStateCookie); err != nil {
		return false
	}
	if strings.TrimSpace(r.URL.Query().Get("error")) != "" {
		a.clearContactOAuthStateCookie(w, r)
		a.contactAuthRedirect(w, r, "cancelled")
		return true
	}
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if !a.validContactOAuthState(r, state) {
		a.clearContactOAuthStateCookie(w, r)
		a.contactAuthRedirect(w, r, "invalid")
		return true
	}
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if code == "" {
		a.clearContactOAuthStateCookie(w, r)
		a.contactAuthRedirect(w, r, "failed")
		return true
	}
	identity, err := a.googleFeedbackIdentity(r, code)
	if err != nil || identity.ProviderUserID == "" || identity.DisplayName == "" || !validEmail(identity.Credential) {
		a.clearContactOAuthStateCookie(w, r)
		a.contactAuthRedirect(w, r, "failed")
		return true
	}
	identity.DisplayName = clean(identity.DisplayName, 80)
	identity.Credential = clean(strings.ToLower(identity.Credential), 254)
	if err := a.createContactAuthSession(w, r, identity); err != nil {
		a.clearContactOAuthStateCookie(w, r)
		a.contactAuthRedirect(w, r, "failed")
		return true
	}
	a.clearContactOAuthStateCookie(w, r)
	a.contactAuthRedirect(w, r, "ok")
	return true
}

func (a *app) feedbackAuthCallback(w http.ResponseWriter, r *http.Request) {
	provider := strings.ToLower(strings.TrimSpace(r.PathValue("provider")))
	if !contains([]string{"google", "github", "facebook", "telegram"}, provider) || !feedbackProviderConfigured(provider) {
		a.feedbackAuthRedirect(w, r, "unavailable")
		return
	}
	if a.maybeHandleContactGoogleCallback(w, r, provider) {
		return
	}
	if errText := strings.TrimSpace(r.URL.Query().Get("error")); errText != "" {
		a.clearFeedbackOAuthStateCookie(w, r)
		a.feedbackAuthRedirect(w, r, "cancelled")
		return
	}
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if !a.validFeedbackOAuthState(r, provider, state) {
		a.clearFeedbackOAuthStateCookie(w, r)
		a.feedbackAuthRedirect(w, r, "invalid")
		return
	}

	var identity feedbackIdentity
	var err error
	if provider == "telegram" {
		identity, err = telegramIdentityFromCallback(r, os.Getenv("TELEGRAM_BOT_TOKEN"))
	} else {
		code := strings.TrimSpace(r.URL.Query().Get("code"))
		if code == "" {
			err = fmt.Errorf("missing authorization code")
		} else {
			switch provider {
			case "google":
				identity, err = a.googleFeedbackIdentity(r, code)
			case "github":
				identity, err = a.githubFeedbackIdentity(r, code)
			case "facebook":
				identity, err = a.facebookFeedbackIdentity(r, code)
			}
		}
	}
	if err != nil || identity.ProviderUserID == "" || identity.DisplayName == "" {
		a.clearFeedbackOAuthStateCookie(w, r)
		a.feedbackAuthRedirect(w, r, "failed")
		return
	}
	identity.DisplayName = clean(identity.DisplayName, 80)
	identity.Credential = clean(identity.Credential, 254)
	identity.ProfileURL = strings.TrimSpace(identity.ProfileURL)
	if !validFeedbackAvatarURL(identity.Provider, identity.ProfileURL) {
		identity.ProfileURL = ""
	}

	if err := a.createFeedbackAuthSession(w, r, identity); err != nil {
		a.clearFeedbackOAuthStateCookie(w, r)
		a.feedbackAuthRedirect(w, r, "failed")
		return
	}
	a.clearFeedbackOAuthStateCookie(w, r)
	a.feedbackAuthRedirect(w, r, "ok")
}

func (a *app) contactAuthAvatar(w http.ResponseWriter, r *http.Request) {
	identity, ok := a.currentContactIdentity(r)
	if !ok || identity.ProfileURL == "" {
		http.NotFound(w, r)
		return
	}
	a.proxyFeedbackAvatar(w, r, "google", identity.ProfileURL)
}

func (a *app) feedbackAuthAvatar(w http.ResponseWriter, r *http.Request) {
	identity, ok := a.currentFeedbackIdentity(r)
	if !ok || identity.ProfileURL == "" {
		http.NotFound(w, r)
		return
	}
	a.proxyFeedbackAvatar(w, r, identity.Provider, identity.ProfileURL)
}

func (a *app) publicFeedbackAvatar(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	var provider, profileURL string
	if err := a.db.QueryRow(`SELECT auth_provider, profile_url FROM feedback WHERE id=? AND status='approved'`, id).Scan(&provider, &profileURL); err != nil || profileURL == "" {
		http.NotFound(w, r)
		return
	}
	a.proxyFeedbackAvatar(w, r, provider, profileURL)
}

func (a *app) adminFeedbackAvatar(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	var provider, profileURL string
	if err := a.db.QueryRow(`SELECT auth_provider, profile_url FROM feedback WHERE id=?`, id).Scan(&provider, &profileURL); err != nil || profileURL == "" {
		http.NotFound(w, r)
		return
	}
	a.proxyFeedbackAvatar(w, r, provider, profileURL)
}

func feedbackProviderConfigured(provider string) bool {
	switch provider {
	case "google":
		return strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_ID")) != "" && strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_SECRET")) != ""
	case "github":
		return strings.TrimSpace(os.Getenv("GITHUB_CLIENT_ID")) != "" && strings.TrimSpace(os.Getenv("GITHUB_CLIENT_SECRET")) != ""
	case "facebook":
		return strings.TrimSpace(os.Getenv("FACEBOOK_CLIENT_ID")) != "" && strings.TrimSpace(os.Getenv("FACEBOOK_CLIENT_SECRET")) != ""
	case "telegram":
		return strings.TrimSpace(os.Getenv("TELEGRAM_BOT_TOKEN")) != "" && strings.TrimSpace(os.Getenv("TELEGRAM_BOT_USERNAME")) != ""
	default:
		return false
	}
}

func (a *app) currentFeedbackIdentity(r *http.Request) (feedbackIdentity, bool) {
	cookie, err := r.Cookie(feedbackAuthCookie)
	if err != nil || cookie.Value == "" {
		return feedbackIdentity{}, false
	}
	var identity feedbackIdentity
	var expires time.Time
	err = a.db.QueryRow(`SELECT provider, provider_user_id, display_name, credential, profile_url, expires_at
		FROM feedback_auth_sessions WHERE token_hash=?`, tokenHash(cookie.Value)).Scan(
		&identity.Provider, &identity.ProviderUserID, &identity.DisplayName, &identity.Credential, &identity.ProfileURL, &expires,
	)
	if err != nil || time.Now().After(expires) {
		return feedbackIdentity{}, false
	}
	return identity, true
}

func (a *app) createFeedbackAuthSession(w http.ResponseWriter, r *http.Request, identity feedbackIdentity) error {
	token, err := randomToken(32)
	if err != nil {
		return err
	}
	now := time.Now()
	expires := now.Add(feedbackAuthLifetime)
	_, _ = a.db.Exec(`DELETE FROM feedback_auth_sessions WHERE expires_at < ?`, now)
	_, err = a.db.Exec(`INSERT INTO feedback_auth_sessions(token_hash,provider,provider_user_id,display_name,credential,profile_url,expires_at,created_at,updated_at)
		VALUES(?,?,?,?,?,?,?,?,?)`, tokenHash(token), identity.Provider, identity.ProviderUserID, identity.DisplayName, identity.Credential, identity.ProfileURL, expires, now, now)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     feedbackAuthCookie,
		Value:    token,
		Path:     "/",
		Expires:  expires,
		MaxAge:   int(feedbackAuthLifetime.Seconds()),
		HttpOnly: true,
		Secure:   isHTTPS(r, a.apiURL),
		SameSite: sessionSameSite(),
	})
	return nil
}

func (a *app) clearFeedbackAuthCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: feedbackAuthCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: isHTTPS(r, a.apiURL), SameSite: sessionSameSite()})
}

func (a *app) setFeedbackOAuthStateCookie(w http.ResponseWriter, r *http.Request, provider, state string) {
	value, _ := json.Marshal(oauthStateCookie{Provider: provider, State: state, Expires: time.Now().Add(feedbackOAuthStateTTL).Unix()})
	http.SetCookie(w, &http.Cookie{
		Name:     feedbackOAuthStateCookie,
		Value:    url.QueryEscape(string(value)),
		Path:     "/auth/feedback/",
		MaxAge:   int(feedbackOAuthStateTTL.Seconds()),
		HttpOnly: true,
		Secure:   isHTTPS(r, a.apiURL),
		SameSite: sessionSameSite(),
	})
}

func (a *app) clearFeedbackOAuthStateCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: feedbackOAuthStateCookie, Value: "", Path: "/auth/feedback/", MaxAge: -1, HttpOnly: true, Secure: isHTTPS(r, a.apiURL), SameSite: sessionSameSite()})
}

func (a *app) validFeedbackOAuthState(r *http.Request, provider, state string) bool {
	cookie, err := r.Cookie(feedbackOAuthStateCookie)
	if err != nil || state == "" {
		return false
	}
	raw, err := url.QueryUnescape(cookie.Value)
	if err != nil {
		return false
	}
	var saved oauthStateCookie
	if json.Unmarshal([]byte(raw), &saved) != nil || time.Now().Unix() > saved.Expires {
		return false
	}
	return saved.Provider == provider && hmac.Equal([]byte(saved.State), []byte(state))
}

func (a *app) feedbackOAuthCallbackURL(r *http.Request, provider string) string {
	return strings.TrimRight(a.feedbackPublicOrigin(r), "/") + "/auth/feedback/" + url.PathEscape(provider) + "/callback"
}

func (a *app) feedbackPublicOrigin(_ *http.Request) string { return a.apiURL }

func (a *app) feedbackAuthRedirect(w http.ResponseWriter, r *http.Request, status string) {
	http.Redirect(w, r, a.appURL+"/?feedback_auth="+url.QueryEscape(status)+"#feedback", http.StatusSeeOther)
}

func (a *app) googleFeedbackIdentity(r *http.Request, code string) (feedbackIdentity, error) {
	return googleIdentityForCallback(a.feedbackOAuthCallbackURL(r, "google"), code)
}

func googleIdentityForCallback(callback, code string) (feedbackIdentity, error) {
	form := url.Values{
		"code":          {code},
		"client_id":     {os.Getenv("GOOGLE_CLIENT_ID")},
		"client_secret": {os.Getenv("GOOGLE_CLIENT_SECRET")},
		"redirect_uri":  {callback},
		"grant_type":    {"authorization_code"},
	}
	var token struct {
		AccessToken string `json:"access_token"`
	}
	if err := oauthPostFormJSON("https://oauth2.googleapis.com/token", form, nil, &token); err != nil || token.AccessToken == "" {
		return feedbackIdentity{}, fmt.Errorf("google token exchange failed")
	}
	var user struct {
		Sub     string `json:"sub"`
		Name    string `json:"name"`
		Email   string `json:"email"`
		Picture string `json:"picture"`
	}
	if err := oauthGetJSON("https://openidconnect.googleapis.com/v1/userinfo", token.AccessToken, &user); err != nil {
		return feedbackIdentity{}, err
	}
	return feedbackIdentity{Provider: "google", ProviderUserID: user.Sub, DisplayName: user.Name, Credential: strings.ToLower(user.Email), ProfileURL: user.Picture}, nil
}

func (a *app) githubFeedbackIdentity(r *http.Request, code string) (feedbackIdentity, error) {
	callback := a.feedbackOAuthCallbackURL(r, "github")
	form := url.Values{
		"client_id":     {os.Getenv("GITHUB_CLIENT_ID")},
		"client_secret": {os.Getenv("GITHUB_CLIENT_SECRET")},
		"code":          {code},
		"redirect_uri":  {callback},
	}
	var token struct {
		AccessToken string `json:"access_token"`
	}
	headers := map[string]string{"Accept": "application/json"}
	if err := oauthPostFormJSON("https://github.com/login/oauth/access_token", form, headers, &token); err != nil || token.AccessToken == "" {
		return feedbackIdentity{}, fmt.Errorf("github token exchange failed")
	}
	var user struct {
		ID        int64  `json:"id"`
		Login     string `json:"login"`
		Name      string `json:"name"`
		AvatarURL string `json:"avatar_url"`
	}
	if err := oauthGetJSON("https://api.github.com/user", token.AccessToken, &user); err != nil {
		return feedbackIdentity{}, err
	}
	name := strings.TrimSpace(user.Name)
	if name == "" {
		name = user.Login
	}
	credential := "@" + user.Login
	return feedbackIdentity{Provider: "github", ProviderUserID: fmt.Sprint(user.ID), DisplayName: name, Credential: credential, ProfileURL: user.AvatarURL}, nil
}

func (a *app) facebookFeedbackIdentity(r *http.Request, code string) (feedbackIdentity, error) {
	callback := a.feedbackOAuthCallbackURL(r, "facebook")
	q := url.Values{
		"client_id":     {os.Getenv("FACEBOOK_CLIENT_ID")},
		"client_secret": {os.Getenv("FACEBOOK_CLIENT_SECRET")},
		"redirect_uri":  {callback},
		"code":          {code},
	}
	var token struct {
		AccessToken string `json:"access_token"`
	}
	if err := oauthGetJSONNoAuth("https://graph.facebook.com/oauth/access_token?"+q.Encode(), &token); err != nil || token.AccessToken == "" {
		return feedbackIdentity{}, fmt.Errorf("facebook token exchange failed")
	}
	var user struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Email   string `json:"email"`
		Picture struct {
			Data struct {
				URL string `json:"url"`
			} `json:"data"`
		} `json:"picture"`
	}
	profileURL := "https://graph.facebook.com/me?" + url.Values{
		"fields":       {"id,name,email,picture.type(large)"},
		"access_token": {token.AccessToken},
	}.Encode()
	if err := oauthGetJSONNoAuth(profileURL, &user); err != nil {
		return feedbackIdentity{}, err
	}
	credential := strings.ToLower(strings.TrimSpace(user.Email))
	if credential == "" {
		credential = "Facebook ID " + user.ID
	}
	return feedbackIdentity{Provider: "facebook", ProviderUserID: user.ID, DisplayName: user.Name, Credential: credential, ProfileURL: user.Picture.Data.URL}, nil
}

func (a *app) serveTelegramFeedbackLogin(w http.ResponseWriter, callback, state string) {
	username := strings.TrimPrefix(strings.TrimSpace(os.Getenv("TELEGRAM_BOT_USERNAME")), "@")
	if username == "" {
		writeError(w, http.StatusServiceUnavailable, "Telegram sign-in is not configured.")
		return
	}
	callbackURL, err := url.Parse(callback)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to start Telegram sign-in.")
		return
	}
	q := callbackURL.Query()
	q.Set("state", state)
	callbackURL.RawQuery = q.Encode()

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'self' https://telegram.org https://oauth.telegram.org; script-src https://telegram.org; frame-src https://oauth.telegram.org; img-src 'self' data: https:; style-src 'unsafe-inline'; base-uri 'none'; form-action https://oauth.telegram.org")

	page := template.Must(template.New("telegram-login").Parse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Telegram verification</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f8fa;color:#1e2735;font:500 15px/1.5 system-ui,sans-serif}.card{width:min(92vw,420px);padding:28px;text-align:center;border:1px solid #dfe4ea;border-radius:18px;background:#fff;box-shadow:0 18px 50px rgba(20,30,45,.08)}h1{font-size:1.25rem;margin:0 0 8px}p{margin:0 0 20px;color:#687284;font-size:.86rem}.back{display:inline-block;margin-top:18px;color:#167e59;text-decoration:none;font-weight:700}</style></head><body><main class="card"><h1>Verify with Telegram</h1><p>Telegram will share your profile identity for this feedback. This legacy bot login does not provide your phone number.</p><script async src="https://telegram.org/js/telegram-widget.js?22" data-telegram-login="{{.Username}}" data-size="large" data-userpic="true" data-auth-url="{{.Callback}}"></script><a class="back" href="/#feedback">Cancel and return</a></main></body></html>`))
	_ = page.Execute(w, map[string]string{"Username": username, "Callback": callbackURL.String()})
}

func telegramIdentityFromCallback(r *http.Request, botToken string) (feedbackIdentity, error) {
	if strings.TrimSpace(botToken) == "" {
		return feedbackIdentity{}, fmt.Errorf("telegram bot token missing")
	}
	q := r.URL.Query()
	givenHash := strings.TrimSpace(q.Get("hash"))
	if givenHash == "" {
		return feedbackIdentity{}, fmt.Errorf("telegram signature missing")
	}
	keys := make([]string, 0, len(q))
	for key := range q {
		if key != "hash" && key != "state" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+q.Get(key))
	}
	secret := sha256.Sum256([]byte(botToken))
	mac := hmac.New(sha256.New, secret[:])
	_, _ = mac.Write([]byte(strings.Join(parts, "\n")))
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(strings.ToLower(givenHash)), []byte(expected)) {
		return feedbackIdentity{}, fmt.Errorf("telegram signature invalid")
	}
	unixValue := strings.TrimSpace(q.Get("auth_date"))
	if unixValue == "" {
		return feedbackIdentity{}, fmt.Errorf("telegram authorization date missing")
	}
	var unix int64
	if _, err := fmt.Sscan(unixValue, &unix); err != nil || time.Since(time.Unix(unix, 0)) > 10*time.Minute || time.Unix(unix, 0).After(time.Now().Add(time.Minute)) {
		return feedbackIdentity{}, fmt.Errorf("telegram authorization expired")
	}
	id := strings.TrimSpace(q.Get("id"))
	first := strings.TrimSpace(q.Get("first_name"))
	last := strings.TrimSpace(q.Get("last_name"))
	name := strings.TrimSpace(strings.Join([]string{first, last}, " "))
	username := strings.TrimSpace(q.Get("username"))
	credential := "Telegram ID " + id
	if username != "" {
		credential = "@" + username
	}
	return feedbackIdentity{Provider: "telegram", ProviderUserID: id, DisplayName: name, Credential: credential, ProfileURL: strings.TrimSpace(q.Get("photo_url"))}, nil
}

func oauthPostFormJSON(endpoint string, form url.Values, headers map[string]string, dst any) error {
	req, err := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	return oauthDoJSON(req, dst)
}

func oauthGetJSON(endpoint, accessToken string, dst any) error {
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "JPano-Portfolio")
	return oauthDoJSON(req, dst)
}

func oauthGetJSONNoAuth(endpoint string, dst any) error {
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	return oauthDoJSON(req, dst)
}

func oauthDoJSON(req *http.Request, dst any) error {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("oauth provider returned %s", resp.Status)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(dst)
}

func validFeedbackAvatarURL(provider, raw string) bool {
	if strings.TrimSpace(raw) == "" {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || !strings.EqualFold(u.Scheme, "https") || u.User != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	allowed := func(exact string, suffixes ...string) bool {
		if host == exact {
			return true
		}
		for _, suffix := range suffixes {
			if strings.HasSuffix(host, suffix) {
				return true
			}
		}
		return false
	}
	switch provider {
	case "google":
		return allowed("lh3.googleusercontent.com", ".googleusercontent.com")
	case "github":
		return allowed("avatars.githubusercontent.com", ".githubusercontent.com")
	case "facebook":
		return allowed("graph.facebook.com", ".fbcdn.net", ".fbsbx.com")
	case "telegram":
		return allowed("t.me", ".telegram.org", ".telesco.pe")
	default:
		return false
	}
}

func (a *app) proxyFeedbackAvatar(w http.ResponseWriter, r *http.Request, provider, rawURL string) {
	if !validFeedbackAvatarURL(provider, rawURL) {
		http.NotFound(w, r)
		return
	}
	client := publicHTTPClient(6 * time.Second)
	defer client.CloseIdleConnections()
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 || !validFeedbackAvatarURL(provider, req.URL.String()) {
			return http.ErrUseLastResponse
		}
		return nil
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, rawURL, nil)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	req.Header.Set("User-Agent", "JPano-Portfolio/1.0")
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if resp != nil {
			resp.Body.Close()
		}
		http.NotFound(w, r)
		return
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, (2<<20)+1))
	if err != nil || len(data) == 0 || len(data) > 2<<20 {
		http.NotFound(w, r)
		return
	}
	contentType := http.DetectContentType(data)
	if !contains([]string{"image/jpeg", "image/png", "image/gif", "image/webp"}, contentType) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("Content-Length", fmt.Sprint(len(data)))
	_, _ = io.Copy(w, bytes.NewReader(data))
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
