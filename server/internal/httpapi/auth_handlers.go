package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"noreplay/server/internal/auth"
	"noreplay/server/internal/store"
)

const (
	rateLimitAttempts = 5
	rateLimitWindow   = time.Minute
)

// Errors returned by ReadJSONBody.
var (
	ErrBodyTooLarge  = errors.New("httpapi: request body too large")
	ErrMalformedBody = errors.New("httpapi: malformed request body")
)

type server struct {
	store       *store.Store
	signupEmail string
	now         func() time.Time
	limiter     *auth.RateLimiter
	maxBody     int64
}

func newServer(s *store.Store, opts Options) *server {
	if opts.Store != nil {
		s = opts.Store
	}
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	limiter := opts.RateLimiter
	if limiter == nil {
		limiter = auth.NewRateLimiter(rateLimitAttempts, rateLimitWindow, now)
	}
	maxBody := opts.MaxBodyBytes
	if maxBody <= 0 {
		maxBody = DefaultMaxBodyBytes
	}
	return &server{
		store:       s,
		signupEmail: opts.SignupEmail,
		now:         now,
		limiter:     limiter,
		maxBody:     maxBody,
	}
}

// RequireAuth returns middleware that authenticates the Bearer token on the
// request, resolves the session and its user, and exposes the user to downstream
// handlers via UserFromContext. Missing, expired, or revoked tokens get a 401
// JSON response. opts must carry the store (and optionally Now).
func RequireAuth(opts Options) func(http.Handler) http.Handler {
	srv := newServer(opts.Store, opts)
	return srv.requireAuth
}

// ReadJSONBody decodes the request body as JSON into dst, rejecting bodies
// larger than maxBytes with ErrBodyTooLarge before the whole body is buffered.
// A maxBytes <= 0 applies DefaultMaxBodyBytes. It is exported so the
// authenticated sync routes can reuse the same cap.
func ReadJSONBody(w http.ResponseWriter, r *http.Request, dst any, maxBytes int64) error {
	if maxBytes <= 0 {
		maxBytes = DefaultMaxBodyBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)

	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return ErrBodyTooLarge
		}
		return fmt.Errorf("%w: %v", ErrMalformedBody, err)
	}
	return nil
}

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type tokenResponse struct {
	Token string `json:"token"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func (s *server) handleSignup(w http.ResponseWriter, r *http.Request) {
	email, password, ok := s.readCredentials(w, r)
	if !ok {
		return
	}

	if !auth.CheckAllowlist(s.signupEmail, email) {
		writeError(w, http.StatusForbidden, "signup_not_allowed")
		return
	}
	if len(password) < auth.MinPasswordLength {
		writeError(w, http.StatusBadRequest, "password_too_short")
		return
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error")
		return
	}
	user, err := s.store.CreateUser(r.Context(), email, hash)
	if err != nil {
		if errors.Is(err, store.ErrEmailTaken) {
			writeError(w, http.StatusForbidden, "signup_not_allowed")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal_error")
		return
	}

	token, ok := s.issueSession(w, r, user.ID)
	if !ok {
		return
	}
	writeJSON(w, http.StatusCreated, tokenResponse{Token: token})
}

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	email, password, ok := s.readCredentials(w, r)
	if !ok {
		return
	}
	if email == "" {
		writeError(w, http.StatusUnauthorized, "invalid_credentials")
		return
	}

	user, err := s.store.GetUserByEmail(r.Context(), email)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid_credentials")
		return
	}
	match, err := auth.VerifyPassword(user.PasswordHash, password)
	if err != nil || !match {
		writeError(w, http.StatusUnauthorized, "invalid_credentials")
		return
	}

	token, ok := s.issueSession(w, r, user.ID)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, tokenResponse{Token: token})
}

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if err := s.store.RevokeSession(r.Context(), sess.ID, s.now()); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal_error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// readCredentials reads and rate-limits a pre-authentication body. It writes
// the appropriate error response and returns ok=false on failure. The limiter
// is keyed on the normalized email; a body without a usable email shares one
// coarse global bucket.
func (s *server) readCredentials(w http.ResponseWriter, r *http.Request) (email, password string, ok bool) {
	var creds credentials
	decodeErr := ReadJSONBody(w, r, &creds, s.maxBody)
	if decodeErr == nil {
		email = store.NormalizeEmail(creds.Email)
		password = creds.Password
	}

	if allowed, retryAfter := s.limiter.Allow(email); !allowed {
		writeRateLimited(w, retryAfter)
		return "", "", false
	}

	if decodeErr != nil {
		if errors.Is(decodeErr, ErrBodyTooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "body_too_large")
		} else {
			writeError(w, http.StatusBadRequest, "invalid_request")
		}
		return "", "", false
	}
	return email, password, true
}

func (s *server) issueSession(w http.ResponseWriter, r *http.Request, userID string) (string, bool) {
	token, tokenHash, err := auth.NewToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error")
		return "", false
	}
	if _, err := s.store.CreateSession(r.Context(), userID, tokenHash, s.now()); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error")
		return "", false
	}
	return token, true
}

func (s *server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := bearerToken(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		sess, err := s.store.GetSessionByTokenHash(r.Context(), auth.HashToken(token), s.now())
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		user, err := s.store.GetUserByID(r.Context(), sess.UserID)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		ctx := context.WithValue(r.Context(), userCtxKey, user)
		ctx = context.WithValue(ctx, sessionCtxKey, sess)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// bearerToken extracts the opaque token from the Authorization header. The
// header value is never logged.
func bearerToken(r *http.Request) (string, bool) {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if len(h) <= len(prefix) || !strings.EqualFold(h[:len(prefix)], prefix) {
		return "", false
	}
	token := strings.TrimSpace(h[len(prefix):])
	if token == "" {
		return "", false
	}
	return token, true
}

type ctxKey int

const (
	userCtxKey ctxKey = iota
	sessionCtxKey
)

// UserFromContext returns the authenticated user placed on the context by
// RequireAuth.
func UserFromContext(ctx context.Context) (store.User, bool) {
	u, ok := ctx.Value(userCtxKey).(store.User)
	return u, ok
}

func sessionFromContext(ctx context.Context) (store.Session, bool) {
	sess, ok := ctx.Value(sessionCtxKey).(store.Session)
	return sess, ok
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if body != nil {
		_ = json.NewEncoder(w).Encode(body)
	}
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, errorResponse{Error: code})
}

func writeRateLimited(w http.ResponseWriter, retryAfter time.Duration) {
	seconds := int(math.Ceil(retryAfter.Seconds()))
	if seconds < 1 {
		seconds = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(seconds))
	writeError(w, http.StatusTooManyRequests, "rate_limited")
}
