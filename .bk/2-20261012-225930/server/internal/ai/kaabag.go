// Package ai is a private, stateless adapter for KaaBAG's chat completion API.
// No KaaBAG credentials or prompt text are ever returned to the browser or logged.
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type Client struct {
	Endpoint string
	APIKey   string
	Model    string
	HTTP     *http.Client
}

func New(base, token, model string) (*Client, error) {
	token = strings.TrimSpace(token)
	base = strings.TrimSpace(base)
	if !strings.HasPrefix(base, "https://") && !strings.HasPrefix(base, "http://127.0.0.1:") && !strings.HasPrefix(base, "http://localhost:") {
		return nil, errors.New("KaaBAG must use HTTPS or explicit local development address")
	}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("invalid KaaBAG API address")
	}
	// Accept an origin or the full, known KaaBAG completion path.
	path := strings.TrimSuffix(u.Path, "/")
	if path != "" && path != "/api/v1/chat/completions" {
		return nil, errors.New("unexpected KaaBAG path")
	}
	u.Path = "/api/v1/chat/completions"
	return &Client{Endpoint: u.String(), APIKey: token, Model: strings.TrimSpace(model), HTTP: &http.Client{Timeout: 35 * time.Second}}, nil
}
func (c *Client) Configured() bool { return c != nil && c.APIKey != "" }
func (c *Client) Chat(ctx context.Context, messages []Message) (string, error) {
	if !c.Configured() {
		return "", errors.New("KaaBAG API key is not configured")
	}
	if len(messages) < 2 || len(messages) > 22 {
		return "", errors.New("invalid AI message length")
	}
	for _, m := range messages {
		if m.Role != "system" && m.Role != "user" && m.Role != "assistant" {
			return "", errors.New("invalid AI role")
		}
		if len(m.Content) > 24000 {
			return "", errors.New("AI prompt too large")
		}
	}
	payload := map[string]any{"messages": messages, "stream": false}
	if c.Model != "" {
		payload["model"] = c.Model
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	if len(data) > 47000 {
		return "", errors.New("AI request exceeds limit")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoint, bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	response, err := c.HTTP.Do(req)
	if err != nil {
		return "", errors.New("AI service unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("AI service returned HTTP %d", response.StatusCode)
	}
	limited, err := io.ReadAll(io.LimitReader(response.Body, 256*1024+1))
	if err != nil {
		return "", errors.New("AI response unreadable")
	}
	if len(limited) > 256*1024 {
		return "", errors.New("AI response exceeds limit")
	}
	var completion struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err = json.Unmarshal(limited, &completion); err != nil || len(completion.Choices) == 0 {
		return "", errors.New("AI returned no chat completion")
	}
	answer := strings.TrimSpace(completion.Choices[0].Message.Content)
	if answer == "" {
		return "", errors.New("AI returned an empty answer")
	}
	if len(answer) > 6500 {
		answer = string([]rune(answer)[:min(3500, len([]rune(answer)))]) + "\n\n_Answer shortened for the chat panel._"
	}
	return answer, nil
}
