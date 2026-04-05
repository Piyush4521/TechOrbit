package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"regexp"
	"sync/atomic"

	"reverse-proxy/config"
	"reverse-proxy/streaming"
)

var (
	sqlPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bALTER\b)`),
		regexp.MustCompile(`(?i)UNION\s+SELECT`),
		regexp.MustCompile(`(?i)OR['"\s]+.+\s*=\s*.+`),
		regexp.MustCompile(`(?i)INSERT\s+INTO`),
		regexp.MustCompile(`(?i)SELECT\s+.*\s+FROM`),
	}
	// xssPatterns are fine as they are

	xssPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)<script\b`),
		regexp.MustCompile(`(?i)javascript\s*:`),
		regexp.MustCompile(`(?i)onerror\s*=`),
		regexp.MustCompile(`(?i)onload\s*=`),
		regexp.MustCompile(`(?i)<iframe\b`),
	}
)

func scanForThreats(data string, cfg config.Config) (bool, string) {
	if cfg.Security.BlockSQLInjection {
		for _, pattern := range sqlPatterns {
			if pattern.MatchString(data) {
				return true, "SQL Injection detected"
			}
		}
	}
	if cfg.Security.BlockXSS {
		for _, pattern := range xssPatterns {
			if pattern.MatchString(data) {
				return true, "XSS attack detected"
			}
		}
	}
	return false, ""
}

func blockRequest(w http.ResponseWriter, clientIP, reason, path, method string) {
	atomic.AddInt64(&streaming.BlockedCount, 1)
	streaming.Emit(streaming.Event{
		Type:     "blocked",
		Decision: "waf_blocked",
		IP:       clientIP,
		Method:   method,
		Path:     path,
		Reason:   reason,
	})

	log.Printf("[WAF] Blocked %s - %s - %s\n", clientIP, reason, path)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	json.NewEncoder(w).Encode(map[string]string{
		"error":  "Forbidden",
		"reason": reason,
	})
}

func WAF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cfg := config.Get()
		clientIP := extractIP(r)

		// 1. Scan the Query String (The part after the ?)
		fullQuery := r.URL.RawQuery
		if fullQuery != "" {
			if isThreat, reason := scanForThreats(fullQuery, cfg); isThreat {
				blockRequest(w, clientIP, reason, r.URL.Path, r.Method)
				return
			}
		}

		// 2. Scan the Body (for POST requests)
		if r.Body != nil {
			bodyBytes, err := io.ReadAll(r.Body)
			if err == nil && len(bodyBytes) > 0 {
				if isThreat, reason := scanForThreats(string(bodyBytes), cfg); isThreat {
					blockRequest(w, clientIP, reason, r.URL.Path, r.Method)
					return
				}
				r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
			}
		}

		next.ServeHTTP(w, r)
	})
}
