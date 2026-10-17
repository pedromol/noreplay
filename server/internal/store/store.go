package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

var (
	ErrNotFound   = errors.New("store: not found")
	ErrEmailTaken = errors.New("store: email already registered")
)

const SessionTTL = 30 * 24 * time.Hour

type User struct {
	ID           string
	Email        string
	PasswordHash string
	CreatedAt    int64
}

type Session struct {
	ID        string
	UserID    string
	TokenHash string
	ExpiresAt int64
	RevokedAt *int64
	CreatedAt int64
}

type CatalogRecord struct {
	UserID      string
	VideoID     string
	Watched     bool
	WatchedAt   int64
	NeverSkip   bool
	NeverSkipAt int64
	UpdatedAt   int64
}

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	dsn := buildDSN(path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("store: open %q: %w", path, err)
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("store: ping %q: %w", path, err)
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("store: migrate %q: %w", path, err)
	}
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func buildDSN(p string) string {
	pragmas := "_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
	if p == ":memory:" {
		var suffix [8]byte
		if _, err := rand.Read(suffix[:]); err != nil {
			suffix = [8]byte{uint8(time.Now().UnixNano())}
		}
		name := fmt.Sprintf("noreplay-%d-%x", time.Now().UnixNano(), suffix)
		return "file:" + name + "?mode=memory&cache=shared&" + pragmas
	}
	return "file:" + p + "?" + pragmas + "&_pragma=journal_mode(WAL)"
}

func (s *Store) migrate() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version   INTEGER PRIMARY KEY,
		applied_at INTEGER NOT NULL
	)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	applied := map[int64]bool{}
	rows, err := s.db.Query(`SELECT version FROM schema_migrations`)
	if err != nil {
		return fmt.Errorf("read schema_migrations: %w", err)
	}
	for rows.Next() {
		var v int64
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return fmt.Errorf("scan schema_migrations: %w", err)
		}
		applied[v] = true
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate schema_migrations: %w", err)
	}

	entries, err := fs.ReadDir(migrationFS, "migrations")
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}
	type migration struct {
		version int64
		name    string
	}
	var migrations []migration
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		base := strings.TrimSuffix(e.Name(), ".sql")
		v, err := strconv.ParseInt(strings.SplitN(base, "_", 2)[0], 10, 64)
		if err != nil {
			return fmt.Errorf("migration %q: invalid version prefix: %w", e.Name(), err)
		}
		migrations = append(migrations, migration{version: v, name: e.Name()})
	}
	sort.Slice(migrations, func(i, j int) bool { return migrations[i].version < migrations[j].version })

	for _, m := range migrations {
		if applied[m.version] {
			continue
		}
		sqlBytes, err := migrationFS.ReadFile(path.Join("migrations", m.name))
		if err != nil {
			return fmt.Errorf("read migration %q: %w", m.name, err)
		}
		tx, err := s.db.Begin()
		if err != nil {
			return fmt.Errorf("begin migration %q: %w", m.name, err)
		}
		if _, err := tx.Exec(string(sqlBytes)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("apply migration %q: %w", m.name, err)
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`, m.version, time.Now().UnixMilli()); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("record migration %q: %w", m.name, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %q: %w", m.name, err)
		}
	}
	return nil
}

func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func newID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}

// CreateUser inserts a new account, normalizing the email first. It never
// overwrites an existing account: a duplicate email returns ErrEmailTaken.
func (s *Store) CreateUser(ctx context.Context, email, passwordHash string) (User, error) {
	normalized := NormalizeEmail(email)
	if normalized == "" {
		return User{}, fmt.Errorf("store: email is empty")
	}
	id, err := newID()
	if err != nil {
		return User{}, fmt.Errorf("store: generate user id: %w", err)
	}
	createdAt := time.Now().UnixMilli()
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)`,
		id, normalized, passwordHash, createdAt,
	); err != nil {
		if isUniqueViolation(err) {
			return User{}, ErrEmailTaken
		}
		return User{}, fmt.Errorf("store: insert user: %w", err)
	}
	return User{ID: id, Email: normalized, PasswordHash: passwordHash, CreatedAt: createdAt}, nil
}

