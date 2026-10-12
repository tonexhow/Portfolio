package main

// Server-only multi-provider AI routing. Admin credentials are encrypted at rest;
// public endpoints never return keys, models or provider-specific errors.
import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"jpano.dev/portfolio/internal/ai"
)

var aiCooldown = struct {
	sync.Mutex
	until map[string]time.Time
}{until: map[string]time.Time{}}
var providers = map[string]struct{}{"kaabag": {}, "gemini": {}, "groq": {}, "cloudflare": {}, "mistral": {}, "cohere": {}, "openrouter": {}}
var providerEnv = map[string]string{"kaabag": "KAABAG_API_KEY", "gemini": "GEMINI_API_KEYS", "groq": "GROQ_API_KEYS", "cloudflare": "CLOUDFLARE_WORKERS_API_KEYS", "mistral": "MISTRAL_API_KEYS", "cohere": "COHERE_API_KEYS", "openrouter": "OPENROUTER_API_KEYS"}
var providerModelDefault = map[string]string{"gemini": "gemini-2.5-flash", "groq": "llama-3.3-70b-versatile", "cloudflare": "@cf/meta/llama-3.1-8b-instruct", "mistral": "mistral-small-latest", "cohere": "command-a-03-2025", "openrouter": "openai/gpt-4o-mini"}

type aiRoute struct {
	Provider, Label, Model, Key, ID string
	Priority                        int
}
type aiProviderConfig struct {
	ID       string `json:"id"`
	Provider string `json:"provider"`
	Label    string `json:"label"`
	Model    string `json:"model"`
	Enabled  bool   `json:"enabled"`
	Priority int    `json:"priority"`
	HasKey   bool   `json:"has_key"`
	KeyHint  string `json:"key_hint"`
	Source   string `json:"source"`
}

