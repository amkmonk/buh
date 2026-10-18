// Command buh-server stores and syncs the family book for the web, Windows and Android clients.
//
//	buh-server                                  run the server (BUH_ADDR, BUH_DB)
//	buh-server user add <login> <name> <pass>   create a user
//	buh-server user passwd <login> <pass>       change a password
//	buh-server user list                        list users
//	buh-server healthcheck                      exit 0 if the local server answers
package main

import (
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path"
	"strings"
	"syscall"
	"time"

	"golang.org/x/crypto/bcrypt"
)

//go:embed all:web
var webFS embed.FS

type Server struct {
	db     *sql.DB
	bookID string
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	if len(os.Args) == 2 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}
	dbPath := env("BUH_DB", "buh.db")
	db, err := openDB(dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	if len(os.Args) > 1 {
		if err := runCLI(db, os.Args[1:]); err != nil {
			fmt.Fprintln(os.Stderr, "ошибка:", err)
			os.Exit(1)
		}
		return
	}
	bootstrapUser(db)
	id, err := bookID(db)
	if err != nil {
		log.Fatal(err)
	}
	go snapshotLoop(db, dbPath)
	serve((&Server{db: db, bookID: id}).routes(), dbPath)
}

func waitForStop() {
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
}

// healthcheck probes the running server; used by the Docker HEALTHCHECK (the image has no shell or curl).
func healthcheck() int {
	addr := env("BUH_ADDR", ":8080")
	if strings.HasPrefix(addr, ":") {
		addr = "127.0.0.1" + addr
	}
	c := http.Client{Timeout: 3 * time.Second}
	res, err := c.Get("http://" + addr + "/api/health")
	if err != nil || res.StatusCode != http.StatusOK {
		return 1
	}
	res.Body.Close()
	return 0
}

// bootstrapUser creates the first user from BUH_ADMIN_* when the database has no users yet.
func bootstrapUser(db *sql.DB) {
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	if n > 0 {
		return
	}
	login, pass := os.Getenv("BUH_ADMIN_LOGIN"), os.Getenv("BUH_ADMIN_PASSWORD")
	if login == "" || pass == "" {
		log.Printf("no users yet: set BUH_ADMIN_LOGIN and BUH_ADMIN_PASSWORD or run `buh-server user add`")
		return
	}
	u, err := createUser(db, login, env("BUH_ADMIN_NAME", login), pass)
	if err != nil {
		log.Printf("bootstrap user: %v", err)
		return
	}
	log.Printf("created first user %q", u.Login)
}

func runCLI(db *sql.DB, args []string) error {
	if len(args) < 2 || args[0] != "user" {
		return errors.New("использование: user add <login> <name> <password> | user passwd <login> <password> | user list")
	}
	switch args[1] {
	case "add":
		if len(args) != 5 {
			return errors.New("user add <login> <name> <password>")
		}
		u, err := createUser(db, args[2], args[3], args[4])
		if err != nil {
			return err
		}
		fmt.Printf("создан пользователь %s (%s)\n", u.Login, u.Name)
	case "passwd":
		if len(args) != 4 {
			return errors.New("user passwd <login> <password>")
		}
		if len(args[3]) < 6 {
			return errors.New("пароль должен быть не короче 6 символов")
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(args[3]), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		res, err := db.Exec(`UPDATE users SET pass_hash = ? WHERE login = ?`, string(hash), strings.ToLower(args[2]))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return errors.New("пользователь не найден")
		}
		db.Exec(`DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE login = ?)`, strings.ToLower(args[2]))
		fmt.Println("пароль изменён")
	case "list":
		rows, err := db.Query(`SELECT login, name FROM users ORDER BY created_at`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var l, n string
			rows.Scan(&l, &n)
			fmt.Printf("%s\t%s\n", l, n)
		}
	default:
		return errors.New("неизвестная команда " + args[1])
	}
	return nil
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		if err := s.db.Ping(); err != nil {
			writeError(w, http.StatusServiceUnavailable, "db")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.HandleFunc("POST /api/logout", s.handleLogout)
	mux.HandleFunc("GET /api/me", s.requireAuth(s.handleMe))
	mux.HandleFunc("POST /api/sync", s.requireAuth(s.handleSync))
	mux.HandleFunc("GET /api/users", s.requireAuth(s.handleListUsers))
	mux.HandleFunc("POST /api/users", s.requireAuth(s.handleCreateUser))
	mux.HandleFunc("PATCH /api/users/{id}", s.requireAuth(s.handleUpdateUser))
	mux.HandleFunc("DELETE /api/users/{id}", s.requireAuth(s.handleDeleteUser))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "нет такого метода")
	})
	mux.Handle("/", spaHandler())
	return withRateLimit(withCORS(mux))
}

// withCORS lets the Windows and Android shells (different origins) call the API with a bearer token.
// No cookies are used, so a wildcard origin is safe here.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", "*")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			h.Set("Access-Control-Max-Age", "86400")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// spaHandler serves the embedded web client and falls back to index.html for client routes.
func spaHandler() http.Handler {
	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatal(err)
	}
	files := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(sub, p); err != nil {
			p = "index.html"
			r = r.Clone(r.Context())
			r.URL.Path = "/"
		}
		switch {
		case strings.HasPrefix(p, "assets/"):
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		default:
			w.Header().Set("Cache-Control", "no-cache")
		}
		if p == "index.html" {
			if _, err := fs.Stat(sub, "index.html"); err != nil {
				w.Header().Set("Content-Type", "text/plain; charset=utf-8")
				io.WriteString(w, "buh-server: веб-клиент не собран, API доступно по /api/")
				return
			}
		}
		files.ServeHTTP(w, r)
	})
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "некорректный JSON")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
