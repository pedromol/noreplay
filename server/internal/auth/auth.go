// Package auth holds the credential primitives for the personal-account backend:
// argon2id password hashing, opaque session tokens, the signup allowlist gate,
// and an in-memory pre-authentication rate limiter.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"sync"
	"time"

	"github.com/alexedwards/argon2id"

	"noreplay/server/internal/store"
)

// MinPasswordLength is the minimum signup password length. It is defense in
// depth on top of argon2id and the pre-authentication rate limit.
const MinPasswordLength = 12

// tokenBytes is the CSPRNG entropy per session token (256 bits, well above the
// 128-bit floor).
const tokenBytes = 32

// HashPassword derives an argon2id PHC-style encoding of password using the
// library's default parameters.
func HashPassword(password string) (string, error) {
	return argon2id.CreateHash(password, argon2id.DefaultParams)
}

// VerifyPassword reports whether password matches the PHC-style encoded hash.
func VerifyPassword(encoded, password string) (bool, error) {
	return argon2id.ComparePasswordAndHash(password, encoded)
}

// NewToken returns a fresh opaque session token. The plain token is returned to
// the caller once (it is never persisted); only its SHA-256 is stored.
func NewToken() (plain string, tokenHash string, err error) {
	var b [tokenBytes]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", "", err
	}
	plain = base64.RawURLEncoding.EncodeToString(b[:])
	return plain, HashToken(plain), nil
}

// HashToken returns the lowercase hex SHA-256 of a session token. This is the
// only representation of the token that is ever persisted.
func HashToken(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

// CheckAllowlist reports whether email may sign up. Both sides are normalized
// (case and surrounding whitespace) before comparison. It fails closed: an
// empty or blank allowlist refuses every email. The refusal is deliberately
// indistinguishable from a non-matching email.
func CheckAllowlist(allowlist, email string) bool {
	allowed := store.NormalizeEmail(allowlist)
	if allowed == "" {
		return false
	}
	return allowed == store.NormalizeEmail(email)
}

// RateLimiter is a fixed-window, per-key in-memory limiter for
// pre-authentication routes. A limit <= 0 disables limiting. It is safe for
// concurrent use.
type RateLimiter struct {
	limit  int
	window time.Duration
	now    func() time.Time

	mu      sync.Mutex
	buckets map[string]bucket
}

type bucket struct {
	start time.Time
	count int
}

// sweepThreshold bounds the bucket map: once it grows past this many keys, each
// Allow call drops buckets whose window has elapsed.
const sweepThreshold = 1024

// NewRateLimiter builds a limiter that allows limit attempts per key per
// window. now is the injectable clock; nil defaults to time.Now.
func NewRateLimiter(limit int, window time.Duration, now func() time.Time) *RateLimiter {
	if now == nil {
		now = time.Now
	}
	return &RateLimiter{
		limit:   limit,
		window:  window,
		now:     now,
		buckets: make(map[string]bucket),
	}
}

// Allow records an attempt for key. It returns false when the key has exhausted
// its window, together with the time until the window resets.
func (rl *RateLimiter) Allow(key string) (bool, time.Duration) {
	if rl.limit <= 0 {
		return true, 0
	}
	now := rl.now()

	rl.mu.Lock()
	defer rl.mu.Unlock()

	rl.sweepLocked(now)

	b, ok := rl.buckets[key]
	if !ok || now.Sub(b.start) >= rl.window {
		rl.buckets[key] = bucket{start: now, count: 1}
		return true, 0
	}
	if b.count >= rl.limit {
		return false, rl.window - now.Sub(b.start)
	}
	b.count++
	rl.buckets[key] = b
	return true, 0
}

func (rl *RateLimiter) sweepLocked(now time.Time) {
	if len(rl.buckets) < sweepThreshold {
		return
	}
	for k, b := range rl.buckets {
		if now.Sub(b.start) >= rl.window {
			delete(rl.buckets, k)
		}
	}
}
