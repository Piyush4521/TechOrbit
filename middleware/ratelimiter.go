package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"sync/atomic"
	"time"

	"reverse-proxy/config"
	"reverse-proxy/streaming"

	"github.com/go-redis/redis/v8"
)

var redisClient *redis.Client

func InitRedis() {
	redisClient = redis.NewClient(&redis.Options{
		Addr:         "localhost:6379",
		PoolSize:     100,
		MinIdleConns: 10,
	})
}

func randomSuffix() string {
	b := make([]byte, 4)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func isRateLimited(ctx context.Context, ip, path, method string, rule config.RateLimitRule) bool {
	key := fmt.Sprintf("ratelimit:%s:%s:%s", ip, path, method)
	now := time.Now().UnixMilli()
	windowStart := now - int64(rule.WindowSeconds)*1000

	pipe := redisClient.Pipeline()

	pipe.ZRemRangeByScore(ctx, key, "0", strconv.FormatInt(windowStart, 10))
	countCmd := pipe.ZCard(ctx, key)
	member := fmt.Sprintf("%d-%s", now, randomSuffix())
	pipe.ZAdd(ctx, key, &redis.Z{Score: float64(now), Member: member})
	pipe.Expire(ctx, key, time.Duration(rule.WindowSeconds)*time.Second)

	_, err := pipe.Exec(ctx)
	if err != nil {
		log.Printf("[REDIS ERROR] %v\n", err)
		return false
	}

	return countCmd.Val() >= int64(rule.Limit)
}

func RateLimiter(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clientIP := extractIP(r)
		cfg := config.Get()

		var matchedRule *config.RateLimitRule
		for i, rule := range cfg.RateLimits {
			if rule.Path == r.URL.Path && rule.Method == r.Method {
				matchedRule = &cfg.RateLimits[i]
				break
			}
		}

		if matchedRule == nil {
			next.ServeHTTP(w, r)
			return
		}

		if isRateLimited(r.Context(), clientIP, r.URL.Path, r.Method, *matchedRule) {
			atomic.AddInt64(&streaming.BlockedCount, 1)
			streaming.Emit(streaming.Event{
				Type:     "blocked",
				Decision: "rate_limited",
				IP:       clientIP,
				Method:   r.Method,
				Path:     r.URL.Path,
				Reason:   "Rate limit exceeded",
			})

			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", strconv.Itoa(matchedRule.WindowSeconds))
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]string{
				"error":      "Too Many Requests",
				"retryAfter": strconv.Itoa(matchedRule.WindowSeconds),
			})
			log.Printf("[RATE LIMIT] Blocked %s on %s %s\n", clientIP, r.Method, r.URL.Path)
			return
		}

		next.ServeHTTP(w, r)
	})
}
