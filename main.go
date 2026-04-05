package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"reverse-proxy/config"
	"reverse-proxy/middleware"
	"reverse-proxy/proxy"
	"reverse-proxy/streaming"
)

func buildChain(handler http.Handler, middlewares ...func(http.Handler) http.Handler) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		handler = middlewares[i](handler)
	}
	return handler
}

func main() {
	// 1. Load Initial Config
	if err := config.Load("config.json"); err != nil {
		log.Fatalf("[FATAL] Configuration load failed: %v", err)
	}

	// 2. Start Hot Reload Goroutine
	go config.Watch("config.json")

	// 3. Initialize Redis Connection
	middleware.InitRedis()

	// 4. SSE Stats Ticker (1-second intervals)
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		for range ticker.C {
			rps := atomic.SwapInt64(&streaming.RequestCount, 0)
			streaming.Emit(streaming.Event{
				Type:   "stats",
				Reason: fmt.Sprintf(`{"rps":%d,"totalBlocked":%d}`, rps, atomic.LoadInt64(&streaming.BlockedCount)),
			})
		}
	}()

	mux := http.NewServeMux()

	// 5. Route Registration
	mux.Handle("/events", streaming.GlobalBroker) // SSE
	mux.HandleFunc("/ws", streaming.WSHandler)    // WebSocket Admin

	// 6. Non-Negotiable Middleware Pipeline
	// Order: Blacklist -> WAF -> RateLimiter -> Proxy
	proxyHandler := proxy.NewReverseProxy()
	handler := buildChain(
		proxyHandler,
		middleware.RateLimiter,
		middleware.WAF,
		middleware.Blacklist,
	)
	mux.Handle("/", handler)

	// 7. Server Startup with Graceful Shutdown
	server := &http.Server{
		Addr:         ":9090",
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Println("[PROXY] Gateway Online on port 9090")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[PROXY] Server error: %v", err)
		}
	}()

	<-stop
	log.Println("[PROXY] Initiating graceful shutdown...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("[PROXY] Shutdown failed: %v", err)
	}
	log.Println("[PROXY] Offline.")
}
