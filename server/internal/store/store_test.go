package store_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"noreplay/server/internal/store"
)

func tempDBPath(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "noreplay.db")
}

func openStore(t *testing.T, path string) *store.Store {
	t.Helper()
	st, err := store.Open(path)
	if err != nil {
		t.Fatalf("store.Open(%q): %v", path, err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func rawDB(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatalf("sql.Open(%q): %v", path, err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func schemaObjects(t *testing.T, db *sql.DB) []string {
	t.Helper()
	rows, err := db.Query(`SELECT type, name, COALESCE(sql, '') FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`)
	if err != nil {
		t.Fatalf("query sqlite_master: %v", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var typ, name, ddl string
		if err := rows.Scan(&typ, &name, &ddl); err != nil {
			t.Fatalf("scan sqlite_master: %v", err)
		}
		out = append(out, typ+"|"+name+"|"+ddl)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate sqlite_master: %v", err)
	}
	return out
}

func migrationVersions(t *testing.T, db *sql.DB) []int64 {
	t.Helper()
	rows, err := db.Query(`SELECT version FROM schema_migrations ORDER BY version`)
	if err != nil {
		t.Fatalf("query schema_migrations: %v", err)
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var v int64
		if err := rows.Scan(&v); err != nil {
			t.Fatalf("scan schema_migrations: %v", err)
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate schema_migrations: %v", err)
	}
	return out
}

func mustCreateUser(t *testing.T, st *store.Store, email string) store.User {
	t.Helper()
	u, err := st.CreateUser(context.Background(), email, "argon2id$fake$hash")
	if err != nil {
		t.Fatalf("CreateUser(%q): %v", email, err)
	}
	return u
}

func TestOpenAppliesMigrationsOnEmptyDatabase(t *testing.T) {
	path := tempDBPath(t)
	openStore(t, path)

	db := rawDB(t, path)
	versions := migrationVersions(t, db)
	if len(versions) == 0 {
		t.Fatal("schema_migrations is empty; expected at least migration 0001 to be applied")
	}
	if versions[0] != 1 {
		t.Errorf("first applied version = %d, want 1", versions[0])
	}

	objects := strings.Join(schemaObjects(t, db), "\n")
	for _, table := range []string{"users", "sessions", "catalog_records"} {
		if !strings.Contains(objects, "table|"+table+"|") {
			t.Errorf("schema missing table %q\ngot:\n%s", table, objects)
		}
	}
}

func TestReopenOnMigratedDatabaseIsIdempotent(t *testing.T) {
	path := tempDBPath(t)
	ctx := context.Background()

	st1 := openStore(t, path)
	kept := mustCreateUser(t, st1, "keep@example.com")
	beforeSchema := schemaObjects(t, rawDB(t, path))
	beforeVersions := migrationVersions(t, rawDB(t, path))
	if err := st1.Close(); err != nil {
		t.Fatalf("first close: %v", err)
	}

	st2 := openStore(t, path)
	afterSchema := schemaObjects(t, rawDB(t, path))
	afterVersions := migrationVersions(t, rawDB(t, path))

	if !slices.Equal(beforeSchema, afterSchema) {
		t.Errorf("schema changed after reopen\nbefore:\n%s\nafter:\n%s",
			strings.Join(beforeSchema, "\n"), strings.Join(afterSchema, "\n"))
	}
	if !slices.Equal(beforeVersions, afterVersions) {
		t.Errorf("migration versions changed after reopen: before %v, after %v", beforeVersions, afterVersions)
	}

	got, err := st2.GetUserByEmail(ctx, "keep@example.com")
	if err != nil {
		t.Fatalf("GetUserByEmail after reopen: %v", err)
	}
	if got.ID != kept.ID {
		t.Errorf("user ID after reopen = %q, want %q", got.ID, kept.ID)
	}
}

func TestUserRoundTripPreservesFields(t *testing.T) {
	st := openStore(t, tempDBPath(t))
	ctx := context.Background()

	created, err := st.CreateUser(ctx, "  Ana@Example.COM ", "argon2id$fake$hash-1")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if created.Email != "ana@example.com" {
		t.Errorf("created email = %q, want normalized %q", created.Email, "ana@example.com")
	}
	if created.ID == "" {
		t.Error("created user ID is empty")
	}
	if created.CreatedAt == 0 {
		t.Error("created_at is zero")
	}

	got, err := st.GetUserByEmail(ctx, "ANA@example.com")
	if err != nil {
		t.Fatalf("GetUserByEmail: %v", err)
	}
	if got != created {
		t.Errorf("GetUserByEmail returned %+v, want %+v", got, created)
	}

	if _, err := st.CreateUser(ctx, "ana@example.com", "argon2id$fake$hash-2"); !errors.Is(err, store.ErrEmailTaken) {
		t.Errorf("CreateUser(duplicate) error = %v, want ErrEmailTaken", err)
	}
	after, err := st.GetUserByEmail(ctx, "ana@example.com")
	if err != nil {
		t.Fatalf("GetUserByEmail after duplicate attempt: %v", err)
	}
	if after != created {
		t.Errorf("duplicate CreateUser mutated the account: %+v, want %+v", after, created)
	}

	if _, err := st.GetUserByEmail(ctx, "missing@example.com"); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("GetUserByEmail(missing) error = %v, want ErrNotFound", err)
	}
}

func TestCatalogRecordRoundTripPreservesFields(t *testing.T) {
	st := openStore(t, tempDBPath(t))
	ctx := context.Background()
	user := mustCreateUser(t, st, "catalog@example.com")
	other := mustCreateUser(t, st, "other@example.com")
	now := time.UnixMilli(1_700_000_100_000)

	in := store.CatalogRecord{
		UserID:      user.ID,
		VideoID:     "vid-123",
		Watched:     true,
		WatchedAt:   now.Add(-time.Hour).UnixMilli(),
		NeverSkip:   true,
		NeverSkipAt: now.Add(-time.Minute).UnixMilli(),
	}
	saved, err := st.UpsertCatalogRecord(ctx, in, now)
	if err != nil {
		t.Fatalf("UpsertCatalogRecord: %v", err)
	}
	wantSaved := in
	wantSaved.UpdatedAt = now.UnixMilli()
	if saved != wantSaved {
		t.Errorf("saved = %+v, want %+v", saved, wantSaved)
	}

	got, err := st.GetCatalogRecord(ctx, user.ID, "vid-123")
	if err != nil {
		t.Fatalf("GetCatalogRecord: %v", err)
	}
	if got != wantSaved {
		t.Errorf("GetCatalogRecord = %+v, want %+v", got, wantSaved)
	}

	list, err := st.ListCatalog(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListCatalog: %v", err)
	}
	if len(list) != 1 || list[0] != wantSaved {
		t.Errorf("ListCatalog = %+v, want [%+v]", list, wantSaved)
	}

	otherList, err := st.ListCatalog(ctx, other.ID)
	if err != nil {
		t.Fatalf("ListCatalog(other): %v", err)
	}
	if len(otherList) != 0 {
		t.Errorf("ListCatalog(other) = %+v, want empty (per-user isolation)", otherList)
	}
}

func TestSessionLifecycle(t *testing.T) {
	st := openStore(t, tempDBPath(t))
	ctx := context.Background()
	user := mustCreateUser(t, st, "session@example.com")
	now := time.UnixMilli(1_700_000_000_000)
	tokenHash := strings.Repeat("ab", 32)

	sess, err := st.CreateSession(ctx, user.ID, tokenHash, now)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if sess.UserID != user.ID || sess.TokenHash != tokenHash {
		t.Errorf("session = %+v, want user %q and token hash", sess, user.ID)
	}
	if want := now.Add(store.SessionTTL).UnixMilli(); sess.ExpiresAt != want {
		t.Errorf("expires_at = %d, want absolute TTL deadline %d", sess.ExpiresAt, want)
	}
	if sess.RevokedAt != nil {
		t.Errorf("revoked_at = %v, want nil", *sess.RevokedAt)
	}

	got, err := st.GetSessionByTokenHash(ctx, tokenHash, now.Add(time.Hour))
	if err != nil {
		t.Fatalf("GetSessionByTokenHash: %v", err)
	}
	if got != sess {
		t.Errorf("GetSessionByTokenHash = %+v, want %+v", got, sess)
	}

	if _, err := st.GetSessionByTokenHash(ctx, tokenHash, now.Add(store.SessionTTL).Add(time.Second)); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("expired session lookup error = %v, want ErrNotFound", err)
	}

	revokeAt := now.Add(2 * time.Hour)
	if err := st.RevokeSession(ctx, sess.ID, revokeAt); err != nil {
		t.Fatalf("RevokeSession: %v", err)
	}
	if _, err := st.GetSessionByTokenHash(ctx, tokenHash, revokeAt.Add(time.Second)); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("revoked session lookup error = %v, want ErrNotFound", err)
	}
	if err := st.RevokeSession(ctx, sess.ID, revokeAt); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("second RevokeSession error = %v, want ErrNotFound", err)
	}
}

type catalogPush struct {
	rec store.CatalogRecord
	now time.Time
}

func applyPushes(t *testing.T, pushes ...catalogPush) store.CatalogRecord {
	t.Helper()
	st := openStore(t, tempDBPath(t))
	ctx := context.Background()
	user := mustCreateUser(t, st, "merge@example.com")
	var last store.CatalogRecord
	for i, p := range pushes {
		rec := p.rec
		rec.UserID = user.ID
		saved, err := st.UpsertCatalogRecord(ctx, rec, p.now)
		if err != nil {
			t.Fatalf("push %d: UpsertCatalogRecord: %v", i, err)
		}
		last = saved
	}
	return last
}

func TestCatalogMergePushesIntercaladosConvergem(t *testing.T) {
	pushA := catalogPush{
		rec: store.CatalogRecord{VideoID: "v1", Watched: true, WatchedAt: 1000},
		now: time.UnixMilli(1000),
	}
	pushB := catalogPush{
		rec: store.CatalogRecord{VideoID: "v1", NeverSkip: true, NeverSkipAt: 2000},
		now: time.UnixMilli(2000),
	}

	ab := applyPushes(t, pushA, pushB)
	ba := applyPushes(t, pushB, pushA)
	ab.UserID, ba.UserID = "", ""
	if ab != ba {
		t.Errorf("merge is not commutative:\nA,B -> %+v\nB,A -> %+v", ab, ba)
	}
	if !ab.Watched || !ab.NeverSkip {
		t.Errorf("converged record = %+v, want both flags true", ab)
	}
	if ab.WatchedAt != 1000 || ab.NeverSkipAt != 2000 {
		t.Errorf("converged timestamps = watched_at:%d never_skip_at:%d, want 1000/2000", ab.WatchedAt, ab.NeverSkipAt)
	}
	if ab.UpdatedAt != 2000 {
		t.Errorf("converged updated_at = %d, want 2000", ab.UpdatedAt)
	}

	aba := applyPushes(t, pushA, pushB, pushA)
	aba.UserID = ""
	if aba != ab {
		t.Errorf("re-push is not idempotent:\nA,B   -> %+v\nA,B,A -> %+v", ab, aba)
	}
}

func TestCatalogMergeExcecaoNuncaPularVence(t *testing.T) {
	pushNever := catalogPush{
		rec: store.CatalogRecord{VideoID: "v1", NeverSkip: true, NeverSkipAt: 1000},
		now: time.UnixMilli(1000),
	}
	pushWatchedLater := catalogPush{
		rec: store.CatalogRecord{VideoID: "v1", Watched: true, WatchedAt: 2000},
		now: time.UnixMilli(2000),
	}

	final := applyPushes(t, pushNever, pushWatchedLater)
	if !final.NeverSkip {
		t.Errorf("later watched push cleared the never-skip exception: %+v", final)
	}
	if !final.Watched {
		t.Errorf("watched flag lost after merge: %+v", final)
	}
	if final.NeverSkipAt != 1000 {
		t.Errorf("never_skip_at = %d, want 1000 (exception timestamp not overwritten)", final.NeverSkipAt)
	}

	reverse := applyPushes(t, pushWatchedLater, pushNever)
	if !reverse.NeverSkip || !reverse.Watched {
		t.Errorf("reverse order lost a flag: %+v", reverse)
	}
}

func TestCatalogMergeTimestampFuturoEhAparado(t *testing.T) {
	now := time.UnixMilli(2_000_000_000_000)
	future := now.Add(2 * time.Hour).UnixMilli()

	final := applyPushes(t, catalogPush{
		rec: store.CatalogRecord{
			VideoID:     "v1",
			Watched:     true,
			WatchedAt:   future,
			NeverSkip:   true,
			NeverSkipAt: future,
		},
		now: now,
	})
	if final.WatchedAt != now.UnixMilli() {
		t.Errorf("watched_at = %d, want clamped to server clock %d", final.WatchedAt, now.UnixMilli())
	}
	if final.NeverSkipAt != now.UnixMilli() {
		t.Errorf("never_skip_at = %d, want clamped to server clock %d", final.NeverSkipAt, now.UnixMilli())
	}
}

func TestCatalogMergeTimestampAntigoNaoEhReescrito(t *testing.T) {
	newer := catalogPush{
		rec: store.CatalogRecord{VideoID: "v1", Watched: true, WatchedAt: 2000, NeverSkip: true, NeverSkipAt: 2000},
		now: time.UnixMilli(2000),
	}
	older := catalogPush{
		rec: store.CatalogRecord{VideoID: "v1", Watched: true, WatchedAt: 1000, NeverSkip: true, NeverSkipAt: 1000},
		now: time.UnixMilli(3000),
	}

	final := applyPushes(t, newer, older)
	if final.WatchedAt != 2000 {
		t.Errorf("watched_at = %d, want 2000 (older push must not rewrite)", final.WatchedAt)
	}
	if final.NeverSkipAt != 2000 {
		t.Errorf("never_skip_at = %d, want 2000 (older push must not rewrite)", final.NeverSkipAt)
	}
}

func TestCatalogMergeTimestampNegativoEhAparado(t *testing.T) {
	push := catalogPush{
		rec: store.CatalogRecord{VideoID: "v1", Watched: true, WatchedAt: -500, NeverSkip: false, NeverSkipAt: 1000},
		now: time.UnixMilli(2000),
	}

	final := applyPushes(t, push)
	if final.WatchedAt != 0 {
		t.Errorf("watched_at = %d, want 0 (negative timestamp must clamp to 0)", final.WatchedAt)
	}
	if final.NeverSkipAt != 0 {
		t.Errorf("never_skip_at = %d, want 0 (never_skip=false must zero timestamp)", final.NeverSkipAt)
	}
}

