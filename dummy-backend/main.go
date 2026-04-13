package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

var (
	requestCount int64
	// Batch logging: log every 1000 requests instead of every request
	batchSize       = 1000
	reqBuffer int64 = 0
	logOnce   sync.Once
)

// OPTIMIZED: Batch logging instead of per-request (reduces I/O overhead)
func logAsyncBatch(method, path string) {
	count := atomic.AddInt64(&reqBuffer, 1)
	if count%int64(batchSize) == 0 {
		fmt.Printf("[BACKEND] Processed %d requests (Last: %s %s at %s)\n", count, method, path, time.Now().Format(time.RFC3339))
	}
}

func getAllUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Log asynchronously (non-blocking)
	logAsyncBatch(r.Method, r.URL.Path)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"users":   []string{"alice", "bob", "charlie"},
	})
}

func login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Log asynchronously (non-blocking)
	logAsyncBatch(r.Method, r.URL.Path)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Login successful",
	})
}

func main() {
	mux := http.NewServeMux()

	// Register routes (REMOVED per-request logging middleware - now using async batch logging)
	mux.HandleFunc("/getAllUsers", getAllUsers)
	mux.HandleFunc("/login", login)

	port := ":8081"

	// OPTIMIZED: Better server configuration for high concurrency
	server := &http.Server{
		Addr:    port,
		Handler: mux,
		// Timeouts for better resource management
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  30 * time.Second,
		// Connection management
		MaxHeaderBytes: 1 << 20, // 1MB max header
	}

	// OPTIMIZED: Customize the default TCP listener for better concurrency
	listener, err := net.Listen("tcp", port)
	if err != nil {
		log.Fatalf("Failed to create listener: %v\n", err)
	}

	// Wrap listener to tune TCP socket settings
	listener = &tcpKeepAliveListener{listener.(*net.TCPListener)}

	fmt.Printf("🚀 Dummy Backend starting on port %s (OPTIMIZED for high concurrency)...\n", port)
	fmt.Printf("   - Removed per-request logging (was I/O bottleneck)\n")
	fmt.Printf("   - Using batch async logging every %d requests\n", batchSize)
	fmt.Printf("   - Server timeouts configured for stability\n")

	// Handle graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigChan
		fmt.Printf("\n⚠️  Received signal: %v, shutting down gracefully...\n", sig)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(ctx)
	}()

	// Start server with custom listener
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server failed to start: %v\n", err)
	}

	fmt.Println("✅ Backend shutdown complete")
}

// tcpKeepAliveListener wraps TCPListener to enable TCP keep-alive
type tcpKeepAliveListener struct {
	*net.TCPListener
}

// Accept accepts a connection, sets TCP keep-alive on it, and returns it
func (ln tcpKeepAliveListener) Accept() (net.Conn, error) {
	conn, err := ln.AcceptTCP()
	if err != nil {
		return nil, err
	}
	conn.SetKeepAlive(true)
	conn.SetKeepAlivePeriod(3 * time.Minute)
	return conn, nil
}