func aiKeyMaterial() ([]byte, error) {
	raw := strings.TrimSpace(os.Getenv("AI_KEY_ENCRYPTION_KEY"))
	if raw == "" {
		return nil, errors.New("set AI_KEY_ENCRYPTION_KEY to a new random base64-encoded 32-byte value before storing Admin AI keys")
	}
	for _, decode := range []func(string) ([]byte, error){base64.StdEncoding.DecodeString, base64.RawStdEncoding.DecodeString, base64.RawURLEncoding.DecodeString} {
		if b, err := decode(raw); err == nil && len(b) == 32 {
			return b, nil
		}
	}
	return nil, errors.New("AI_KEY_ENCRYPTION_KEY must be base64 encoded 32 bytes")
}
func encryptAIKey(secret string) (string, error) {
	key, err := aiKeyMaterial()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	g, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, g.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.RawStdEncoding.EncodeToString(append(nonce, g.Seal(nil, nonce, []byte(secret), []byte("jpano:ai:v1"))...)), nil
}
func decryptAIKey(data string) (string, error) {
	key, err := aiKeyMaterial()
	if err != nil {
		return "", err
	}
	payload, err := base64.RawStdEncoding.DecodeString(data)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	g, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(payload) < g.NonceSize() {
		return "", errors.New("invalid stored key")
	}
	raw, err := g.Open(nil, payload[:g.NonceSize()], payload[g.NonceSize():], []byte("jpano:ai:v1"))
	return string(raw), err
}
func keyHint(key string) string {
	key = strings.TrimSpace(key)
	if len(key) < 6 {
		return "••••"
	}
	return "••••" + key[len(key)-4:]
}
func validAIProvider(s string) bool { _, ok := providers[s]; return ok }
func modelFor(provider, model string) string {
	if model != "" {
		return model
	}
	if envModel := strings.TrimSpace(os.Getenv(strings.ToUpper(provider) + "_MODEL")); envModel != "" {
		return envModel
	}
	return providerModelDefault[provider]
}
func configuredRoutes(db *sql.DB) []aiRoute {
	routes := []aiRoute{}
	if db != nil {
		rows, err := db.Query(`SELECT id,provider,label,model,key_ciphertext,priority FROM portfolio.ai_provider_configs WHERE enabled=true ORDER BY priority,id LIMIT 100`)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id, p, label, model, ciphertext string
				var priority int
				if rows.Scan(&id, &p, &label, &model, &ciphertext, &priority) != nil || !validAIProvider(p) {
					continue
				}
				key, err := decryptAIKey(ciphertext)
				if err != nil || key == "" {
					continue
				}
				routes = append(routes, aiRoute{Provider: p, Label: label, Model: modelFor(p, model), Key: key, ID: id, Priority: priority})
			}
			// A failed iteration must not produce a partial, misleading route list.
			if rows.Err() != nil {
				routes = routes[:0]
			}
		}
	}
	// Saved Admin routes take precedence; existing .env keys are always a backup.
	for _, p := range []string{"kaabag", "gemini", "groq", "cloudflare", "mistral", "cohere", "openrouter"} {
		value := os.Getenv(providerEnv[p])
		for n, raw := range strings.Split(value, ",") {
			key := strings.TrimSpace(raw)
			if key == "" {
				continue
			}
			routes = append(routes, aiRoute{Provider: p, Model: modelFor(p, ""), Key: key, ID: fmt.Sprintf("env:%s:%d", p, n), Priority: 1000 + n})
		}
	}
	sort.SliceStable(routes, func(i, j int) bool {
		// Admin-managed, explicitly selected credentials precede .env fallbacks
		// regardless of the editable priority assigned inside each category.
		iEnv := strings.HasPrefix(routes[i].ID, "env:")
		jEnv := strings.HasPrefix(routes[j].ID, "env:")
		if iEnv != jEnv {
			return !iEnv
		}
		return routes[i].Priority < routes[j].Priority
	})
	return routes
}
func (a *app) aiRoutes() []aiRoute {
	if a.db == nil {
		return configuredRoutes(nil)
	}
	return configuredRoutes(a.db.DB)
}
func aiRouteReady(route aiRoute) bool {
	return route.Provider != "cloudflare" || strings.TrimSpace(os.Getenv("CLOUDFLARE_ACCOUNT_ID")) != ""
}
func aiCooldownID(route aiRoute) string {
	h := sha256.Sum256([]byte(route.Provider + "\x00" + route.Key))
	return base64.RawURLEncoding.EncodeToString(h[:12])
}
func isAICooling(route aiRoute) bool {
	aiCooldown.Lock()
	defer aiCooldown.Unlock()
	return time.Now().Before(aiCooldown.until[aiCooldownID(route)])
}
func coolAI(route aiRoute, d time.Duration) {
	aiCooldown.Lock()
	aiCooldown.until[aiCooldownID(route)] = time.Now().Add(d)
	aiCooldown.Unlock()
}
func aiConfigured(a *app) bool {
	for _, r := range a.aiRoutes() {
		if aiRouteReady(r) {
			return true
		}
	}
	return false
}
func gatewayChat(ctx context.Context, a *app, messages []ai.Message) (string, string, error) {
	attempted := 0
	for _, route := range a.aiRoutes() {
		if !aiRouteReady(route) || isAICooling(route) {
			continue
		}
		attempted++
		if attempted > 12 {
			break
		}
		reply, err := callAIRoute(ctx, route, messages)
		if err == nil && strings.TrimSpace(reply) != "" {
			return strings.TrimSpace(reply), route.Provider, nil
		}
		coolAI(route, 45*time.Second)
		if ctx.Err() != nil {
			break
		}
	}
	return "", "", errors.New("no verified AI provider response")
}
func callAIRoute(ctx context.Context, route aiRoute, messages []ai.Message) (string, error) {
	if route.Provider == "kaabag" {
		c, err := ai.New(env("KAABAG_API_BASE_URL", "https://kaabag.bcc-edu.ph"), route.Key, route.Model)
		if err != nil {
			return "", err
		}
		return c.Chat(ctx, messages)
	}
	var endpoint string
	var body any
	switch route.Provider {
	case "gemini":
		endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + route.Model + ":generateContent"
		parts := []map[string]any{}
		system := ""
		for _, m := range messages {
			if m.Role == "system" {
				system += m.Content + "\n"
				continue
			}
			role := "user"
			if m.Role == "assistant" {
				role = "model"
			}
			parts = append(parts, map[string]any{"role": role, "parts": []map[string]string{{"text": m.Content}}})
		}
		body = map[string]any{"systemInstruction": map[string]any{"parts": []map[string]string{{"text": system}}}, "contents": parts, "generationConfig": map[string]any{"maxOutputTokens": 1000}}
	case "groq", "mistral", "openrouter":
		endpoints := map[string]string{"groq": "https://api.groq.com/openai/v1/chat/completions", "mistral": "https://api.mistral.ai/v1/chat/completions", "openrouter": "https://openrouter.ai/api/v1/chat/completions"}
		endpoint = endpoints[route.Provider]
		body = map[string]any{"model": route.Model, "messages": messages, "max_tokens": 1000, "temperature": 0.5}
	case "cohere":
		endpoint = "https://api.cohere.com/v2/chat"
		body = map[string]any{"model": route.Model, "messages": messages, "max_tokens": 1000}
	case "cloudflare":
		account := strings.TrimSpace(os.Getenv("CLOUDFLARE_ACCOUNT_ID"))
		if account == "" {
			return "", errors.New("Cloudflare account ID missing")
		}
		endpoint = "https://api.cloudflare.com/client/v4/accounts/" + account + "/ai/run/" + route.Model
		body = map[string]any{"messages": messages, "max_tokens": 1000}
	default:
		return "", errors.New("unsupported provider")
	}
	data, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if route.Provider == "gemini" {
		req.Header.Set("x-goog-api-key", route.Key)
	} else {
		req.Header.Set("Authorization", "Bearer "+route.Key)
	}
	if route.Provider == "openrouter" {
		req.Header.Set("HTTP-Referer", "https://jpano.dev")
		req.Header.Set("X-Title", "JPano Portfolio")
	}
	client := &http.Client{Timeout: 11 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return "", fmt.Errorf("AI service response %d", res.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, 550*1024))
	if err != nil {
		return "", err
	}
	var v map[string]any
	if json.Unmarshal(raw, &v) != nil {
		return "", errors.New("invalid AI response")
	}
	// Only specific text response shapes are consumed. Never return provider metadata.
	switch route.Provider {
	case "gemini":
		candidates, _ := v["candidates"].([]any)
		if len(candidates) > 0 {
			first, _ := candidates[0].(map[string]any)
			content, _ := first["content"].(map[string]any)
			parts, _ := content["parts"].([]any)
			for _, part := range parts {
				item, _ := part.(map[string]any)
				if response, ok := item["text"].(string); ok {
					return strings.TrimSpace(response), nil
				}
			}
		}
	case "cloudflare":
		value, _ := v["result"].(map[string]any)
		if response, ok := value["response"].(string); ok {
			return strings.TrimSpace(response), nil
		}
	case "cohere":
		msg, _ := v["message"].(map[string]any)
		parts, _ := msg["content"].([]any)
		for _, part := range parts {
			item, _ := part.(map[string]any)
			if response, ok := item["text"].(string); ok {
				return strings.TrimSpace(response), nil
			}
		}
	default:
		choices, _ := v["choices"].([]any)
		if len(choices) > 0 {
			first, _ := choices[0].(map[string]any)
			msg, _ := first["message"].(map[string]any)
			if response, ok := msg["content"].(string); ok {
				return strings.TrimSpace(response), nil
			}
		}
	}
	return "", errors.New("empty AI completion")
}

