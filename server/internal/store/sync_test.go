package store_test

import (
	"context"
	"testing"
	"time"

	"noreplay/server/internal/store"
)

func syncClock() time.Time {
	return time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)
}

func pushRecords(t *testing.T, st *store.Store, userID string, recs []store.SyncRecord, now time.Time) {
	t.Helper()
	if _, err := st.PushRecords(context.Background(), userID, recs, now); err != nil {
		t.Fatalf("PushRecords: %v", err)
	}
}

func mustGetRecord(t *testing.T, st *store.Store, userID, videoID string) store.CatalogRecord {
	t.Helper()
	rec, err := st.GetCatalogRecord(context.Background(), userID, videoID)
	if err != nil {
		t.Fatalf("GetCatalogRecord(%q): %v", videoID, err)
	}
	return rec
}

func sameState(a, b store.CatalogRecord) bool {
	return a.VideoID == b.VideoID &&
		a.Watched == b.Watched &&
		a.WatchedAt == b.WatchedAt &&
		a.NeverSkip == b.NeverSkip &&
		a.NeverSkipAt == b.NeverSkipAt &&
		a.UpdatedAt == b.UpdatedAt
}

func TestPushRecordsSharesStateBetweenDevices(t *testing.T) {
	ctx := context.Background()
	st := openStore(t, tempDBPath(t))
	user := mustCreateUser(t, st, "owner@example.com")
	now := syncClock()

	pushRecords(t, st, user.ID, []store.SyncRecord{
		{VideoID: "vid-ae5", Watched: true, WatchedAt: now.Add(-time.Hour).UnixMilli()},
	}, now)

	list, err := st.ListCatalog(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListCatalog: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("ListCatalog len = %d, want 1", len(list))
	}
	got := list[0]
	if !got.Watched || got.WatchedAt != now.Add(-time.Hour).UnixMilli() {
		t.Errorf("consolidated record = %+v, want watched at %d", got, now.Add(-time.Hour).UnixMilli())
	}
}

func TestPushRecordsNeverSkipBeatsLaterWatched(t *testing.T) {
	st := openStore(t, tempDBPath(t))
	user := mustCreateUser(t, st, "owner@example.com")
	now := syncClock()

	exception := store.SyncRecord{
		VideoID:     "vid-ae8",
		NeverSkip:   true,
		NeverSkipAt: now.Add(-2 * time.Hour).UnixMilli(),
	}
	laterWatched := store.SyncRecord{
		VideoID:   "vid-ae8",
		Watched:   true,
		WatchedAt: now.Add(-time.Hour).UnixMilli(),
	}

	pushRecords(t, st, user.ID, []store.SyncRecord{exception}, now)
	pushRecords(t, st, user.ID, []store.SyncRecord{laterWatched}, now)

	rec := mustGetRecord(t, st, user.ID, "vid-ae8")
	if !rec.NeverSkip {
		t.Error("never_skip lost against a later watched record; exception must win")
	}
	if !rec.Watched {
		t.Error("watched flag lost; flags combine by OR")
	}
	if rec.NeverSkipAt != now.Add(-2*time.Hour).UnixMilli() {
		t.Errorf("never_skip_at = %d, want %d", rec.NeverSkipAt, now.Add(-2*time.Hour).UnixMilli())
	}
	if rec.WatchedAt != now.Add(-time.Hour).UnixMilli() {
		t.Errorf("watched_at = %d, want %d", rec.WatchedAt, now.Add(-time.Hour).UnixMilli())
	}
}

func TestPushRecordsConvergesRegardlessOfOrder(t *testing.T) {
	now := syncClock()
	recordA := store.SyncRecord{
		VideoID:   "vid-order",
		Watched:   true,
		WatchedAt: now.Add(-time.Hour).UnixMilli(),
	}
	recordB := store.SyncRecord{
		VideoID:     "vid-order",
		NeverSkip:   true,
		NeverSkipAt: now.Add(-30 * time.Minute).UnixMilli(),
	}

	run := func(t *testing.T, first, second store.SyncRecord) store.CatalogRecord {
		t.Helper()
		st := openStore(t, tempDBPath(t))
		user := mustCreateUser(t, st, "owner@example.com")
		pushRecords(t, st, user.ID, []store.SyncRecord{first}, now)
		pushRecords(t, st, user.ID, []store.SyncRecord{second}, now)
		return mustGetRecord(t, st, user.ID, "vid-order")
	}

	ab := run(t, recordA, recordB)
	ba := run(t, recordB, recordA)

	if !sameState(ab, ba) {
		t.Errorf("order A→B = %+v\norder B→A = %+v\npushes must converge", ab, ba)
	}
	if !ab.Watched || !ab.NeverSkip {
		t.Errorf("converged state = %+v, want watched and never_skip both set", ab)
	}

	st := openStore(t, tempDBPath(t))
	user := mustCreateUser(t, st, "owner@example.com")
	pushRecords(t, st, user.ID, []store.SyncRecord{recordA}, now)
	pushRecords(t, st, user.ID, []store.SyncRecord{recordB}, now)
	pushRecords(t, st, user.ID, []store.SyncRecord{recordA, recordB}, now)
	if again := mustGetRecord(t, st, user.ID, "vid-order"); !sameState(ab, again) {
		t.Errorf("replay of both pushes changed state:\nfirst=%+v\nagain=%+v", ab, again)
	}
}

