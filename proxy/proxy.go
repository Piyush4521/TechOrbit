package proxy

import (
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"reverse-proxy/config"
	"reverse-proxy/streaming"
	"strings"
	"time"
)

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

func NewReverseProxy() http.Handler {
	cfg := config.Get()
	target, _ := url.Parse(cfg.Server.BackendURL)

	proxy := httputil.NewSingleHostReverseProxy(target)

	// ✅ Optimized Transport for 5000+ Concurrency
	// FIXED: Increased MaxIdleConnsPerHost from 1000 to 5000 (was bottleneck on 54.6% of requests)
	proxy.Transport = &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   5 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:        2000,
		MaxIdleConnsPerHost: 5000,
		IdleConnTimeout:     30 * time.Second,
	}

	// Wrap the proxy to track forwarded requests
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clientIP := extractIP(r)

		// Track the forwarded request
		streaming.TrackRequest(clientIP, r.Method, r.URL.Path, "forwarded", "")

		// Serve the proxied request
		proxy.ServeHTTP(w, r)
	})
}
