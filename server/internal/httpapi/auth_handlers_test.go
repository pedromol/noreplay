package httpapi_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"noreplay/server/internal/auth"
	"noreplay/server/internal/httpapi"
	"noreplay/server/internal/store"
)

const (
	allowlistedEmail = "owner@example.com"
	goodPassword     = "twelve-chars-ok"
)

type testClock struct {
	mu sync.Mutex
	t  time.Time
}

func newTestClock() *testClock {
	return &testClock{t: time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)}
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *testClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

type testEnv struct {
	server *httptest.Server
	store  *store.Store
	clock  *testClock
	dbPath string
	opts   httpapi.Options
}

// newTestEnv wires NewRouter plus an authenticated /v1/me probe behind
// RequireAuth so the middleware and UserFromContext can be exercised.
func newTestEnv(t *testing.T, mutate func(*httpapi.Options)) *testEnv {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "auth.db")
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })

	clock := newTestClock()
	opts := httpapi.Options{
		Store:       st,
		SignupEmail: allowlistedEmail,
		Now:         clock.Now,
	}
	if mutate != nil {
		mutate(&opts)
	}

	root := http.NewServeMux()
	root.Handle("/v1/", httpapi.NewRouter(st, opts))
	root.Handle("/v1/me", httpapi.RequireAuth(opts)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := httpapi.UserFromContext(r.Context())
		if !ok {
			http.Error(w, "no user in context", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"email": u.Email})
	})))

	srv := httptest.NewServer(root)
	t.Cleanup(srv.Close)

	return &testEnv{server: srv, store: st, clock: clock, dbPath: dbPath, opts: opts}
}

func (e *testEnv) request(t *testing.T, method, path, body, token string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, e.server.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatalf("build %s %s: %v", method, path, err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return resp
}

func (e *testEnv) post(t *testing.T, path, body, token string) *http.Response {
	t.Helper()
	return e.request(t, http.MethodPost, path, body, token)
}

func (e *testEnv) get(t *testing.T, path, token string) *http.Response {
	t.Helper()
	return e.request(t, http.MethodGet, path, "", token)
}

func readBody(t *testing.T, resp *http.Response) string {
	t.Helper()
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return string(b)
}

func credentialsJSON(email, password string) string {
	return `{"email":"` + email + `","password":"` + password + `"}`
}

func credentialsBody(t *testing.T, email, password string) string {
	t.Helper()
	b, err := json.Marshal(map[string]string{"email": email, "password": password})
	if err != nil {
		t.Fatalf("marshal credentials: %v", err)
	}
	return string(b)
}

func signup(t *testing.T, e *testEnv, email, password string) *http.Response {
	t.Helper()
	return e.post(t, "/v1/signup", credentialsJSON(email, password), "")
}

func login(t *testing.T, e *testEnv, email, password string) *http.Response {
	t.Helper()
	return e.post(t, "/v1/login", credentialsJSON(email, password), "")
}

func tokenFrom(t *testing.T, resp *http.Response) string {
	t.Helper()
	body := readBody(t, resp)
	var payload struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		t.Fatalf("decode token from %q: %v", body, err)
	}
	if payload.Token == "" {
		t.Fatalf("empty token in %q", body)
	}
	return payload.Token
}

func TestSignupCreatesAccountForAllowlistedEmail(t *testing.T) {
	env := newTestEnv(t, nil)
	ctx := context.Background()

	resp := signup(t, env, allowlistedEmail, goodPassword)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body %s)", resp.StatusCode, readBody(t, resp))
	}
	token := tokenFrom(t, resp)

	user, err := env.store.GetUserByEmail(ctx, allowlistedEmail)
	if err != nil {
		t.Fatalf("GetUserByEmail: %v", err)
	}
	if user.PasswordHash == goodPassword {
		t.Error("password stored in plaintext")
	}
	ok, err := auth.VerifyPassword(user.PasswordHash, goodPassword)
	if err != nil {
		t.Fatalf("VerifyPassword: %v", err)
	}
	if !ok {
		t.Error("stored hash does not verify the signup password")
	}

	if resp := env.get(t, "/v1/me", token); resp.StatusCode != http.StatusOK || !strings.Contains(readBody(t, resp), allowlistedEmail) {
		t.Errorf("issued token did not authenticate (status %d)", resp.StatusCode)
	}
}

