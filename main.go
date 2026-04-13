package main

import (
	"log"
	"net/http"
	"reverse-proxy/config"
	"reverse-proxy/middleware"
	"reverse-proxy/proxy"
	"reverse-proxy/streaming"
	"sync/atomic"
	"time"
)

func main() {
	config.Load("config.json")
	middleware.InitRedis()

	// 1-Second Ticker to send stats to the Dashboard
	go func() {
		for range time.Tick(1 * time.Second) {
			rps := atomic.SwapInt64(&streaming.RequestCount, 0)
			streaming.EmitStats(rps)
		}
	}()

	mux := http.NewServeMux()

	// Route to sse.go handler
	mux.HandleFunc("/events", streaming.SSEHandler)

	// Chain: Blacklist -> WAF -> RateLimit -> CircuitBreaker -> Proxy
	// TIER 2 FIX: Added CircuitBreakerMiddleware to prevent cascading failures
	handler := middleware.Blacklist(middleware.WAF(middleware.RateLimiter(middleware.CircuitBreakerMiddleware(proxy.NewReverseProxy()))))
	mux.Handle("/", handler)

	server := &http.Server{
		Addr:    ":9090",
		Handler: mux,
	}

	log.Println("🚀 ProxyArmor 2.0 Online on :9090")
	server.ListenAndServe()
}
