package middleware

import (
	"encoding/json"
	"net"
	"net/http"
	"regexp"
	"reverse-proxy/streaming"
	"strings"
	"sync/atomic"
)

var sqlPatterns = []*regexp.Regexp{regexp.MustCompile(`(?i)(\bDROP\b|UNION\s+SELECT|OR['"\s]+.+\s*=\s*.+)`)}

func extractIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		ips := strings.Split(xff, ",")
		return strings.TrimSpace(ips[0])
	}
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}

func WAF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Count the request for the dashboard graph
		atomic.AddInt64(&streaming.RequestCount, 1)
		atomic.AddInt64(&streaming.TotalRequests, 1)

		clientIP := extractIP(r)

		// Scan Query Params
		if match := sqlPatterns[0].MatchString(r.URL.RawQuery); match {
			streaming.TrackRequest(clientIP, r.Method, r.URL.Path, "waf_blocked", "SQL Injection Detected")
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{"error": "SQLi Detected"})
			return
		}

		next.ServeHTTP(w, r)
	})
}