func TestPushRecordsIsIdempotent(t *testing.T) {
	now := syncClock()
	st := openStore(t, tempDBPath(t))
	user := mustCreateUser(t, st, "owner@example.com")

	rec := store.SyncRecord{
		VideoID:     "vid-idem",
		Watched:     true,
		WatchedAt:   now.Add(-time.Hour).UnixMilli(),
		NeverSkip:   true,
		NeverSkipAt: now.Add(-time.Hour).UnixMilli(),
	}
	pushRecords(t, st, user.ID, []store.SyncRecord{rec}, now)
	first := mustGetRecord(t, st, user.ID, "vid-idem")

	for i := 0; i < 3; i++ {
		pushRecords(t, st, user.ID, []store.SyncRecord{rec}, now)
		if again := mustGetRecord(t, st, user.ID, "vid-idem"); !sameState(first, again) {
			t.Fatalf("replay %d changed state:\nfirst=%+v\nagain=%+v", i+1, first, again)
		}
	}
}

func TestPushRecordsPreservesPastTimestamps(t *testing.T) {
	ctx := context.Background()
	now := syncClock()
	st := openStore(t, tempDBPath(t))
	user := mustCreateUser(t, st, "owner@example.com")

	past := now.Add(-6 * time.Hour).UnixMilli()
	pushRecords(t, st, user.ID, []store.SyncRecord{
		{VideoID: "vid-past", Watched: true, WatchedAt: past},
	}, now)

	rec := mustGetRecord(t, st, user.ID, "vid-past")
	if rec.WatchedAt != past {
		t.Errorf("watched_at = %d, want client value %d preserved (not rewritten to server clock)", rec.WatchedAt, past)
	}

	list, err := st.ListCatalog(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListCatalog: %v", err)
	}
	if len(list) != 1 || list[0].WatchedAt != past {
		t.Errorf("ListCatalog = %+v, want watched_at %d preserved", list, past)
	}
}

func TestPushRecordsClampsFutureTimestamps(t *testing.T) {
	ctx := context.Background()
	base := syncClock()
	st := openStore(t, tempDBPath(t))
	user := mustCreateUser(t, st, "owner@example.com")

	future := base.Add(10 * time.Hour).UnixMilli()
	pushRecords(t, st, user.ID, []store.SyncRecord{
		{VideoID: "vid-future", Watched: true, WatchedAt: future},
	}, base)

	skewed := mustGetRecord(t, st, user.ID, "vid-future")
	if skewed.WatchedAt != base.UnixMilli() {
		t.Errorf("watched_at = %d, want clamped to server clock %d", skewed.WatchedAt, base.UnixMilli())
	}
	if skewed.WatchedAt > base.UnixMilli() {
		t.Errorf("future timestamp survived clamp: %d > %d", skewed.WatchedAt, base.UnixMilli())
	}

	later := base.Add(2 * time.Hour)
	legit := base.Add(time.Hour).UnixMilli()
	pushRecords(t, st, user.ID, []store.SyncRecord{
		{VideoID: "vid-future", Watched: true, WatchedAt: legit},
	}, later)

	won := mustGetRecord(t, st, user.ID, "vid-future")
	if won.WatchedAt != legit {
		t.Errorf("watched_at = %d, want legitimate %d to win over the earlier clamped skew value", won.WatchedAt, legit)
	}

	list, err := st.ListCatalog(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListCatalog: %v", err)
	}
	for _, rec := range list {
		if rec.WatchedAt > later.UnixMilli() {
			t.Errorf("record %q watched_at %d exceeds server clock %d", rec.VideoID, rec.WatchedAt, later.UnixMilli())
		}
	}
}

