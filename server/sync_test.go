package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func newTestServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	db, err := openDB(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err := createUser(db, "muzh", "Муж", "secret1"); err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer((&Server{db: db}).routes())
	t.Cleanup(ts.Close)
	var out struct{ Token string }
	call(t, ts, "", "POST", "/api/login", map[string]string{"login": "muzh", "password": "secret1"}, http.StatusOK, &out)
	return ts, out.Token
}

func call(t *testing.T, ts *httptest.Server, token, method, path string, body any, want int, out any) {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, ts.URL+path, bytes.NewReader(b))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != want {
		var e map[string]any
		json.NewDecoder(res.Body).Decode(&e)
		t.Fatalf("%s %s: status %d, want %d (%v)", method, path, res.StatusCode, want, e)
	}
	if out != nil {
		json.NewDecoder(res.Body).Decode(out)
	}
}

type syncResp struct {
	Cursor   int64    `json:"cursor"`
	Changes  []Record `json:"changes"`
	Accepted int      `json:"accepted"`
}

func TestSyncLastWriterWins(t *testing.T) {
	ts, tok := newTestServer(t)
	rec := func(amt int, at int64) Record {
		d, _ := json.Marshal(map[string]any{"amt": amt})
		return Record{ID: "e1", Type: "exp", Data: d, UpdatedAt: at}
	}
	var r1 syncResp
	call(t, ts, tok, "POST", "/api/sync", map[string]any{"since": 0, "changes": []Record{rec(100, 10)}}, 200, &r1)
	if r1.Accepted != 1 || len(r1.Changes) != 1 || r1.Cursor != 1 {
		t.Fatalf("first push: %+v", r1)
	}
	// An older write must not overwrite a newer one.
	var r2 syncResp
	call(t, ts, tok, "POST", "/api/sync", map[string]any{"since": r1.Cursor, "changes": []Record{rec(50, 5)}}, 200, &r2)
	if r2.Accepted != 0 || len(r2.Changes) != 0 {
		t.Fatalf("stale push accepted: %+v", r2)
	}
	var r3 syncResp
	call(t, ts, tok, "POST", "/api/sync", map[string]any{"since": r1.Cursor, "changes": []Record{rec(70, 20)}}, 200, &r3)
	if r3.Accepted != 1 || len(r3.Changes) != 1 || string(r3.Changes[0].Data) != `{"amt":70}` {
		t.Fatalf("newer push: %+v", r3)
	}
	// A fresh client pulls the current state only.
	var r4 syncResp
	call(t, ts, tok, "POST", "/api/sync", map[string]any{"since": 0}, 200, &r4)
	if len(r4.Changes) != 1 || r4.Cursor != 2 {
		t.Fatalf("pull: %+v", r4)
	}
}

func TestAuthAndUsers(t *testing.T) {
	ts, tok := newTestServer(t)
	call(t, ts, "", "POST", "/api/sync", map[string]any{}, http.StatusUnauthorized, nil)
	call(t, ts, "", "POST", "/api/login", map[string]string{"login": "muzh", "password": "bad"}, http.StatusUnauthorized, nil)
	var u User
	call(t, ts, tok, "POST", "/api/users", map[string]string{"login": "zhena", "name": "Жена", "password": "secret2"}, http.StatusCreated, &u)
	call(t, ts, tok, "POST", "/api/users", map[string]string{"login": "zhena", "name": "Ещё", "password": "secret2"}, http.StatusBadRequest, nil)
	call(t, ts, "", "POST", "/api/login", map[string]string{"login": "ZHENA", "password": "secret2"}, http.StatusOK, nil)
	call(t, ts, tok, "PATCH", "/api/users/"+u.ID, map[string]string{"name": "Лена"}, http.StatusOK, &u)
	if u.Name != "Лена" {
		t.Fatalf("rename: %+v", u)
	}
	var list []User
	call(t, ts, tok, "GET", "/api/users", nil, http.StatusOK, &list)
	if len(list) != 2 {
		t.Fatalf("users: %+v", list)
	}
	call(t, ts, tok, "DELETE", "/api/users/"+u.ID, nil, http.StatusOK, nil)
	call(t, ts, tok, "POST", "/api/logout", nil, http.StatusOK, nil)
	call(t, ts, tok, "GET", "/api/me", nil, http.StatusUnauthorized, nil)
}

func TestLoginRateLimit(t *testing.T) {
	ts, _ := newTestServer(t)
	got429 := false
	for i := 0; i < 15; i++ {
		b, _ := json.Marshal(map[string]string{"login": "nobody", "password": "x"})
		res, err := http.Post(ts.URL+"/api/login", "application/json", bytes.NewReader(b))
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode == http.StatusTooManyRequests {
			got429 = true
			break
		}
	}
	if !got429 {
		t.Fatal("password guessing was not limited")
	}
}

func TestBookIDAndSnapshot(t *testing.T) {
	dir := t.TempDir()
	db, err := openDB(filepath.Join(dir, "b.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a, _ := bookID(db)
	b, _ := bookID(db)
	if a == "" || a != b {
		t.Fatalf("book id must be stable, got %q and %q", a, b)
	}
	if err := snapshot(db, filepath.Join(dir, "backups")); err != nil {
		t.Fatal(err)
	}
	snap, err := openDB(filepath.Join(dir, "backups", "buh-"+time.Now().Format("2006-01-02")+".db"))
	if err != nil {
		t.Fatal(err)
	}
	defer snap.Close()
	if c, _ := bookID(snap); c != a {
		t.Fatalf("snapshot should carry the same book id, got %q", c)
	}
}