func (s *Store) GetUserByEmail(ctx context.Context, email string) (User, error) {
	var u User
	err := s.db.QueryRowContext(ctx,
		`SELECT id, email, password_hash, created_at FROM users WHERE email = ?`,
		NormalizeEmail(email),
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("store: get user by email: %w", err)
	}
	return u, nil
}

func (s *Store) GetUserByID(ctx context.Context, userID string) (User, error) {
	var u User
	err := s.db.QueryRowContext(ctx,
		`SELECT id, email, password_hash, created_at FROM users WHERE id = ?`,
		userID,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("store: get user by id: %w", err)
	}
	return u, nil
}

func (s *Store) CreateSession(ctx context.Context, userID, tokenHash string, now time.Time) (Session, error) {
	id, err := newID()
	if err != nil {
		return Session{}, fmt.Errorf("store: generate session id: %w", err)
	}
	createdAt := now.UnixMilli()
	expiresAt := now.Add(SessionTTL).UnixMilli()
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)`,
		id, userID, tokenHash, expiresAt, createdAt,
	); err != nil {
		return Session{}, fmt.Errorf("store: insert session: %w", err)
	}
	return Session{ID: id, UserID: userID, TokenHash: tokenHash, ExpiresAt: expiresAt, CreatedAt: createdAt}, nil
}

func (s *Store) GetSessionByTokenHash(ctx context.Context, tokenHash string, now time.Time) (Session, error) {
	var sess Session
	err := s.db.QueryRowContext(ctx,
		`SELECT id, user_id, token_hash, expires_at, revoked_at, created_at
		 FROM sessions
		 WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
		tokenHash, now.UnixMilli(),
	).Scan(&sess.ID, &sess.UserID, &sess.TokenHash, &sess.ExpiresAt, &sess.RevokedAt, &sess.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	if err != nil {
		return Session{}, fmt.Errorf("store: get session by token hash: %w", err)
	}
	return sess, nil
}

