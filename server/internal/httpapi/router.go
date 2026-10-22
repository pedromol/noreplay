package httpapi

import (
	"net/http"
	"time"

	"noreplay/server/internal/auth"
	"noreplay/server/internal/store"
)

// DefaultMaxBodyBytes caps request bodies (authenticated push and
// pre-authentication routes alike) before they are buffered.
const DefaultMaxBodyBytes int64 = 64 << 10

// Options is the injection point shared by NewRouter and RequireAuth. U6 adds
// authenticated sync routes on top of the same value.
type Options struct {
	// Store is the persistence layer. NewRouter falls back to its first
	// argument when this is nil; RequireAuth requires it.
	Store *store.Store
	// SignupEmail is the single allowlisted signup email. Blank disables
	// signup (fail-closed).
	SignupEmail string
	// Now is the clock used for session validation and rate limiting.
	// Defaults to time.Now.
	Now func() time.Time
	// RateLimiter bounds pre-authentication attempts. Defaults to 5 attempts
	// per minute keyed on the normalized email.
	RateLimiter *auth.RateLimiter
	// MaxBodyBytes caps request bodies. Defaults to DefaultMaxBodyBytes.
	MaxBodyBytes int64
}

func NewRouter(s *store.Store, opts Options) http.Handler {
	srv := newServer(s, opts)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /v1/signup", srv.handleSignup)
	mux.HandleFunc("POST /v1/login", srv.handleLogin)
	mux.Handle("POST /v1/logout", srv.requireAuth(http.HandlerFunc(srv.handleLogout)))
	mux.Handle("POST /v1/sync/push", srv.requireAuth(http.HandlerFunc(srv.handleSyncPush)))
	mux.Handle("GET /v1/sync/pull", srv.requireAuth(http.HandlerFunc(srv.handleSyncPull)))

	// CORS middleware so the Firefox extension (moz-extension:// origin)
	// can call the API across origins. Preflight OPTIONS is answered here.
	return corsMiddleware(mux)
}
