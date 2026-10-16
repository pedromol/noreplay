package httpapi_test

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"noreplay/server/internal/auth"
	"noreplay/server/internal/store"
)

type pulledRecord struct {
	VideoID     string `json:"videoId"`
	Watched     bool   `json:"watched"`
	WatchedAt   int64  `json:"watchedAt"`
	NeverSkip   bool   `json:"neverSkip"`
	NeverSkipAt int64  `json:"neverSkipAt"`
	UpdatedAt   int64  `json:"updatedAt"`
}

type pullPayload struct {
	Records []pulledRecord `json:"records"`
}

func decodePull(t *testing.T, resp *http.Response) pullPayload {
	t.Helper()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("pull status = %d, want 200 (body %s)", resp.StatusCode, readBody(t, resp))
	}
	var payload pullPayload
	if err := json.Unmarshal([]byte(readBody(t, resp)), &payload); err != nil {
		t.Fatalf("decode pull body: %v", err)
	}
	return payload
}

func findRecord(t *testing.T, payload pullPayload, videoID string) pulledRecord {
	t.Helper()
	for _, rec := range payload.Records {
		if rec.VideoID == videoID {
			return rec
		}
	}
	t.Fatalf("video %q not in pull payload %+v", videoID, payload.Records)
	return pulledRecord{}
}

func pushBody(t *testing.T, records ...map[string]any) string {
	t.Helper()
	b, err := json.Marshal(map[string]any{"records": records})
	if err != nil {
		t.Fatalf("marshal push body: %v", err)
	}
	return string(b)
}

func pushOK(t *testing.T, env *testEnv, token, body string) {
	t.Helper()
	resp := env.post(t, "/v1/sync/push", body, token)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("push status = %d, want 200 (body %s)", resp.StatusCode, readBody(t, resp))
	}
	_ = resp.Body.Close()
}

func pull(t *testing.T, env *testEnv, token string) pullPayload {
	t.Helper()
	return decodePull(t, env.get(t, "/v1/sync/pull", token))
}

// seedSession creates an account directly in the store (bypassing the signup
// allowlist) and returns its opaque session token, as U5's tests do.
func seedSession(t *testing.T, env *testEnv, email string) (store.User, string) {
	t.Helper()
	user, err := env.store.CreateUser(t.Context(), email, "argon2id$placeholder")
	if err != nil {
		t.Fatalf("CreateUser(%q): %v", email, err)
	}
	plain, hash, err := auth.NewToken()
	if err != nil {
		t.Fatalf("NewToken: %v", err)
	}
	if _, err := env.store.CreateSession(t.Context(), user.ID, hash, env.clock.Now()); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	return user, plain
}

func TestSyncPushVisibleToOtherDeviceOnSameAccount(t *testing.T) {
	env := newTestEnv(t, nil)
	signupToken := tokenFrom(t, signup(t, env, allowlistedEmail, goodPassword))
	deviceB := tokenFrom(t, login(t, env, allowlistedEmail, goodPassword))
	_ = signupToken

	seenAt := env.clock.Now().Add(-time.Hour).UnixMilli()
	pushOK(t, env, signupToken, pushBody(t,
		map[string]any{"videoId": "vid-ae5", "watched": true, "watchedAt": seenAt},
	))

	payload := pull(t, env, deviceB)
	rec := findRecord(t, payload, "vid-ae5")
	if !rec.Watched || rec.WatchedAt != seenAt {
		t.Errorf("device B pulled %+v, want watched at %d", rec, seenAt)
	}
}

