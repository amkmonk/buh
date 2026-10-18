package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID    string `json:"id"`
	Login string `json:"login"`
	Name  string `json:"name"`
}

type ctxKey struct{}

var loginRe = regexp.MustCompile(`^[a-z0-9._-]{3,32}$`)

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func hashToken(t string) string {
	s := sha256.Sum256([]byte(t))
	return hex.EncodeToString(s[:])
}

func validateUser(login, name, password string, needPassword bool) error {
	if !loginRe.MatchString(login) {
		return errors.New("логин: латинские буквы, цифры, точка, дефис, подчёркивание, от 3 до 32 символов")
	}
	if n := len([]rune(strings.TrimSpace(name))); n == 0 || n > 64 {
		return errors.New("имя: от 1 до 64 символов")
	}
	if needPassword && len(password) < 6 {
		return errors.New("пароль должен быть не короче 6 символов")
	}
	return nil
}

func createUser(db *sql.DB, login, name, password string) (User, error) {
	login = strings.ToLower(strings.TrimSpace(login))
	name = strings.TrimSpace(name)
	if err := validateUser(login, name, password, true); err != nil {
		return User{}, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}
	u := User{ID: randomHex(8), Login: login, Name: name}
	_, err = db.Exec(`INSERT INTO users(id, login, name, pass_hash, created_at) VALUES(?,?,?,?,?)`,
		u.ID, u.Login, u.Name, string(hash), time.Now().UnixMilli())
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return User{}, errors.New("такой логин уже есть")
		}
		return User{}, err
	}
	return u, nil
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Login    string `json:"login"`
		Password string `json:"password"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	login := strings.ToLower(strings.TrimSpace(req.Login))
	// Password guessing is limited both per client IP and per login.
	if !loginIP.allow(clientIP(r)) || !loginName.allow(login) {
		tooMany(w, 30*time.Second)
		return
	}
	var u User
	var hash string
	err := s.db.QueryRow(`SELECT id, login, name, pass_hash FROM users WHERE login = ?`, login).Scan(&u.ID, &u.Login, &u.Name, &hash)
	if err == nil {
		err = bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password))
	}
	if err != nil {
		writeError(w, http.StatusUnauthorized, "неверный логин или пароль")
		return
	}
	token := randomHex(32)
	now := time.Now().UnixMilli()
	if _, err := s.db.Exec(`INSERT INTO sessions(token_hash, user_id, created_at, last_seen) VALUES(?,?,?,?)`, hashToken(token), u.ID, now, now); err != nil {
		writeError(w, http.StatusInternalServerError, "не удалось создать сессию")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": u})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if tok := bearer(r); tok != "" {
		s.db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, hashToken(tok))
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

// requireAuth resolves the bearer token to a user and stores it in the request context.
func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok := bearer(r)
		if tok == "" {
			writeError(w, http.StatusUnauthorized, "нужен вход")
			return
		}
		var u User
		th := hashToken(tok)
		err := s.db.QueryRow(`SELECT u.id, u.login, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, th).Scan(&u.ID, &u.Login, &u.Name)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "сессия недействительна, войдите заново")
			return
		}
		s.db.Exec(`UPDATE sessions SET last_seen = ? WHERE token_hash = ?`, time.Now().UnixMilli(), th)
		next(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, u)))
	}
}

func currentUser(r *http.Request) User {
	u, _ := r.Context().Value(ctxKey{}).(User)
	return u
}
