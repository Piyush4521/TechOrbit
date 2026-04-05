package config

import (
	"encoding/json"
	"log"
	"os"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

type Config struct {
	Server     ServerConfig    `json:"server"`
	RateLimits []RateLimitRule `json:"rate_limits"`
	Security   SecurityConfig  `json:"security"`
}

type ServerConfig struct {
	ListenPort int    `json:"listen_port"`
	BackendURL string `json:"backend_url"`
}

type RateLimitRule struct {
	Path          string `json:"path"`
	Method        string `json:"method"`
	Limit         int    `json:"limit"`
	WindowSeconds int    `json:"window_seconds"`
}

type SecurityConfig struct {
	BlockSQLInjection bool     `json:"block_sql_injection"`
	BlockXSS          bool     `json:"block_xss"`
	BlacklistedIPs    []string `json:"blacklisted_ips"`
}

var (
	current Config
	mu      sync.RWMutex
)

func Load(path string) error {
	file, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	var newConfig Config
	if err := json.Unmarshal(file, &newConfig); err != nil {
		return err
	}

	mu.Lock()
	current = newConfig
	mu.Unlock()

	return nil
}

func Get() Config {
	mu.RLock()
	defer mu.RUnlock()
	return current
}

func Watch(path string) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Fatalf("[CONFIG ERROR] Failed to initialize watcher: %v", err)
	}
	defer watcher.Close()

	err = watcher.Add(path)
	if err != nil {
		log.Fatalf("[CONFIG ERROR] Failed to watch file: %v", err)
	}

	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			if event.Has(fsnotify.Write) {
				if err := Load(path); err != nil {
					log.Printf("[CONFIG ERROR] Reload failed: %v\n", err)
				} else {
					log.Printf("[CONFIG] Reloaded at %s\n", time.Now().Format(time.RFC3339))
				}
			}
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			log.Printf("[CONFIG ERROR] Watcher error: %v\n", err)
		}
	}
}
func AddBlacklistIP(ip string) {
	mu.Lock()
	defer mu.Unlock()
	current.Security.BlacklistedIPs = append(current.Security.BlacklistedIPs, ip)
}

func RemoveBlacklistIP(ip string) {
	mu.Lock()
	defer mu.Unlock()
	filtered := current.Security.BlacklistedIPs[:0]
	for _, existing := range current.Security.BlacklistedIPs {
		if existing != ip {
			filtered = append(filtered, existing)
		}
	}
	current.Security.BlacklistedIPs = filtered
}