func TestSyncNeverSkipWinsOverLaterWatched(t *testing.T) {
	env := newTestEnv(t, nil)
	deviceA := tokenFrom(t, signup(t, env, allowlistedEmail, goodPassword))
	deviceB := tokenFrom(t, login(t, env, allowlistedEmail, goodPassword))

	exceptionAt := env.clock.Now().Add(-2 * time.Hour).UnixMilli()
	laterWatchedAt := env.clock.Now().Add(-time.Hour).UnixMilli()

	pushOK(t, env, deviceA, pushBody(t,
		map[string]any{"videoId": "vid-ae8", "neverSkip": true, "neverSkipAt": exceptionAt},
	))
	pushOK(t, env, deviceB, pushBody(t,
		map[string]any{"videoId": "vid-ae8", "watched": true, "watchedAt": laterWatchedAt},
	))

	for name, token := range map[string]string{"device A": deviceA, "device B": deviceB} {
		rec := findRecord(t, pull(t, env, token), "vid-ae8")
		if !rec.NeverSkip {
			t.Errorf("%s: never_skip lost; exception must beat a later watched record (got %+v)", name, rec)
		}
		if !rec.Watched {
			t.Errorf("%s: watched lost; flags combine by OR (got %+v)", name, rec)
		}
		if rec.NeverSkipAt != exceptionAt {
			t.Errorf("%s: never_skip_at = %d, want %d", name, rec.NeverSkipAt, exceptionAt)
		}
		if rec.WatchedAt != laterWatchedAt {
			t.Errorf("%s: watched_at = %d, want %d", name, rec.WatchedAt, laterWatchedAt)
		}
	}
}

func TestSyncInterleavedPushesConverge(t *testing.T) {
	recordA := map[string]any{"videoId": "vid-mix", "watched": true, "watchedAt": int64(1_760_000_000_000)}
	recordB := map[string]any{"videoId": "vid-mix", "neverSkip": true, "neverSkipAt": int64(1_760_000_600_000)}

	run := func(t *testing.T, first, second map[string]any) pullPayload {
		t.Helper()
		env := newTestEnv(t, nil)
		deviceA := tokenFrom(t, signup(t, env, allowlistedEmail, goodPassword))
		deviceB := tokenFrom(t, login(t, env, allowlistedEmail, goodPassword))

		pushOK(t, env, deviceA, pushBody(t, first))
		env.clock.Advance(time.Minute)
		pushOK(t, env, deviceB, pushBody(t, second))

		fromA := pull(t, env, deviceA)
		fromB := pull(t, env, deviceB)
		if len(fromA.Records) != len(fromB.Records) {
			t.Fatalf("devices disagree on catalog length: A=%+v B=%+v", fromA, fromB)
		}
		for i := range fromA.Records {
			if fromA.Records[i] != fromB.Records[i] {
				t.Fatalf("devices disagree at %d: A=%+v B=%+v", i, fromA.Records[i], fromB.Records[i])
			}
		}
		return fromA
	}

	ab := run(t, recordA, recordB)
	ba := run(t, recordB, recordA)

	if len(ab.Records) != len(ba.Records) {
		t.Fatalf("orderings converged to different lengths: A→B=%+v B→A=%+v", ab.Records, ba.Records)
	}
	for i := range ab.Records {
		if ab.Records[i] != ba.Records[i] {
			t.Errorf("orderings diverged at %d: A→B=%+v B→A=%+v", i, ab.Records[i], ba.Records[i])
		}
	}

	rec := ab.Records[0]
	if !rec.Watched || !rec.NeverSkip {
		t.Errorf("converged record = %+v, want watched and never_skip both set", rec)
	}
}

func TestSyncPullIsIdempotent(t *testing.T) {
	env := newTestEnv(t, nil)
	token := tokenFrom(t, signup(t, env, allowlistedEmail, goodPassword))

	pushOK(t, env, token, pushBody(t,
		map[string]any{"videoId": "vid-idem", "watched": true, "watchedAt": int64(1_760_000_000_000)},
	))

	first := pull(t, env, token)
	for i := 0; i < 3; i++ {
		again := pull(t, env, token)
		if len(again.Records) != len(first.Records) {
			t.Fatalf("pull %d changed catalog length: %+v vs %+v", i+2, again.Records, first.Records)
		}
		for j := range first.Records {
			if again.Records[j] != first.Records[j] {
				t.Fatalf("pull %d changed record %d: %+v vs %+v", i+2, j, again.Records[j], first.Records[j])
			}
		}
	}
}