func TestSignupRejectsNonAllowlistedEmail(t *testing.T) {
	env := newTestEnv(t, nil)
	ctx := context.Background()

	resp := signup(t, env, "intruder@example.com", goodPassword)
	body := readBody(t, resp)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body %s)", resp.StatusCode, body)
	}
	if !strings.Contains(body, "signup_not_allowed") {
		t.Errorf("body = %q, want signup_not_allowed", body)
	}
	if strings.Contains(body, allowlistedEmail) {
		t.Errorf("response echoed the allowlist value: %q", body)
	}
	if _, err := env.store.GetUserByEmail(ctx, "intruder@example.com"); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("GetUserByEmail(fresh) error = %v, want ErrNotFound (no account should be created)", err)
	}
}

func TestSignupRejectedUniformlyWhenAllowlistUnset(t *testing.T) {
	refusal := func(allowlist string) string {
		env := newTestEnv(t, func(o *httpapi.Options) { o.SignupEmail = allowlist })
		resp := signup(t, env, allowlistedEmail, goodPassword)
		body := readBody(t, resp)
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("allowlist %q: status = %d, want 403 (body %s)", allowlist, resp.StatusCode, body)
		}
		if _, err := env.store.GetUserByEmail(context.Background(), allowlistedEmail); !errors.Is(err, store.ErrNotFound) {
			t.Fatalf("allowlist %q: account was created despite refusal: %v", allowlist, err)
		}
		return body
	}

	missing := refusal("")
	blank := refusal("   ")
	if missing != blank {
		t.Errorf("unset vs blank allowlist bodies differ:\nmissing=%q\nblank=%q", missing, blank)
	}
	if !strings.Contains(missing, "signup_not_allowed") {
		t.Errorf("body = %q, want signup_not_allowed", missing)
	}
}

func TestSignupNormalizesCaseAndWhitespace(t *testing.T) {
	env := newTestEnv(t, nil)

	resp := env.post(t, "/v1/signup", credentialsBody(t, "  OWNER@Example.COM\t", goodPassword), "")
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("padded/upper allowlisted email: status = %d, want 201 (body %s)", resp.StatusCode, readBody(t, resp))
	}

	other := env.post(t, "/v1/signup", credentialsBody(t, "  INTRUDER@Example.COM  ", goodPassword), "")
	body := readBody(t, other)
	if other.StatusCode != http.StatusForbidden {
		t.Errorf("padded/upper non-allowlisted email: status = %d, want 403 (body %s)", other.StatusCode, body)
	}

	user, err := env.store.GetUserByEmail(context.Background(), "owner@example.com")
	if err != nil {
		t.Fatalf("GetUserByEmail(normalized): %v", err)
	}
	if user.Email != allowlistedEmail {
		t.Errorf("stored email = %q, want normalized %q", user.Email, allowlistedEmail)
	}
}

func TestSignupRejectsShortPassword(t *testing.T) {
	env := newTestEnv(t, nil)
	ctx := context.Background()

	short := signup(t, env, allowlistedEmail, "elevenchars")
	body := readBody(t, short)
	if short.StatusCode != http.StatusBadRequest {
		t.Fatalf("11-char password: status = %d, want 400 (body %s)", short.StatusCode, body)
	}
	if !strings.Contains(body, "password_too_short") {
		t.Errorf("body = %q, want password_too_short", body)
	}
	if _, err := env.store.GetUserByEmail(ctx, allowlistedEmail); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("account created despite short password: %v", err)
	}

	ok := signup(t, env, allowlistedEmail, "twelvechars!")
	if ok.StatusCode != http.StatusCreated {
		t.Fatalf("12-char password: status = %d, want 201 (body %s)", ok.StatusCode, readBody(t, ok))
	}
}

func TestSignupBodyTooLarge(t *testing.T) {
	t.Run("configured cap", func(t *testing.T) {
		env := newTestEnv(t, func(o *httpapi.Options) { o.MaxBodyBytes = 128 })
		body := credentialsJSON(allowlistedEmail, strings.Repeat("a", 512))
		resp := env.post(t, "/v1/signup", body, "")
		got := readBody(t, resp)
		if resp.StatusCode != http.StatusRequestEntityTooLarge {
			t.Fatalf("status = %d, want 413 (body %s)", resp.StatusCode, got)
		}
	})

	t.Run("default cap", func(t *testing.T) {
		env := newTestEnv(t, nil)
		body := credentialsJSON(allowlistedEmail, strings.Repeat("a", 70*1024))
		resp := env.post(t, "/v1/signup", body, "")
		got := readBody(t, resp)
		if resp.StatusCode != http.StatusRequestEntityTooLarge {
			t.Fatalf("status = %d, want 413 (body %s)", resp.StatusCode, got)
		}
	})
}

