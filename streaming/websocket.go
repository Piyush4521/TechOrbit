package streaming

import (
	"fmt"
	"log"
	"net/http"

	"reverse-proxy/config"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

type Command struct {
	Action string `json:"action"`
	IP     string `json:"ip"`
}

type CommandResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

func processCommand(cmd Command) CommandResponse {
	switch cmd.Action {
	case "block_ip":
		config.AddBlacklistIP(cmd.IP)
		log.Printf("[WS] Admin blocked IP: %s\n", cmd.IP)
		return CommandResponse{
			Success: true,
			Message: fmt.Sprintf("IP %s blocked", cmd.IP),
		}

	case "unblock_ip":
		config.RemoveBlacklistIP(cmd.IP)
		log.Printf("[WS] Admin unblocked IP: %s\n", cmd.IP)
		return CommandResponse{
			Success: true,
			Message: fmt.Sprintf("IP %s unblocked", cmd.IP),
		}

	case "get_status":
		cfg := config.Get()
		return CommandResponse{
			Success: true,
			Data: map[string]any{
				"blacklisted_ips": cfg.Security.BlacklistedIPs,
				"rate_limits":     cfg.RateLimits,
			},
		}

	default:
		return CommandResponse{Success: false, Message: "Unknown command"}
	}
}

func WSHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WS] Upgrade failed: %v\n", err)
		return
	}
	defer conn.Close()

	log.Println("[WS] Admin dashboard connected")

	for {
		var cmd Command
		err := conn.ReadJSON(&cmd)
		if err != nil {
			log.Printf("[WS] Client disconnected: %v\n", err)
			break
		}

		response := processCommand(cmd)
		if err := conn.WriteJSON(response); err != nil {
			log.Printf("[WS] Write failed: %v\n", err)
			break
		}
	}
}
