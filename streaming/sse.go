package streaming

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

var (
	RequestCount int64
	BlockedCount int64
)

type Event struct {
	Type      string `json:"type"`
	IP        string `json:"ip"`
	Path      string `json:"path"`
	Method    string `json:"method"`
	Decision  string `json:"decision"`
	Reason    string `json:"reason"`
	Timestamp string `json:"timestamp"`
}

type Broker struct {
	clients    map[chan Event]struct{}
	register   chan chan Event
	unregister chan chan Event
	broadcast  chan Event
	mu         sync.RWMutex
}

var GlobalBroker = NewBroker()

func NewBroker() *Broker {
	b := &Broker{
		clients:    make(map[chan Event]struct{}),
		register:   make(chan chan Event),
		unregister: make(chan chan Event),
		broadcast:  make(chan Event, 100),
	}
	go b.run()
	return b
}

func (b *Broker) run() {
	for {
		select {
		case client := <-b.register:
			b.mu.Lock()
			b.clients[client] = struct{}{}
			b.mu.Unlock()
		case client := <-b.unregister:
			b.mu.Lock()
			delete(b.clients, client)
			close(client)
			b.mu.Unlock()
		case event := <-b.broadcast:
			b.mu.RLock()
			for client := range b.clients {
				select {
				case client <- event:
				default:
				}
			}
			b.mu.RUnlock()
		}
	}
}

func (b *Broker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	clientChan := make(chan Event, 10)
	b.register <- clientChan

	defer func() { b.unregister <- clientChan }()

	for {
		select {
		case event := <-clientChan:
			data, _ := json.Marshal(event)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func Emit(event Event) {
	event.Timestamp = time.Now().Format(time.RFC3339)
	GlobalBroker.broadcast <- event
}