func TestLoginBodyTooLarge(t *testing.T) {
	env := newTestEnv(t, nil)
	body := credentialsJSON(allowlistedEmail, strings.Repeat("a", 70*1024))
	resp := env.post(t, "/v1/login", body, "")
	got := readBody(t, resp)
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413 (body %s)", resp.StatusCode, got)
	}
}

func TestLoginIssuesOpaqueToken(t *testing.T) {
	env := newTestEnv(t, nil)
	signupToken := tokenFrom(t, signup(t, env, allowlistedEmail, goodPassword))

	resp := login(t, env, allowlistedEmail, goodPassword)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", resp.StatusCode, readBody(t, resp))
	}
	token := tokenFrom(t, resp)
	if token == signupToken {
		t.Error("login reused the signup token")
	}

	me := env.get(t, "/v1/me", token)
	if me.StatusCode != http.StatusOK {
		t.Fatalf("/v1/me status = %d, want 200 (body %s)", me.StatusCode, readBody(t, me))
	}
	if body := readBody(t, me); !strings.Contains(body, allowlistedEmail) {
		t.Errorf("/v1/me body = %q, want it to carry the account email", body)
	}
}

func TestLoginCredentialFailuresAreUniform(t *testing.T) {
	env := newTestEnv(t, nil)
	ctx := context.Background()

	hash, err := auth.HashPassword(goodPassword)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if _, err := env.store.CreateUser(ctx, allowlistedEmail, hash); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	unknown := login(t, env, "intruder@example.com", goodPassword)
	unknownBody := readBody(t, unknown)

	wrong := login(t, env, allowlistedEmail, "definitely-wrong")
	wrongBody := readBody(t, wrong)

	if unknown.StatusCode != http.StatusUnauthorized || wrong.StatusCode != http.StatusUnauthorized {
		t.Fatalf("statuses = (%d, %d), want (401, 401)", unknown.StatusCode, wrong.StatusCode)
	}
	if unknownBody != wrongBody {
		t.Errorf("credential failure bodies differ:\nunknown email=%q\nwrong password=%q", unknownBody, wrongBody)
	}
	if !strings.Contains(unknownBody, "invalid_credentials") {
		t.Errorf("body = %q, want invalid_credentials", unknownBody)
	}
	for _, body := range []string{unknownBody, wrongBody} {
		if strings.Contains(body, allowlistedEmail) || strings.Contains(body, "intruder") {
			t.Errorf("credential failure body leaked an email: %q", body)
		}
	}
}

func TestRateLimitBlocksAndRecovers(t *testing.T) {
	env := newTestEnv(t, nil)

	for i := 0; i < 5; i++ {
		resp := login(t, env, "intruder@example.com", goodPassword)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("attempt %d status = %d, want 401 (body %s)", i+1, resp.StatusCode, readBody(t, resp))
		}
		_ = resp.Body.Close()
	}

	limited := login(t, env, "intruder@example.com", goodPassword)
	if limited.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("6th attempt status = %d, want 429 (body %s)", limited.StatusCode, readBody(t, limited))
	}
	if limited.Header.Get("Retry-After") == "" {
		t.Error("429 response missing Retry-After header")
	}
	_ = limited.Body.Close()

	env.clock.Advance(61 * time.Second)
	recovered := login(t, env, "intruder@example.com", goodPassword)
	if recovered.StatusCode != http.StatusUnauthorized {
		t.Fatalf("after window status = %d, want 401 (body %s)", recovered.StatusCode, readBody(t, recovered))
	}
}

func TestSessionTableStoresTokenHashNotToken(t *testing.T) {
	env := newTestEnv(t, nil)
	token := tokenFrom(t, signup(t, env, allowlistedEmail, goodPassword))

	db, err := sql.Open("sqlite", "file:"+env.dbPath)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer db.Close()

	var stored string
	if err := db.QueryRow(`SELECT token_hash FROM sessions`).Scan(&stored); err != nil {
		t.Fatalf("select token_hash: %v", err)
	}
	if stored == token {
		t.Fatal("plain token stored in sessions.token_hash")
	}
	if want := auth.HashToken(token); stored != want {
		t.Errorf("sessions.token_hash = %q, want sha-256 %q", stored, want)
	}
}

