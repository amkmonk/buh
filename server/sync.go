package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

// Record is one synced object: an expense, income, checkpoint, month structure or book settings.
// Conflicts resolve by last-writer-wins on UpdatedAt (client clock, ms); the server only orders
// accepted writes with a monotonically growing Seq that clients use as their pull cursor.
type Record struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Data      json.RawMessage `json:"data"`
	Deleted   bool            `json:"deleted"`
	UpdatedAt int64           `json:"updated_at"`
	Author    string          `json:"author,omitempty"`
	Seq       int64           `json:"seq,omitempty"`
}

var recordTypes = map[string]bool{"exp": true, "inc": true, "chk": true, "struct": true, "book": true}

const (
	maxChangesPerSync = 2000
	maxDataBytes      = 64 << 10
	pullPageSize      = 5000
)

func (s *Server) handleSync(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Since   int64    `json:"since"`
		Changes []Record `json:"changes"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if len(req.Changes) > maxChangesPerSync {
		writeError(w, http.StatusRequestEntityTooLarge, "слишком много изменений за раз")
		return
	}
	for _, c := range req.Changes {
		if c.ID == "" || len(c.ID) > 80 || !recordTypes[c.Type] || len(c.Data) > maxDataBytes || c.UpdatedAt <= 0 {
			writeError(w, http.StatusBadRequest, "некорректная запись: "+c.ID)
			return
		}
	}
	author := currentUser(r).ID

	tx, err := s.db.Begin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback()

	var seq int64
	if err := tx.QueryRow(`SELECT COALESCE(MAX(seq), 0) FROM records`).Scan(&seq); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	accepted := 0
	for _, c := range req.Changes {
		var cur int64
		err := tx.QueryRow(`SELECT updated_at FROM records WHERE id = ?`, c.ID).Scan(&cur)
		if err != nil && err != sql.ErrNoRows {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if err == nil && c.UpdatedAt <= cur {
			continue // an equal or newer version is already stored
		}
		data := c.Data
		if len(data) == 0 {
			data = json.RawMessage("{}")
		}
		seq++
		_, err = tx.Exec(`INSERT INTO records(id, type, data, deleted, updated_at, author, seq) VALUES(?,?,?,?,?,?,?)
			ON CONFLICT(id) DO UPDATE SET type=excluded.type, data=excluded.data, deleted=excluded.deleted,
			updated_at=excluded.updated_at, author=excluded.author, seq=excluded.seq`,
			c.ID, c.Type, string(data), c.Deleted, c.UpdatedAt, author, seq)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		accepted++
	}

	rows, err := tx.Query(`SELECT id, type, data, deleted, updated_at, author, seq FROM records WHERE seq > ? ORDER BY seq LIMIT ?`, req.Since, pullPageSize+1)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := []Record{}
	for rows.Next() {
		var rec Record
		var data string
		if err := rows.Scan(&rec.ID, &rec.Type, &data, &rec.Deleted, &rec.UpdatedAt, &rec.Author, &rec.Seq); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		rec.Data = json.RawMessage(data)
		out = append(out, rec)
	}
	rows.Close()
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	more := len(out) > pullPageSize
	if more {
		out = out[:pullPageSize]
	}
	cursor := req.Since
	if len(out) > 0 {
		cursor = out[len(out)-1].Seq
	}
	writeJSON(w, http.StatusOK, map[string]any{"cursor": cursor, "changes": out, "more": more, "accepted": accepted, "book": s.bookID, "top": seq})
}