func TestPushRecordsNeverLowersStoredTimestamps(t *testing.T) {
	now := syncClock()
	st := openStore(t, tempDBPath(t))
	user := mustCreateUser(t, st, "owner@example.com")

	pushRecords(t, st, user.ID, []store.SyncRecord{
		{VideoID: "vid-grow", Watched: true, WatchedAt: now.Add(-2 * time.Hour).UnixMilli()},
	}, now)
	pushRecords(t, st, user.ID, []store.SyncRecord{
		{VideoID: "vid-grow", Watched: true, WatchedAt: now.Add(-3 * time.Hour).UnixMilli()},
	}, now)

	rec := mustGetRecord(t, st, user.ID, "vid-grow")
	if rec.WatchedAt != now.Add(-2*time.Hour).UnixMilli() {
		t.Errorf("watched_at = %d, want stored value %d kept (existing value only grows)", rec.WatchedAt, now.Add(-2*time.Hour).UnixMilli())
	}
}

func TestPushRecordsIsolatesUsers(t *testing.T) {
	ctx := context.Background()
	st := openStore(t, tempDBPath(t))
	userA := mustCreateUser(t, st, "a@example.com")
	userB := mustCreateUser(t, st, "b@example.com")
	now := syncClock()

	pushRecords(t, st, userA.ID, []store.SyncRecord{
		{VideoID: "vid-a-only", Watched: true, WatchedAt: now.Add(-time.Hour).UnixMilli()},
	}, now)

	listB, err := st.ListCatalog(ctx, userB.ID)
	if err != nil {
		t.Fatalf("ListCatalog(B): %v", err)
	}
	if len(listB) != 0 {
		t.Errorf("ListCatalog(B) = %+v, want empty (records must not cross accounts)", listB)
	}

	pushRecords(t, st, userB.ID, []store.SyncRecord{
		{VideoID: "vid-b-only", Watched: true, WatchedAt: now.Add(-time.Hour).UnixMilli()},
	}, now)

	if rec := mustGetRecord(t, st, userA.ID, "vid-a-only"); !rec.Watched {
		t.Errorf("user A record changed by user B push: %+v", rec)
	}
	listA, err := st.ListCatalog(ctx, userA.ID)
	if err != nil {
		t.Fatalf("ListCatalog(A): %v", err)
	}
	for _, rec := range listA {
		if rec.VideoID == "vid-b-only" {
			t.Errorf("user B record leaked into user A catalog: %+v", rec)
		}
	}
}

func TestPushRecordsEmptyBatchIsNoop(t *testing.T) {
	ctx := context.Background()
	now := syncClock()
	st := openStore(t, tempDBPath(t))
	user := mustCreateUser(t, st, "owner@example.com")

	merged, err := st.PushRecords(ctx, user.ID, nil, now)
	if err != nil {
		t.Fatalf("PushRecords(nil): %v", err)
	}
	if len(merged) != 0 {
		t.Errorf("merged = %+v, want empty", merged)
	}
	list, err := st.ListCatalog(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListCatalog: %v", err)
	}
	if len(list) != 0 {
		t.Errorf("ListCatalog = %+v, want empty", list)
	}
}

func TestPushRecordsReturnsMergedState(t *testing.T) {
	ctx := context.Background()
	now := syncClock()
	st := openStore(t, tempDBPath(t))
	user := mustCreateUser(t, st, "owner@example.com")

	pushRecords(t, st, user.ID, []store.SyncRecord{
		{VideoID: "vid-ret", Watched: true, WatchedAt: now.Add(-time.Hour).UnixMilli()},
	}, now)

	merged, err := st.PushRecords(ctx, user.ID, []store.SyncRecord{
		{VideoID: "vid-ret", NeverSkip: true, NeverSkipAt: now.Add(-time.Minute).UnixMilli()},
		{VideoID: "vid-new", Watched: true, WatchedAt: now.Add(-time.Minute).UnixMilli()},
	}, now)
	if err != nil {
		t.Fatalf("PushRecords: %v", err)
	}
	if len(merged) != 2 {
		t.Fatalf("merged len = %d, want 2", len(merged))
	}
	for _, rec := range merged {
		if rec.UserID != user.ID {
			t.Errorf("merged record carries user %q, want %q", rec.UserID, user.ID)
		}
	}
}