func TestSyncTimestampsPreservedAndClamped(t *testing.T) {
	env := newTestEnv(t, nil)
	deviceA := tokenFrom(t, signup(t, env, allowlistedEmail, goodPassword))
	deviceB := tokenFrom(t, login(t, env, allowlistedEmail, goodPassword))
	base := env.clock.Now()

	past := base.Add(-6 * time.Hour).UnixMilli()
	pushOK(t, env, deviceA, pushBody(t,
		map[string]any{"videoId": "vid-past", "watched": true, "watchedAt": past},
	))
	if rec := findRecord(t, pull(t, env, deviceB), "vid-past"); rec.WatchedAt != past {
		t.Errorf("past watched_at = %d, want client value %d preserved", rec.WatchedAt, past)
	}

	future := base.Add(10 * time.Hour).UnixMilli()
	pushOK(t, env, deviceA, pushBody(t,
		map[string]any{"videoId": "vid-future", "watched": true, "watchedAt": future},
	))
	clamped := findRecord(t, pull(t, env, deviceB), "vid-future")
	if clamped.WatchedAt != base.UnixMilli() {
		t.Errorf("future watched_at = %d, want clamped to server clock %d", clamped.WatchedAt, base.UnixMilli())
	}

	env.clock.Advance(2 * time.Hour)
	legit := base.Add(time.Hour).UnixMilli()
	pushOK(t, env, deviceB, pushBody(t,
		map[string]any{"videoId": "vid-future", "watched": true, "watchedAt": legit},
	))
	won := findRecord(t, pull(t, env, deviceA), "vid-future")
	if won.WatchedAt != legit {
		t.Errorf("watched_at = %d, want %d: legitimate value must beat the earlier clamped skew", won.WatchedAt, legit)
	}
	if won.WatchedAt > env.clock.Now().UnixMilli() {
		t.Errorf("watched_at %d exceeds server clock %d", won.WatchedAt, env.clock.Now().UnixMilli())
	}
}

func TestSyncPushIgnoresUnknownFields(t *testing.T) {
	env := newTestEnv(t, nil)
	token := tokenFrom(t, signup(t, env, allowlistedEmail, goodPassword))

	body := `{"records":[{"videoId":"vid-extra","watched":true,"watchedAt":1760000000000,"schemaVersion":9,"note":"from a newer client"}],"cursor":"deadbeef"}`
	pushOK(t, env, token, body)

	rec := findRecord(t, pull(t, env, token), "vid-extra")
	if !rec.Watched {
		t.Errorf("record after unknown-field push = %+v, want watched", rec)
	}
}

func TestSyncIsolatesAccounts(t *testing.T) {
	env := newTestEnv(t, nil)
	userB, tokenB := seedSession(t, env, "seeded-b@example.com")
	deviceA := tokenFrom(t, signup(t, env, allowlistedEmail, goodPassword))

	seenAt := env.clock.Now().Add(-time.Hour).UnixMilli()
	pushOK(t, env, tokenB, pushBody(t,
		map[string]any{"videoId": "vid-b-only", "watched": true, "watchedAt": seenAt},
	))

	pushOK(t, env, deviceA, pushBody(t,
		map[string]any{"videoId": "vid-a-only", "watched": true, "watchedAt": seenAt},
	))

	fromA := pull(t, env, deviceA)
	for _, rec := range fromA.Records {
		if rec.VideoID == "vid-b-only" {
			t.Errorf("account A pull leaked account B record: %+v", fromA.Records)
		}
	}
	findRecord(t, fromA, "vid-a-only")

	fromB := pull(t, env, tokenB)
	recB := findRecord(t, fromB, "vid-b-only")
	if !recB.Watched || recB.WatchedAt != seenAt {
		t.Errorf("account B record changed by account A push: %+v", recB)
	}
	if len(fromB.Records) != 1 {
		t.Errorf("account B catalog = %+v, want exactly its own record", fromB.Records)
	}

	bRecord, err := env.store.GetCatalogRecord(t.Context(), userB.ID, "vid-b-only")
	if err != nil {
		t.Fatalf("GetCatalogRecord(B): %v", err)
	}
	if !bRecord.Watched || bRecord.WatchedAt != seenAt {
		t.Errorf("stored B record altered cross-account: %+v", bRecord)
	}
}

