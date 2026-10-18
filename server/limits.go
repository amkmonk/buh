package main

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// keyedLimiter is a token bucket per key (client IP or login), with idle keys dropped after a while.
type keyedLimiter struct {
	mu    sync.Mutex
	every rate.Limit
	burst int
	m     map[string]*visitor
}

type visitor struct {
	lim  *rate.Limiter
	seen time.Time
}

func newKeyedLimiter(every rate.Limit, burst int) *keyedLimiter {
	l := &keyedLimiter{every: every, burst: burst, m: map[string]*visitor{}}
	go func() {
		for range time.Tick(time.Minute) {
			l.mu.Lock()
			for k, v := range l.m {
				if time.Since(v.seen) > 15*time.Minute {
					delete(l.m, k)
				}
			}
			l.mu.Unlock()
		}
	}()
	return l
}

func (l *keyedLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	v, ok := l.m[key]
	if !ok {
		v = &visitor{lim: rate.NewLimiter(l.every, l.burst)}
		l.m[key] = v
	}
	v.seen = time.Now()
	return v.lim.Allow()
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func tooMany(w http.ResponseWriter, retry time.Duration) {
	w.Header().Set("Retry-After", strconv.Itoa(int(retry.Seconds())))
	writeError(w, http.StatusTooManyRequests, "слишком много запросов, попробуйте позже")
}

// Limits sized for a two-person family: generous for normal use, tight enough that a flood
// cannot eat the single CPU shared with the VPN.
var (
	apiLimiter    = newKeyedLimiter(10, 60)                         // per IP: 10 req/s, bursts of 60
	staticLimiter = newKeyedLimiter(20, 120)                        // per IP: page and assets
	loginIP       = newKeyedLimiter(rate.Every(12*time.Second), 10) // per IP: 10 tries, then 5 per minute
	loginName     = newKeyedLimiter(rate.Every(30*time.Second), 10) // per login: 10 tries, then 2 per minute
)

func withRateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		lim := staticLimiter
		if strings.HasPrefix(r.URL.Path, "/api/") {
			lim = apiLimiter
		}
		if !lim.allow(ip) {
			tooMany(w, 5*time.Second)
			return
		}
		next.ServeHTTP(w, r)
	})
}
