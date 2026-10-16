package auth_test

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"noreplay/server/internal/auth"
)

func TestHashPasswordVerifyRoundTrip(t *testing.T) {
	const password = "correct-horse-battery"

	encoded, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if !strings.HasPrefix(encoded, "$argon2id$") {
		t.Errorf("HashPassword output = %q, want PHC-style argon2id encoding", encoded)
	}

	ok, err := auth.VerifyPassword(encoded, password)
	if err != nil {
		t.Fatalf("VerifyPassword(correct): %v", err)
	}
	if !ok {
		t.Error("VerifyPassword(correct) = false, want true")
	}

	ok, err = auth.VerifyPassword(encoded, "wrong-password-here")
	if err != nil {
		t.Fatalf("VerifyPassword(wrong): %v", err)
	}
	if ok {
		t.Error("VerifyPassword(wrong) = true, want false")
	}
}

func TestHashPasswordUsesFreshSalt(t *testing.T) {
	first, err := auth.HashPassword("correct-horse-battery")
	if err != nil {
		t.Fatalf("HashPassword #1: %v", err)
	}
	second, err := auth.HashPassword("correct-horse-battery")
	if err != nil {
		t.Fatalf("HashPassword #2: %v", err)
	}
	if first == second {
		t.Error("two hashes of the same password are identical; salt is not fresh")
	}
}

func TestNewTokenShapeAndHash(t *testing.T) {
	plain, tokenHash, err := auth.NewToken()
	if err != nil {
		t.Fatalf("NewToken: %v", err)
	}

	raw, err := base64.RawURLEncoding.DecodeString(plain)
	if err != nil {
		t.Fatalf("token is not base64url: %v", err)
	}
	if len(raw) < 32 {
		t.Errorf("token entropy = %d bytes, want >= 32 (>= 128 bits)", len(raw))
	}

	if tokenHash == plain {
		t.Error("token hash equals the plain token")
	}
	if got := auth.HashToken(plain); got != tokenHash {
		t.Errorf("HashToken(plain) = %q, want %q", got, tokenHash)
	}
	if len(tokenHash) != 64 {
		t.Errorf("token hash length = %d, want 64 (sha-256 hex)", len(tokenHash))
	}
	for _, c := range tokenHash {
		if !strings.ContainsRune("0123456789abcdef", c) {
			t.Fatalf("token hash %q contains non-lowercase-hex rune %q", tokenHash, c)
		}
	}
}

func TestNewTokenIsUnique(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 8; i++ {
		plain, _, err := auth.NewToken()
		if err != nil {
			t.Fatalf("NewToken: %v", err)
		}
		if seen[plain] {
			t.Fatalf("NewToken repeated token %q", plain)
		}
		seen[plain] = true
	}
}

func TestCheckAllowlist(t *testing.T) {
	tests := []struct {
		name      string
		allowlist string
		email     string
		want      bool
	}{
		{name: "exact match", allowlist: "owner@example.com", email: "owner@example.com", want: true},
		{name: "allowlist upper and padded", allowlist: "  Owner@Example.COM ", email: "owner@example.com", want: true},
		{name: "email upper and padded", allowlist: "owner@example.com", email: "  OWNER@example.com\t", want: true},
		{name: "different email", allowlist: "owner@example.com", email: "intruder@example.com", want: false},
		{name: "empty allowlist", allowlist: "", email: "owner@example.com", want: false},
		{name: "blank allowlist", allowlist: "   ", email: "owner@example.com", want: false},
		{name: "empty email", allowlist: "owner@example.com", email: "", want: false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := auth.CheckAllowlist(tc.allowlist, tc.email); got != tc.want {
				t.Errorf("CheckAllowlist(%q, %q) = %v, want %v", tc.allowlist, tc.email, got, tc.want)
			}
		})
	}
}

func TestRateLimiterBlocksThenRecovers(t *testing.T) {
	now := time.Unix(0, 0)
	clock := func() time.Time { return now }
	rl := auth.NewRateLimiter(5, time.Minute, clock)

	for i := 0; i < 5; i++ {
		if allowed, _ := rl.Allow("user@example.com"); !allowed {
			t.Fatalf("attempt %d allowed = false, want true", i+1)
		}
	}

	allowed, retryAfter := rl.Allow("user@example.com")
	if allowed {
		t.Fatal("6th attempt allowed = true, want false")
	}
	if retryAfter <= 0 || retryAfter > time.Minute {
		t.Errorf("retryAfter = %v, want in (0, 1m]", retryAfter)
	}

	if allowed, _ := rl.Allow("other@example.com"); !allowed {
		t.Error("a different key is blocked by another key's bucket")
	}

	now = now.Add(time.Minute)
	if allowed, _ := rl.Allow("user@example.com"); !allowed {
		t.Error("after the window elapsed, attempt should be allowed again")
	}
}

func TestRateLimiterDisabledWhenLimitZero(t *testing.T) {
	rl := auth.NewRateLimiter(0, time.Minute, time.Now)
	for i := 0; i < 50; i++ {
		if allowed, _ := rl.Allow("user@example.com"); !allowed {
			t.Fatalf("limit=0 attempt %d blocked; want unlimited", i+1)
		}
	}
}
