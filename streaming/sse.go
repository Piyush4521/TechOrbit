package streaming

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

type Event struct {
	Type       string `json:"type"`
	Decision   string `json:"decision"`
	IP         string `json:"ip"`
	Method     string `json:"method"`
	Path       string `json:"path"`
	Reason     string `json:"reason,omitempty"`
	Timestamp  string `json:"timestamp"`
	StatusCode int    `json:"statusCode,omitempty"`
	ResponseMs int    `json:"responseMs,omitempty"`
}

type StatsSnapshot struct {
	Type           string           `json:"type"`
	RPS            int64            `json:"rps"`
	TotalRequests  int64            `json:"totalRequests"`
	TotalBlocked   int64            `json:"totalBlocked"`
	TotalForwarded int64            `json:"totalForwarded"`
	BlockedRate    float64          `json:"blockedRate"`
	BlockedByType  map[string]int64 `json:"blockedByType"`
	TopIPs         map[string]int64 `json:"topIPs"`
	TopEndpoints   map[string]int64 `json:"topEndpoints"`
	Timestamp      string           `json:"timestamp"`
}

var (
	RequestCount       int64
	BlockedCount       int64
	ForwardedCount     int64
	TotalRequests      int64
	BlockedByWAF       int64
	BlockedByRateLimit int64
	BlockedByBlacklist int64
	clients            = make(map[chan string]bool)
	clientsMu          sync.RWMutex

	// High-performance lock-free tracking using sync.Map
	ipCountMap   = &sync.Map{}
	endpointMap  = &sync.Map{}
	blockTypeMap = &sync.Map{}

	// Periodic reset
	lastResetTime int64
	resetInterval = int64(60) // Reset every 60 seconds
)

func SSEHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	messageChan := make(chan string, 500) // Larger buffer for high throughput
	clientsMu.Lock()
	clients[messageChan] = true
	clientsMu.Unlock()

	defer func() {
		clientsMu.Lock()
		delete(clients, messageChan)
		clientsMu.Unlock()
		close(messageChan)
	}()

	for msg := range messageChan {
		fmt.Fprintf(w, "data: %s\n\n", msg)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
	}
}

// TrackRequest logs a request with its tracking information - OPTIMIZED
func TrackRequest(ip, method, path string, decision string, reason string) {
	// Use lock-free sync.Map for tracking (no mutex contention)
	// Increment IP count
	if val, ok := ipCountMap.Load(ip); ok {
		ipCountMap.Store(ip, val.(int64)+1)
	} else {
		ipCountMap.Store(ip, int64(1))
	}

	// Increment endpoint count
	if val, ok := endpointMap.Load(path); ok {
		endpointMap.Store(path, val.(int64)+1)
	} else {
		endpointMap.Store(path, int64(1))
	}

	// Track block types and update counters
	if decision != "forwarded" {
		if val, ok := blockTypeMap.Load(reason); ok {
			blockTypeMap.Store(reason, val.(int64)+1)
		} else {
			blockTypeMap.Store(reason, int64(1))
		}
		atomic.AddInt64(&BlockedCount, 1)
	} else {
		atomic.AddInt64(&ForwardedCount, 1)
	}

	// Only emit event if we have active dashboard clients (reduce overhead)
	clientsMu.RLock()
	hasClients := len(clients) > 0
	clientsMu.RUnlock()

	if !hasClients {
		return // Skip event emission if no one is listening
	}

	// Emit the event with smart throttling: only send 1 in 10 blocked events during high load
	// This prevents dashboard from being overwhelmed while still showing activity
	if decision == "rate_limited" {
		// Sample: only emit 1 in 10 rate-limit events (reduces 70k events to 7k)
		if rand.Int63()%10 != 0 {
			return
		}
	}

	// Emit the event
	event := Event{
		Type:      "event",
		Decision:  decision,
		IP:        ip,
		Method:    method,
		Path:      path,
		Reason:    reason,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	Emit(event)
}

// GetTopItems returns the top N items from a sync.Map - OPTIMIZED
func getTopItems(sm *sync.Map, limit int) map[string]int64 {
	result := make(map[string]int64)

	// Collect all items from sync.Map
	type kv struct {
		key string
		val int64
	}
	var items []kv

	sm.Range(func(k, v interface{}) bool {
		key := k.(string)
		val := v.(int64)
		items = append(items, kv{key, val})
		return true
	})

	// Sort by value descending
	sort.Slice(items, func(i, j int) bool {
		return items[i].val > items[j].val
	})

	// Take top N
	count := limit
	if len(items) < limit {
		count = len(items)
	}

	for i := 0; i < count; i++ {
		result[items[i].key] = items[i].val
	}

	return result
}

// Emit broadcasts to all connected clients (optimized with RWLock)
func Emit(data interface{}) {
	var msg string

	switch v := data.(type) {
	case string:
		msg = v
	default:
		bytes, _ := json.Marshal(v)
		msg = string(bytes)
	}

	// Use RWLock for better concurrent reads
	clientsMu.RLock()
	clientList := make([]chan string, 0, len(clients))
	for client := range clients {
		clientList = append(clientList, client)
	}
	clientsMu.RUnlock()

	// Send to each client without holding the lock
	for _, client := range clientList {
		select {
		case client <- msg:
		default:
			// Channel full, skip to prevent blocking
		}
	}
}

// EmitStats sends aggregated statistics snapshot to dashboard - LOCK-FREE
func EmitStats(rps int64) {
	// Use lock-free getTopItems with sync.Map
	topIPs := getTopItems(ipCountMap, 5)
	topEndpoints := getTopItems(endpointMap, 5)

	// Build block types from sync.Map without locks
	blockTypes := make(map[string]int64)
	blockTypeMap.Range(func(k, v interface{}) bool {
		blockTypes[k.(string)] = v.(int64)
		return true
	})

	total := atomic.LoadInt64(&TotalRequests)
	blocked := atomic.LoadInt64(&BlockedCount)
	forwarded := atomic.LoadInt64(&ForwardedCount)

	var blockedRate float64
	if total > 0 {
		blockedRate = (float64(blocked) / float64(total)) * 100
	}

	stats := StatsSnapshot{
		Type:           "stats",
		RPS:            rps,
		TotalRequests:  total,
		TotalBlocked:   blocked,
		TotalForwarded: forwarded,
		BlockedRate:    blockedRate,
		BlockedByType:  blockTypes,
		TopIPs:         topIPs,
		TopEndpoints:   topEndpoints,
		Timestamp:      time.Now().UTC().Format(time.RFC3339),
	}

	// Only emit if we have active listeners
	clientsMu.RLock()
	hasClients := len(clients) > 0
	clientsMu.RUnlock()

	if hasClients {
		Emit(stats)
	}

	// Periodic cleanup - reset maps every N seconds to prevent unbounded growth
	now := time.Now().Unix()
	if now-atomic.LoadInt64(&lastResetTime) > resetInterval {
		atomic.StoreInt64(&lastResetTime, now)
		// Reset tracking maps
		ipCountMap.Range(func(k, v interface{}) bool {
			ipCountMap.Delete(k)
			return true
		})
		endpointMap.Range(func(k, v interface{}) bool {
			endpointMap.Delete(k)
			return true
		})
		blockTypeMap.Range(func(k, v interface{}) bool {
			blockTypeMap.Delete(k)
			return true
		})
	}
}
