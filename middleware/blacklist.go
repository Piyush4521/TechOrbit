package middleware

import (
	"net/http"
	"reverse-proxy/config"
	"reverse-proxy/streaming"
	"strings"
)

func Blacklist(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clientIP := extractIP(r)
		cfg := config.Get()

		for _, blocked := range cfg.Security.BlacklistedIPs {
			if clientIP == strings.TrimSpace(blocked) {
				streaming.TrackRequest(clientIP, r.Method, r.URL.Path, "blacklist_blocked", "IP Blacklisted")
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				w.Write([]byte(`{"error":"IP Blacklisted"}`))
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
