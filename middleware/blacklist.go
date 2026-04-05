package middleware

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"reverse-proxy/config"
)

func extractIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		ips := strings.Split(xff, ",")
		return strings.TrimSpace(ips[0])
	}

	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}

	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}

	return ip
}

func Blacklist(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clientIP := extractIP(r)
		cfg := config.Get()

		for _, blocked := range cfg.Security.BlacklistedIPs {
			if clientIP == strings.TrimSpace(blocked) {
				log.Printf("[BLACKLIST] Blocked IP %s at %s\n", clientIP, time.Now().Format(time.RFC3339))

				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				json.NewEncoder(w).Encode(map[string]string{
					"error":  "Forbidden",
					"reason": "IP is blacklisted",
				})

				return
			}
		}

		next.ServeHTTP(w, r)
	})
}
