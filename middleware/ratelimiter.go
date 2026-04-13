package middleware

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"reverse-proxy/streaming"

	"github.com/redis/go-redis/v9"
)

var (
	rdb            *redis.Client
	ctx            = context.Background()
	redisAvailable = false

	// In-memory rate limiter fallback (when Redis unavailable)
	inMemoryLimits = &sync.Map{} // map[string]*tokenBucket
)

type tokenBucket struct {
	tokens    int64
	lastReset int64
	mu        sync.Mutex
}

// InitRedis connects to your local Redis instance for tracking hits
// Falls back to in-memory if Redis unavailable
func InitRedis() {
	rdb = redis.NewClient(&redis.Options{
		Addr: "127.0.0.1:6379",
	})

	// Test connection
	_, err := rdb.Ping(ctx).Result()
	if err != nil {
		redisAvailable = false
		fmt.Println("⚠️  Redis unavailable, using in-memory rate limiter")
	} else {
		redisAvailable = true
		fmt.Println("✅ Redis connected successfully")
	}
}

// Check rate limit using Redis or in-memory fallback
func checkRateLimit(ip, path string) (allowed bool, remaining int64) {
	key := fmt.Sprintf("ratelimit:%s:%s", ip, path)
	const limit = int64(60)
	const window = 10 * time.Second

	// Try Redis first
	if redisAvailable {
		luaScript := `
			local key = KEYS[1]
			local limit = tonumber(ARGV[1])
			local window = tonumber(ARGV[2])
			
			local current = redis.call("INCR", key)
			if current == 1 then
				redis.call("EXPIRE", key, window)
			end
			return current
		`
		count, err := rdb.Eval(ctx, luaScript, []string{key}, limit, 10).Int64()
		if err == nil {
			allowed := count <= limit
			return allowed, limit - count
		}
	}

	// Fallback to in-memory rate limiter
	bucket, _ := inMemoryLimits.LoadOrStore(key, &tokenBucket{
		tokens:    limit,
		lastReset: time.Now().Unix(),
	})
	tb := bucket.(*tokenBucket)

	tb.mu.Lock()
	defer tb.mu.Unlock()

	now := time.Now().Unix()
	// Reset tokens if window expired
	if now-tb.lastReset >= int64(window.Seconds()) {
		tb.tokens = limit
		tb.lastReset = now
	}

	// Check if token available
	if tb.tokens > 0 {
		tb.tokens--
		return true, tb.tokens
	}

	return false, 0
}

func RateLimiter(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Specifically targeting the /login path for the hackathon demo
		if r.URL.Path == "/login" {
			clientIP := extractIP(r)
			allowed, remaining := checkRateLimit(clientIP, r.URL.Path)

			if !allowed {
				streaming.TrackRequest(clientIP, r.Method, r.URL.Path, "rate_limited", "Rate Limit Exceeded (60/10sec)")
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("X-RateLimit-Remaining", "0")
				w.Header().Set("Retry-After", "10")
				w.WriteHeader(http.StatusTooManyRequests)
				w.Write([]byte(`{"error":"Too Many Requests","message":"Rate limit exceeded. Max 60 requests per 10 seconds per IP"}`))
				return
			}

			// Send rate limit headers
			w.Header().Set("X-RateLimit-Limit", "60")
			w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", remaining))
			w.Header().Set("X-RateLimit-Window", "10s")
		}

		// Proceed to next middleware or proxy if within limits
		next.ServeHTTP(w, r)
	})
}
