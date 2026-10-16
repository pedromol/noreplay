CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);

CREATE TABLE catalog_records (
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id      TEXT NOT NULL,
    watched       INTEGER NOT NULL DEFAULT 0,
    watched_at    INTEGER NOT NULL DEFAULT 0,
    never_skip    INTEGER NOT NULL DEFAULT 0,
    never_skip_at INTEGER NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, video_id)
);

CREATE INDEX idx_catalog_records_user_id ON catalog_records(user_id);