func TestRequireAuthRejectsMissingToken(t *testing.T) {
	env := newTestEnv(t, nil)

	resp := env.get(t, "/v1/me", "")
	body := readBody(t, resp)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body %s)", resp.StatusCode, body)
	}
	if !strings.Contains(body, "unauthorized") {
		t.Errorf("body = %q, want unauthorized", body)
	}

	garbage := env.get(t, "/v1/me", "not-a-real-token")
	if body := readBody(t, garbage); garbage.StatusCode != http.StatusUnauthorized {
		t.Errorf("garbage token status = %d, want 401 (body %s)", garbage.StatusCode, body)
	}
}

func TestRequireAuthRejectsExpiredAndRevokedTokens(t *testing.T) {
	env := newTestEnv(t, nil)
	ctx := context.Background()

	user, err := env.store.CreateUser(ctx, allowlistedEmail, "argon2id$placeholder")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	expiredPlain, expiredHash, err := auth.NewToken()
	if err != nil {
		t.Fatalf("NewToken: %v", err)
	}
	if _, err := env.store.CreateSession(ctx, user.ID, expiredHash, env.clock.Now().Add(-31*24*time.Hour)); err != nil {
		t.Fatalf("CreateSession(expired): %v", err)
	}
	if resp := env.get(t, "/v1/me", expiredPlain); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expired token status = %d, want 401 (body %s)", resp.StatusCode, readBody(t, resp))
	}

	livePlain, liveHash, err := auth.NewToken()
	if err != nil {
		t.Fatalf("NewToken: %v", err)
	}
	sess, err := env.store.CreateSession(ctx, user.ID, liveHash, env.clock.Now())
	if err != nil {
		t.Fatalf("CreateSession(live): %v", err)
	}
	if err := env.store.RevokeSession(ctx, sess.ID, env.clock.Now()); err != nil {
		t.Fatalf("RevokeSession: %v", err)
	}
	if resp := env.get(t, "/v1/me", livePlain); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("revoked token status = %d, want 401 (body %s)", resp.StatusCode, readBody(t, resp))
	}
}

func TestLogoutRevokesToken(t *testing.T) {
	env := newTestEnv(t, nil)
	token := tokenFrom(t, signup(t, env, allowlistedEmail, goodPassword))

	if resp := env.get(t, "/v1/me", token); resp.StatusCode != http.StatusOK {
		t.Fatalf("pre-logout /v1/me status = %d, want 200", resp.StatusCode)
	}

	logout := env.post(t, "/v1/logout", "", token)
	if logout.StatusCode != http.StatusNoContent {
		t.Fatalf("logout status = %d, want 204 (body %s)", logout.StatusCode, readBody(t, logout))
	}
	_ = logout.Body.Close()

	if resp := env.get(t, "/v1/me", token); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("post-logout /v1/me status = %d, want 401 (body %s)", resp.StatusCode, readBody(t, resp))
	}
}

func TestLogoutWithoutTokenIsUnauthorized(t *testing.T) {
	env := newTestEnv(t, nil)
	resp := env.post(t, "/v1/logout", "", "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body %s)", resp.StatusCode, readBody(t, resp))
	}
}

func TestAllowlistNeverEchoedInAnyResponse(t *testing.T) {
	env := newTestEnv(t, nil)

	bodies := []string{
		readBody(t, signup(t, env, allowlistedEmail, "short")),
		readBody(t, signup(t, env, "intruder@example.com", goodPassword)),
		readBody(t, login(t, env, allowlistedEmail, "wrong-password")),
	}
	unset := newTestEnv(t, func(o *httpapi.Options) { o.SignupEmail = "" })
	bodies = append(bodies, readBody(t, signup(t, unset, allowlistedEmail, goodPassword)))

	for _, body := range bodies {
		if strings.Contains(body, allowlistedEmail) {
			t.Errorf("response echoed the allowlist value: %q", body)
		}
	}
}

func TestTokenNeverAppearsInLogs(t *testing.T) {
	var buf bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	env := newTestEnv(t, nil)
	signupToken := tokenFrom(t, signup(t, env, allowlistedEmail, goodPassword))
	loginToken := tokenFrom(t, login(t, env, allowlistedEmail, goodPassword))
	if resp := env.get(t, "/v1/me", loginToken); resp.StatusCode != http.StatusOK {
		t.Fatalf("/v1/me status = %d, want 200", resp.StatusCode)
	}
	if resp := env.post(t, "/v1/logout", "", loginToken); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("logout status = %d, want 204", resp.StatusCode)
	}

	logged := buf.String()
	for _, token := range []string{signupToken, loginToken} {
		if strings.Contains(logged, token) {
			t.Errorf("issued token leaked into server logs: %q", logged)
		}
	}
}
