package proxy

import (
	"encoding/json"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"

	"reverse-proxy/config"
	"reverse-proxy/streaming"
)

func NewReverseProxy() http.Handler {
	cfg := config.Get()

	targetURL, err := url.Parse(cfg.Server.BackendURL)
	if err != nil {
		log.Fatalf("[PROXY] Invalid backend URL: %v", err)
	}

	proxy := httputil.NewSingleHostReverseProxy(targetURL)

	proxy.Transport = &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 100,
		IdleConnTimeout:     90 * time.Second,
	}

	proxy.ModifyResponse = func(resp *http.Response) error {
		streaming.Emit(streaming.Event{
			Type:     "request",
			Decision: "forwarded",
			Method:   resp.Request.Method,
			Path:     resp.Request.URL.Path,
			IP:       resp.Request.RemoteAddr,
		})
		log.Printf("[PROXY] Forwarded %s %s -> %d\n", resp.Request.Method, resp.Request.URL.Path, resp.StatusCode)
		return nil
	}

	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("[PROXY] Backend unreachable: %v\n", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":   "Bad Gateway",
			"message": "The backend server is currently unreachable.",
			"success": false,
		})
	}

	return proxy
}
