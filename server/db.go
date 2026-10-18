package main

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS users (
	id         TEXT PRIMARY KEY,
	login      TEXT NOT NULL UNIQUE,
	name       TEXT NOT NULL,
	pass_hash  TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
	token_hash TEXT PRIMARY KEY,
	user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at INTEGER NOT NULL,
	last_seen  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
	id         TEXT PRIMARY KEY,
	type       TEXT NOT NULL,
	data       TEXT NOT NULL,
	deleted    INTEGER NOT NULL DEFAULT 0,
	updated_at INTEGER NOT NULL,
	author     TEXT NOT NULL,
	seq        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS records_seq ON records(seq);
CREATE TABLE IF NOT EXISTS meta (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
`

// bookID identifies this server's database. Clients remember it; when it changes (a new or
// reinstalled server) they upload their full local copy, so losing the server loses nothing.
func bookID(db *sql.DB) (string, error) {
	var id string
	err := db.QueryRow(`SELECT value FROM meta WHERE key = 'book_id'`).Scan(&id)
	if err == sql.ErrNoRows {
		id = randomHex(16)
		_, err = db.Exec(`INSERT INTO meta(key, value) VALUES('book_id', ?)`, id)
	}
	return id, err
}

func openDB(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// One writer is plenty for a family book and keeps SQLite locking trivial.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return db, nil
}