func (s *Store) RevokeSession(ctx context.Context, sessionID string, now time.Time) error {
	res, err := s.db.ExecContext(ctx,
		`UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
		now.UnixMilli(), sessionID,
	)
	if err != nil {
		return fmt.Errorf("store: revoke session: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("store: revoke session rows affected: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) UpsertCatalogRecord(ctx context.Context, rec CatalogRecord, now time.Time) (CatalogRecord, error) {
	if rec.UserID == "" || rec.VideoID == "" {
		return CatalogRecord{}, fmt.Errorf("store: catalog record requires user_id and video_id")
	}
	clampedWatchedAt := clampTimestamp(rec.WatchedAt, now)
	clampedNeverSkipAt := clampTimestamp(rec.NeverSkipAt, now)

	conn, err := s.db.Conn(ctx)
	if err != nil {
		return CatalogRecord{}, fmt.Errorf("store: acquire connection: %w", err)
	}
	defer conn.Close()

	if _, err := conn.ExecContext(ctx, `BEGIN IMMEDIATE`); err != nil {
		return CatalogRecord{}, fmt.Errorf("store: begin merge tx: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_, _ = conn.ExecContext(ctx, `ROLLBACK`)
		}
	}()

	var existing CatalogRecord
	var watched, neverSkip int
	err = conn.QueryRowContext(ctx,
		`SELECT watched, watched_at, never_skip, never_skip_at, updated_at
		 FROM catalog_records WHERE user_id = ? AND video_id = ?`,
		rec.UserID, rec.VideoID,
	).Scan(&watched, &existing.WatchedAt, &neverSkip, &existing.NeverSkipAt, &existing.UpdatedAt)
	existing.Watched = watched != 0
	existing.NeverSkip = neverSkip != 0
	hasExisting := true
	if errors.Is(err, sql.ErrNoRows) {
		hasExisting = false
	} else if err != nil {
		return CatalogRecord{}, fmt.Errorf("store: read existing catalog record: %w", err)
	}

	merged := rec
	merged.WatchedAt = clampedWatchedAt
	merged.NeverSkipAt = clampedNeverSkipAt
	if hasExisting {
		merged.Watched = existing.Watched || rec.Watched
		merged.NeverSkip = existing.NeverSkip || rec.NeverSkip
		merged.WatchedAt = max(existing.WatchedAt, clampedWatchedAt)
		merged.NeverSkipAt = max(existing.NeverSkipAt, clampedNeverSkipAt)
	}
	if !merged.Watched {
		merged.WatchedAt = 0
	}
	if !merged.NeverSkip {
		merged.NeverSkipAt = 0
	}
	merged.UpdatedAt = max(existing.UpdatedAt, now.UnixMilli())

	if _, err := conn.ExecContext(ctx,
		`INSERT INTO catalog_records (user_id, video_id, watched, watched_at, never_skip, never_skip_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(user_id, video_id) DO UPDATE SET
			watched = excluded.watched,
			watched_at = excluded.watched_at,
			never_skip = excluded.never_skip,
			never_skip_at = excluded.never_skip_at,
			updated_at = excluded.updated_at`,
		merged.UserID, merged.VideoID,
		boolToInt(merged.Watched), merged.WatchedAt,
		boolToInt(merged.NeverSkip), merged.NeverSkipAt, merged.UpdatedAt,
	); err != nil {
		return CatalogRecord{}, fmt.Errorf("store: upsert catalog record: %w", err)
	}

	if _, err := conn.ExecContext(ctx, `COMMIT`); err != nil {
		return CatalogRecord{}, fmt.Errorf("store: commit catalog record: %w", err)
	}
	committed = true
	return merged, nil
}

func (s *Store) GetCatalogRecord(ctx context.Context, userID, videoID string) (CatalogRecord, error) {
	var rec CatalogRecord
	var watched, neverSkip int
	err := s.db.QueryRowContext(ctx,
		`SELECT watched, watched_at, never_skip, never_skip_at, updated_at
		 FROM catalog_records WHERE user_id = ? AND video_id = ?`,
		userID, videoID,
	).Scan(&watched, &rec.WatchedAt, &neverSkip, &rec.NeverSkipAt, &rec.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogRecord{}, ErrNotFound
	}
	if err != nil {
		return CatalogRecord{}, fmt.Errorf("store: get catalog record: %w", err)
	}
	rec.UserID = userID
	rec.VideoID = videoID
	rec.Watched = watched != 0
	rec.NeverSkip = neverSkip != 0
	return rec, nil
}

func (s *Store) ListCatalog(ctx context.Context, userID string) ([]CatalogRecord, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT video_id, watched, watched_at, never_skip, never_skip_at, updated_at
		 FROM catalog_records WHERE user_id = ? ORDER BY video_id`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("store: list catalog: %w", err)
	}
	defer rows.Close()

	var out []CatalogRecord
	for rows.Next() {
		var rec CatalogRecord
		var watched, neverSkip int
		if err := rows.Scan(&rec.VideoID, &watched, &rec.WatchedAt, &neverSkip, &rec.NeverSkipAt, &rec.UpdatedAt); err != nil {
			return nil, fmt.Errorf("store: scan catalog record: %w", err)
		}
		rec.UserID = userID
		rec.Watched = watched != 0
		rec.NeverSkip = neverSkip != 0
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: iterate catalog: %w", err)
	}
	return out, nil
}

func clampTimestamp(ts int64, now time.Time) int64 {
	if ts < 0 {
		return 0
	}
	if ts > now.UnixMilli() {
		return now.UnixMilli()
	}
	return ts
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}