// Read/edit are protected by the existing requireAdmin HTTP-only session middleware.
func (a *app) adminAIProviders(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(`SELECT id,provider,label,model,key_hint,enabled,priority FROM portfolio.ai_provider_configs ORDER BY priority,created_at LIMIT 150`)
	if err != nil {
		writeError(w, 503, "AI settings require schema alignment.")
		return
	}
	defer rows.Close()
	entries := []aiProviderConfig{}
	for rows.Next() {
		var entry aiProviderConfig
		if rows.Scan(&entry.ID, &entry.Provider, &entry.Label, &entry.Model, &entry.KeyHint, &entry.Enabled, &entry.Priority) != nil {
			continue
		}
		entry.HasKey = entry.KeyHint != ""
		entry.Source = "Admin"
		entries = append(entries, entry)
	}
	if rows.Err() != nil {
		writeError(w, 503, "Unable to finish reading AI providers.")
		return
	}
	_, encryptErr := aiKeyMaterial()
	keyState := "ready"
	if encryptErr != nil {
		keyState = "invalid"
		if strings.TrimSpace(os.Getenv("AI_KEY_ENCRYPTION_KEY")) == "" {
			keyState = "missing"
		}
	}
	writeJSON(w, 200, map[string]any{"items": entries, "encryption_ready": encryptErr == nil, "encryption_state": keyState, "auto_drafts": os.Getenv("AI_AUTODRAFT_ENABLED") == "true", "auto_send": os.Getenv("AI_AUTOSEND_ENABLED") == "true", "online": time.Since(time.Unix(lastAISuccess.Load(), 0)) < 3*time.Minute})
}

