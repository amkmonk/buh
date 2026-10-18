package main

import (
	"database/sql"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const keepSnapshots = 7

// snapshotLoop writes a consistent copy of the database once a day into <db dir>/backups,
// keeping the last week. It protects against a corrupted database, not against losing the server:
// for that every client keeps the whole book and re-uploads it to a new server.
func snapshotLoop(db *sql.DB, dbPath string) {
	dir := filepath.Join(filepath.Dir(dbPath), "backups")
	time.Sleep(time.Minute)
	for {
		if err := snapshot(db, dir); err != nil {
			log.Printf("snapshot: %v", err)
		}
		time.Sleep(24 * time.Hour)
	}
}

func snapshot(db *sql.DB, dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	name := filepath.Join(dir, "buh-"+time.Now().Format("2006-01-02")+".db")
	os.Remove(name) // VACUUM INTO refuses to overwrite
	if _, err := db.Exec(`VACUUM INTO ?`, name); err != nil {
		return err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var snaps []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "buh-") && strings.HasSuffix(e.Name(), ".db") {
			snaps = append(snaps, e.Name())
		}
	}
	sort.Strings(snaps)
	for len(snaps) > keepSnapshots {
		os.Remove(filepath.Join(dir, snaps[0]))
		snaps = snaps[1:]
	}
	return nil
}
