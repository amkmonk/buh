package main

import (
	"net/http"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, currentUser(r))
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`SELECT id, login, name FROM users ORDER BY created_at`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	users := []User{}
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Login, &u.Name); err == nil {
			users = append(users, u)
		}
	}
	writeJSON(w, http.StatusOK, users)
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var req struct{ Login, Name, Password string }
	if !readJSON(w, r, &req) {
		return
	}
	u, err := createUser(s.db, req.Login, req.Name, req.Password)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, u)
}

func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Login    *string `json:"login"`
		Name     *string `json:"name"`
		Password *string `json:"password"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	var u User
	if err := s.db.QueryRow(`SELECT id, login, name FROM users WHERE id = ?`, id).Scan(&u.ID, &u.Login, &u.Name); err != nil {
		writeError(w, http.StatusNotFound, "пользователь не найден")
		return
	}
	if req.Login != nil {
		u.Login = strings.ToLower(strings.TrimSpace(*req.Login))
	}
	if req.Name != nil {
		u.Name = strings.TrimSpace(*req.Name)
	}
	pass := ""
	if req.Password != nil {
		pass = *req.Password
	}
	if err := validateUser(u.Login, u.Name, pass, req.Password != nil); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := s.db.Exec(`UPDATE users SET login = ?, name = ? WHERE id = ?`, u.Login, u.Name, u.ID); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeError(w, http.StatusBadRequest, "такой логин уже есть")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if req.Password != nil {
		hash, err := bcrypt.GenerateFromPassword([]byte(pass), bcrypt.DefaultCost)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		s.db.Exec(`UPDATE users SET pass_hash = ? WHERE id = ?`, string(hash), u.ID)
		// Sign out the user's other devices; the caller keeps its own session.
		s.db.Exec(`DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?`, u.ID, hashToken(bearer(r)))
	}
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == currentUser(r).ID {
		writeError(w, http.StatusBadRequest, "себя удалить нельзя")
		return
	}
	res, err := s.db.Exec(`DELETE FROM users WHERE id = ?`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "пользователь не найден")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