// Explicit Admin-only reveal for credential rotation. No plaintext on listing,
// logs or storage; response is always no-store and subject to rate limiting.
func (a *app) adminAIReveal(w http.ResponseWriter, r *http.Request) {
	if !a.allow(r, "ai-key-reveal", 12, time.Hour) {
		writeError(w, 429, "Too many key reveal requests.")
		return
	}
	var ciphertext string
	err := a.db.QueryRow(`SELECT key_ciphertext FROM portfolio.ai_provider_configs WHERE id=?`, r.PathValue("id")).Scan(&ciphertext)
	if err != nil {
		writeError(w, 404, "Saved provider not found.")
		return
	}
	key, err := decryptAIKey(ciphertext)
	if err != nil {
		writeError(w, 503, "Saved key cannot be decrypted. Check server key configuration.")
		return
	}
	w.Header().Set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	writeJSON(w, 200, map[string]string{"api_key": key})
}
func (a *app) adminAICreate(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Provider string `json:"provider"`
		Label    string `json:"label"`
		Model    string `json:"model"`
		APIKey   string `json:"api_key"`
		Enabled  *bool  `json:"enabled"`
		Priority int    `json:"priority"`
	}
	if decodeJSONWithLimit(r, &in, 9*1024) != nil {
		writeError(w, 400, "Invalid provider settings.")
		return
	}
	in.Provider = strings.ToLower(strings.TrimSpace(in.Provider))
	in.Label = clean(in.Label, 80)
	in.Model = clean(in.Model, 140)
	key := strings.TrimSpace(in.APIKey)
	if !validAIProvider(in.Provider) || key == "" || len(key) > 4000 || in.Priority < 0 || in.Priority > 10000 {
		writeError(w, 400, "Choose a provider and valid key, model and priority.")
		return
	}
	ciphertext, err := encryptAIKey(key)
	if err != nil {
		writeError(w, 503, "Private encryption key is missing or invalid. Use 32 random bytes encoded as base64 in the server environment, then restart the Server.")
		return
	}
	id, err := randomOfferToken("ai_")
	if err != nil {
		writeError(w, 500, "Unable to save provider.")
		return
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}
	_, err = a.db.Exec(`INSERT INTO portfolio.ai_provider_configs(id,provider,label,model,key_ciphertext,key_hint,enabled,priority) VALUES(?,?,?,?,?,?,?,?)`, id, in.Provider, in.Label, in.Model, ciphertext, keyHint(key), enabled, in.Priority)
	if err != nil {
		writeError(w, 503, "Unable to save AI provider.")
		return
	}
	writeJSON(w, 201, map[string]any{"id": id, "saved": true})
}
func (a *app) adminAIUpdate(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var in struct {
		Label    string `json:"label"`
		Model    string `json:"model"`
		APIKey   string `json:"api_key"`
		Enabled  *bool  `json:"enabled"`
		Priority *int   `json:"priority"`
	}
	if decodeJSONWithLimit(r, &in, 9*1024) != nil {
		writeError(w, 400, "Invalid provider settings.")
		return
	}
	in.Label = clean(in.Label, 80)
	in.Model = clean(in.Model, 140)
	if in.Priority != nil && (*in.Priority < 0 || *in.Priority > 10000) {
		writeError(w, 400, "Invalid priority.")
		return
	}
	var result sql.Result
	var err error
	if key := strings.TrimSpace(in.APIKey); key != "" {
		if len(key) > 4000 {
			writeError(w, 400, "API key too long.")
			return
		}
		ciphertext, encryptErr := encryptAIKey(key)
		if encryptErr != nil {
			writeError(w, 503, "Private encryption key is missing or invalid. Configure 32 random bytes encoded as base64 on the Server and restart it.")
			return
		}
		result, err = a.db.Exec(`UPDATE portfolio.ai_provider_configs SET label=?,model=?,priority=COALESCE(?,priority),enabled=COALESCE(?,enabled),key_ciphertext=?,key_hint=?,updated_at=NOW() WHERE id=?`, in.Label, in.Model, in.Priority, in.Enabled, ciphertext, keyHint(key), id)
	} else {
		result, err = a.db.Exec(`UPDATE portfolio.ai_provider_configs SET label=?,model=?,priority=COALESCE(?,priority),enabled=COALESCE(?,enabled),updated_at=NOW() WHERE id=?`, in.Label, in.Model, in.Priority, in.Enabled, id)
	}
	if err != nil {
		writeError(w, 503, "Unable to update AI provider.")
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		writeError(w, 404, "Provider not found.")
		return
	}
	writeJSON(w, 200, map[string]any{"saved": true})
}
func (a *app) adminAIDelete(w http.ResponseWriter, r *http.Request) {
	result, err := a.db.Exec(`DELETE FROM portfolio.ai_provider_configs WHERE id=?`, r.PathValue("id"))
	if err != nil {
		writeError(w, 503, "Unable to delete provider.")
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		writeError(w, 404, "Provider not found.")
		return
	}
	writeJSON(w, 200, map[string]any{"deleted": true})
}