func TestSyncRequiresAuthentication(t *testing.T) {
	env := newTestEnv(t, nil)

	push := env.post(t, "/v1/sync/push", pushBody(t,
		map[string]any{"videoId": "vid-x", "watched": true},
	), "")
	body := readBody(t, push)
	if push.StatusCode != http.StatusUnauthorized {
		t.Errorf("unauthenticated push status = %d, want 401 (body %s)", push.StatusCode, body)
	}
	if !strings.Contains(body, "unauthorized") {
		t.Errorf("push body = %q, want unauthorized", body)
	}

	pullResp := env.get(t, "/v1/sync/pull", "")
	pullBody := readBody(t, pullResp)
	if pullResp.StatusCode != http.StatusUnauthorized {
		t.Errorf("unauthenticated pull status = %d, want 401 (body %s)", pullResp.StatusCode, pullBody)
	}
	if !strings.Contains(pullBody, "unauthorized") {
		t.Errorf("pull body = %q, want unauthorized", pullBody)
	}
}

func TestSyncPushBodyTooLarge(t *testing.T) {
	env := newTestEnv(t, nil)
	token := tokenFrom(t, signup(t, env, allowlistedEmail, goodPassword))

	huge := strings.Repeat("a", 70*1024)
	resp := env.post(t, "/v1/sync/push", pushBody(t,
		map[string]any{"videoId": huge, "watched": true},
	), token)
	body := readBody(t, resp)
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413 (body %s)", resp.StatusCode, body)
	}
	if !strings.Contains(body, "body_too_large") {
		t.Errorf("body = %q, want body_too_large", body)
	}
	if got := pull(t, env, token); len(got.Records) != 0 {
		t.Errorf("catalog after rejected push = %+v, want empty", got.Records)
	}
}

func TestSyncPushRejectsOversizedBatch(t *testing.T) {
	env := newTestEnv(t, nil)
	token := tokenFrom(t, signup(t, env, allowlistedEmail, goodPassword))

	records := make([]map[string]any, 501)
	for i := range records {
		records[i] = map[string]any{"videoId": "vid-" + strconv.Itoa(i), "watched": true}
	}
	resp := env.post(t, "/v1/sync/push", pushBody(t, records...), token)
	body := readBody(t, resp)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %s)", resp.StatusCode, body)
	}
	if !strings.Contains(body, "batch_too_large") {
		t.Errorf("body = %q, want batch_too_large", body)
	}
	if got := pull(t, env, token); len(got.Records) != 0 {
		t.Errorf("catalog after rejected batch = %+v, want empty", got.Records)
	}
}

func TestSyncPushAcceptsBatchAtCap(t *testing.T) {
	env := newTestEnv(t, nil)
	token := tokenFrom(t, signup(t, env, allowlistedEmail, goodPassword))

	records := make([]map[string]any, 500)
	for i := range records {
		records[i] = map[string]any{"videoId": "vid-" + strconv.Itoa(i), "watched": true}
	}
	resp := env.post(t, "/v1/sync/push", pushBody(t, records...), token)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", resp.StatusCode, readBody(t, resp))
	}
	_ = resp.Body.Close()

	if got := pull(t, env, token); len(got.Records) != 500 {
		t.Errorf("catalog len = %d, want 500", len(got.Records))
	}
}

func TestSyncPushRejectsInvalidRequests(t *testing.T) {
	env := newTestEnv(t, nil)
	token := tokenFrom(t, signup(t, env, allowlistedEmail, goodPassword))

	cases := map[string]string{
		"malformed json":     `{"records":[`,
		"empty videoId":      pushBody(t, map[string]any{"videoId": "", "watched": true}),
		"string timestamp":   `{"records":[{"videoId":"vid-x","watchedAt":"not-a-number"}]}`,
		"fractional seconds": `{"records":[{"videoId":"vid-x","watchedAt":1760000000.5}]}`,
	}
	for name, body := range cases {
		resp := env.post(t, "/v1/sync/push", body, token)
		got := readBody(t, resp)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400 (body %s)", name, resp.StatusCode, got)
			continue
		}
		if !strings.Contains(got, "invalid_request") {
			t.Errorf("%s: body = %q, want invalid_request", name, got)
		}
	}

	if got := pull(t, env, token); len(got.Records) != 0 {
		t.Errorf("catalog after invalid pushes = %+v, want empty", got.Records)
	}
}
