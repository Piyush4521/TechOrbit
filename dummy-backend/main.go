package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// logMiddleware intercepts the request to print the required log format
func logMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Format: [BACKEND] METHOD /path - timestamp
		fmt.Printf("[BACKEND] %s %s - %s\n", r.Method, r.URL.Path, time.Now().Format(time.RFC3339))
		next(w, r)
	}
}

func getAllUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Login successful",
	})
}

func main() {
	mux := http.NewServeMux()

	// Register routes with the logging middleware
	mux.HandleFunc("/getAllUsers", logMiddleware(getAllUsers))
	mux.HandleFunc("/login", logMiddleware(login))

	port := ":8081"
	fmt.Printf("Dummy Backend starting on port %s...\n", port)

	if err := http.ListenAndServe(port, mux); err != nil {
		log.Fatalf("Server failed to start: %v\n", err)
	}
}