// Admin-only, on-demand provider reachability report. Each provider is probed
// using one configured route (max 7), without exposing raw keys or responses.
// Total sequential test budget is at most 35s, below the HTTP server write timeout.
func (a *app) adminAIHealth(w http.ResponseWriter, r *http.Request) {
	if !a.allow(r, "ai-health-probe", 3, 10*time.Minute) {
		writeError(w, 429, "AI diagnostics were run recently. Please wait.")
		return
	}
	routes := a.aiRoutes()
	tested := map[string]bool{}
	items := []map[string]any{}
	for _, route := range routes {
		if tested[route.Provider] {
			continue
		}
		tested[route.Provider] = true
		result := map[string]any{"provider": route.Provider, "status": "unavailable"}
		if !aiRouteReady(route) {
			result["status"] = "not_configured"
			items = append(items, result)
			continue
		}
		if isAICooling(route) {
			result["status"] = "cooldown"
			items = append(items, result)
			continue
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		began := time.Now()
		reply, err := callAIRoute(ctx, route, []ai.Message{{Role: "user", Content: "Reply only with OK."}})
		cancel()
		if err == nil && strings.TrimSpace(reply) != "" {
			result["status"] = "online"
			result["latency_ms"] = time.Since(began).Milliseconds()
			lastAISuccess.Store(time.Now().Unix())
		}
		items = append(items, result)
		if r.Context().Err() != nil {
			break
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, map[string]any{"providers": items, "count": len(items), "checked_at": time.Now().UTC()})
}
