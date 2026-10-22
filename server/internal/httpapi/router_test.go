package httpapi_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"noreplay/server/internal/httpapi"
	"noreplay/server/internal/store"
)

func TestHealthzReturnsOK(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "health.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	defer st.Close()

	srv := httptest.NewServer(httpapi.NewRouter(st, httpapi.Options{}))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if got := strings.TrimSpace(string(body)); got != `{"status":"ok"}` {
		t.Errorf("body = %q, want %q", got, `{"status":"ok"}`)
	}
}

func TestCORSHeadersOnPreflightAndResponse(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "cors.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	defer st.Close()

	srv := httptest.NewServer(httpapi.NewRouter(st, httpapi.Options{}))
	defer srv.Close()

	// Preflight OPTIONS must be answered with 204 and CORS headers.
	req, _ := http.NewRequest(http.MethodOptions, srv.URL+"/v1/signup", nil)
	req.Header.Set("Origin", "moz-extension://abc")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("OPTIONS /v1/signup: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("preflight status = %d, want 204", resp.StatusCode)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("Access-Control-Allow-Origin = %q, want *", got)
	}
	if got := resp.Header.Get("Access-Control-Allow-Methods"); !strings.Contains(got, "POST") {
		t.Errorf("Access-Control-Allow-Methods = %q, want POST", got)
	}
	if got := resp.Header.Get("Access-Control-Allow-Headers"); !strings.Contains(got, "Authorization") {
		t.Errorf("Access-Control-Allow-Headers = %q, want Authorization", got)
	}

	// Actual POST must also carry Access-Control-Allow-Origin.
	req2, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/signup", strings.NewReader(`{"email":"x@y.z","password":"password1234"}`))
	req2.Header.Set("Origin", "moz-extension://abc")
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatalf("POST /v1/signup: %v", err)
	}
	defer resp2.Body.Close()
	if got := resp2.Header.Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("Access-Control-Allow-Origin = %q, want *", got)
	}
	if got := resp2.Header.Get("Access-Control-Expose-Headers"); !strings.Contains(got, "Retry-After") {
		t.Errorf("Access-Control-Expose-Headers = %q, want Retry-After", got)
	}
}
