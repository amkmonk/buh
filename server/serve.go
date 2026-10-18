package main

import (
	"context"
	"crypto/tls"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/acme/autocert"
	"golang.org/x/net/netutil"
)

const maxConns = 256

func newHTTPServer(h http.Handler) *http.Server {
	return &http.Server{
		Handler:           h,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
		ErrorLog:          log.New(quietTLSLog{}, "", 0),
	}
}

// quietTLSLog drops the endless "TLS handshake error" lines produced by scanners.
type quietTLSLog struct{}

func (quietTLSLog) Write(p []byte) (int, error) {
	if !strings.Contains(string(p), "TLS handshake error") {
		os.Stderr.Write(p)
	}
	return len(p), nil
}

func listen(addr string) net.Listener {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatal(err)
	}
	return netutil.LimitListener(ln, maxConns)
}

// serve runs plain HTTP on BUH_ADDR, or, when BUH_DOMAIN is set, HTTPS with a Let's Encrypt
// certificate on BUH_HTTPS_ADDR plus BUH_HTTP_ADDR for the ACME challenge and redirects.
func serve(h http.Handler, dbPath string) {
	var servers []*http.Server
	domain := os.Getenv("BUH_DOMAIN")
	if domain == "" {
		srv := newHTTPServer(h)
		ln := listen(env("BUH_ADDR", ":8080"))
		servers = append(servers, srv)
		go func() {
			log.Printf("listening on %s (http)", ln.Addr())
			if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Fatal(err)
			}
		}()
	} else {
		httpsAddr := env("BUH_HTTPS_ADDR", ":8443")
		m := &autocert.Manager{
			Prompt:     autocert.AcceptTOS,
			HostPolicy: autocert.HostWhitelist(domain),
			Cache:      autocert.DirCache(env("BUH_CERT_DIR", filepath.Join(filepath.Dir(dbPath), "certs"))),
			Email:      os.Getenv("BUH_ACME_EMAIL"),
		}
		port := ""
		if _, p, err := net.SplitHostPort(httpsAddr); err == nil && p != "443" {
			port = ":" + p
		}
		redirect := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, "https://"+domain+port+r.URL.RequestURI(), http.StatusMovedPermanently)
		})
		plain := newHTTPServer(withRateLimit(m.HTTPHandler(redirect)))
		secure := newHTTPServer(h)
		secure.TLSConfig = m.TLSConfig()
		secure.TLSConfig.MinVersion = tls.VersionTLS12
		servers = append(servers, plain, secure)
		lnPlain := listen(env("BUH_HTTP_ADDR", ":80"))
		lnTLS := listen(httpsAddr)
		go func() {
			log.Printf("listening on %s (acme + redirect)", lnPlain.Addr())
			if err := plain.Serve(lnPlain); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Fatal(err)
			}
		}()
		go func() {
			log.Printf("listening on %s (https for %s)", lnTLS.Addr(), domain)
			if err := secure.ServeTLS(lnTLS, "", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Fatal(err)
			}
		}()
	}
	waitForStop()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, s := range servers {
		s.Shutdown(ctx)
	}
}
