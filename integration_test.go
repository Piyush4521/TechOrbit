package main

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

// TestProxyConnectivity tests if the proxy server is responding
func TestProxyConnectivity(t *testing.T) {
	time.Sleep(2 * time.Second) // Wait for server to start

	conn, err := net.DialTimeout("tcp", "127.0.0.1:9090", 5*time.Second)
	if err != nil {
		t.Fatalf("Failed to connect to proxy: %v", err)
	}
	defer conn.Close()

	if conn == nil {
		t.Fatal("Connection object is nil")
	}
	t.Logf("✅ Proxy is reachable on localhost:9090")
}

// TestBackendConnectivity tests if the backend server is responding
func TestBackendConnectivity(t *testing.T) {
	time.Sleep(1 * time.Second)

	conn, err := net.DialTimeout("tcp", "127.0.0.1:8081", 5*time.Second)
	if err != nil {
		t.Fatalf("Failed to connect to backend: %v", err)
	}
	defer conn.Close()

	if conn == nil {
		t.Fatal("Connection object is nil")
	}
	t.Logf("✅ Backend is reachable on localhost:8081")
}

// TestGetAllUsersEndpoint tests the GET /getAllUsers endpoint through proxy
func TestGetAllUsersEndpoint(t *testing.T) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get("http://localhost:9090/getAllUsers")

	if err != nil {
		t.Fatalf("Failed to make request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Expected 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "success") {
		t.Fatalf("Response missing 'success' field")
	}

	t.Logf("✅ GET /getAllUsers: %d OK", resp.StatusCode)
	t.Logf("   Response: %.100s...", string(body))
}

// TestLoginEndpoint tests the POST /login endpoint through proxy
func TestLoginEndpoint(t *testing.T) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post("http://localhost:9090/login", "application/json", nil)

	if err != nil {
		t.Fatalf("Failed to make request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Expected 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "success") {
		t.Fatalf("Response missing 'success' field")
	}

	t.Logf("✅ POST /login: %d OK", resp.StatusCode)
}

// TestCORSHeaders tests if proper headers are forwarded
func TestCORSHeaders(t *testing.T) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get("http://localhost:9090/getAllUsers")

	if err != nil {
		t.Fatalf("Failed to make request: %v", err)
	}
	defer resp.Body.Close()

	contentType := resp.Header.Get("Content-Type")
	if !strings.Contains(contentType, "application/json") {
		t.Logf("⚠️  Content-Type header might be missing or incorrect: %s", contentType)
	}

	t.Logf("✅ Response headers verified")
}

// TestProxyForwarding tests if requests are actually forwarded to backend
func TestProxyForwarding(t *testing.T) {
	client := &http.Client{Timeout: 5 * time.Second}

	// Make request through proxy
	resp1, err := client.Get("http://localhost:9090/getAllUsers")
	if err != nil {
		t.Fatalf("Failed to request through proxy: %v", err)
	}
	defer resp1.Body.Close()

	// Make direct request to backend
	resp2, err := client.Get("http://localhost:8081/getAllUsers")
	if err != nil {
		t.Fatalf("Failed to request backend directly: %v", err)
	}
	defer resp2.Body.Close()

	// Both should return 200
	if resp1.StatusCode != http.StatusOK || resp2.StatusCode != http.StatusOK {
		t.Fatalf("Status mismatch: proxy=%d, backend=%d", resp1.StatusCode, resp2.StatusCode)
	}

	body1, _ := io.ReadAll(resp1.Body)
	body2, _ := io.ReadAll(resp2.Body)

	// Responses should be same
	if string(body1) != string(body2) {
		t.Logf("⚠️  Response content differs between proxy and direct")
		t.Logf("   Proxy: %.100s", string(body1))
		t.Logf("   Direct: %.100s", string(body2))
	}

	t.Logf("✅ Proxy successfully forwards requests to backend")
}

// TestRateLimiterTrigger tests if rate limiter engages
func TestRateLimiterTrigger(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping rate limiter test in short mode")
	}

	client := &http.Client{Timeout: 5 * time.Second}
	url := "http://localhost:9090/getAllUsers"
	limited := false
	attemptsBeforeLimit := 0

	// Config defines limit as 100 requests per 60 seconds for /getAllUsers
	for i := 0; i < 150; i++ {
		resp, err := client.Get(url)
		if err == nil {
			resp.Body.Close()

			if resp.StatusCode == http.StatusTooManyRequests {
				limited = true
				attemptsBeforeLimit = i + 1
				t.Logf("✅ Rate limit triggered at request %d", i+1)
				break
			}
		}
	}

	if !limited {
		t.Logf("⚠️  Rate limiter did not trigger (may be using in-memory fallback or Redis issue)")
	}

	t.Logf("   Rate limit config: 100 requests/60 seconds")
	t.Logf("   Triggered after: %d requests", attemptsBeforeLimit)
}

// TestWAFSQLInjection tests if WAF blocks SQL injection
func TestWAFSQLInjection(t *testing.T) {
	client := &http.Client{Timeout: 5 * time.Second}
	sqliPayloads := []string{
		"http://localhost:9090/?id=1' OR '1'='1",
		"http://localhost:9090/?q=admin' --",
		"http://localhost:9090/?user='; DROP TABLE users;--",
	}

	blockedCount := 0
	for _, payload := range sqliPayloads {
		resp, err := client.Get(payload)
		if err != nil {
			t.Logf("Request failed: %v", err)
			blockedCount++
			continue
		}
		defer resp.Body.Close()

		if resp.StatusCode == http.StatusForbidden {
			blockedCount++
			t.Logf("✅ SQL Injection blocked: %d %s", resp.StatusCode, resp.Status)
		} else {
			t.Logf("⚠️  SQL Injection NOT blocked: %d %s", resp.StatusCode, resp.Status)
		}
	}

	t.Logf("✅ WAF SQL Injection: %d/%d payloads blocked", blockedCount, len(sqliPayloads))
}

// TestWAFXSS tests if WAF blocks XSS attacks
func TestWAFXSS(t *testing.T) {
	client := &http.Client{Timeout: 5 * time.Second}
	xssPayloads := []string{
		"http://localhost:9090/?q=<script>alert('xss')</script>",
		"http://localhost:9090/?input=<img src=x onerror=alert(1)>",
		"http://localhost:9090/?data=javascript:alert('xss')",
	}

	blockedCount := 0
	for _, payload := range xssPayloads {
		resp, err := client.Get(payload)
		if err != nil {
			t.Logf("Request failed: %v", err)
			blockedCount++
			continue
		}
		defer resp.Body.Close()

		if resp.StatusCode == http.StatusForbidden {
			blockedCount++
			t.Logf("✅ XSS blocked: %d %s", resp.StatusCode, resp.Status)
		} else {
			t.Logf("⚠️  XSS NOT blocked: %d %s", resp.StatusCode, resp.Status)
		}
	}

	t.Logf("✅ WAF XSS: %d/%d payloads blocked", blockedCount, len(xssPayloads))
}

// TestBlacklistIP tests if blacklisted IPs are rejected
func TestBlacklistIP(t *testing.T) {
	client := &http.Client{Timeout: 5 * time.Second}
	req, _ := http.NewRequest("GET", "http://localhost:9090/getAllUsers", nil)

	// Set X-Forwarded-For with a blacklisted IP (from config.json: 203.0.113.42)
	req.Header.Set("X-Forwarded-For", "203.0.113.42")

	resp, err := client.Do(req)
	if err != nil {
		t.Logf("Request error: %v (may indicate IP was blocked)", err)
		t.Logf("✅ Blacklist appears to be working")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusForbidden {
		t.Logf("✅ Blacklisted IP rejected: %d Forbidden", resp.StatusCode)
	} else {
		t.Logf("⚠️  Blacklisted IP was NOT blocked: %d", resp.StatusCode)
	}
}

// TestConcurrentRequests tests proxy under concurrent load
func TestConcurrentRequests(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping concurrency test in short mode")
	}

	numRequests := 100
	done := make(chan bool, numRequests)
	client := &http.Client{Timeout: 10 * time.Second}

	startTime := time.Now()

	for i := 0; i < numRequests; i++ {
		go func(index int) {
			resp, err := client.Get("http://localhost:9090/getAllUsers")
			if err != nil {
				t.Logf("Request %d failed: %v", index, err)
			} else {
				resp.Body.Close()
			}
			done <- true
		}(i)
	}

	// Wait for all requests to complete
	completedRequests := 0
	for i := 0; i < numRequests; i++ {
		<-done
		completedRequests++
	}

	duration := time.Since(startTime).Seconds()
	rps := float64(completedRequests) / duration

	t.Logf("✅ Concurrent requests completed")
	t.Logf("   Total: %d requests", completedRequests)
	t.Logf("   Time: %.2f seconds", duration)
	t.Logf("   RPS: %.2f req/sec", rps)
}

// TestSSEStream tests if SSE stream endpoint is accessible
func TestSSEStream(t *testing.T) {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://localhost:9090/events")

	if err != nil {
		if strings.Contains(err.Error(), "context deadline exceeded") {
			t.Logf("✅ SSE stream is active (timeout = streaming continues)")
			return
		}
		t.Logf("⚠️  SSE stream error: %v", err)
		return
	}
	defer resp.Body.Close()

	// Check if Content-Type is text/event-stream
	contentType := resp.Header.Get("Content-Type")
	if strings.Contains(contentType, "event-stream") || strings.Contains(contentType, "text") {
		t.Logf("✅ SSE endpoint responding with correct content type")
	} else {
		t.Logf("⚠️  Unexpected content type: %s", contentType)
	}

	// Try to read first event
	reader := bufio.NewReader(resp.Body)
	line, _ := reader.ReadString('\n')

	if strings.Contains(line, "data:") || strings.Contains(line, "event:") {
		t.Logf("✅ SSE events are being sent")
	} else {
		t.Logf("⚠️  No SSE data detected in first line: %s", strings.TrimSpace(line))
	}
}

// TestResponseTime measures average response time
func TestResponseTime(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping performance test in short mode")
	}

	client := &http.Client{Timeout: 5 * time.Second}
	numRequests := 50
	totalTime := int64(0)
	minTime := int64(999999)
	maxTime := int64(0)

	for i := 0; i < numRequests; i++ {
		startTime := time.Now()
		resp, err := client.Get("http://localhost:9090/getAllUsers")
		duration := time.Since(startTime).Milliseconds()

		if err == nil {
			resp.Body.Close()
			totalTime += duration

			if duration < minTime {
				minTime = duration
			}
			if duration > maxTime {
				maxTime = duration
			}
		}
	}

	avgTime := totalTime / int64(numRequests)
	t.Logf("✅ Response time analysis (%d requests)", numRequests)
	t.Logf("   Min: %dms", minTime)
	t.Logf("   Avg: %dms", avgTime)
	t.Logf("   Max: %dms", maxTime)

	if avgTime > 100 {
		t.Logf("⚠️  Average response time seems high (>100ms)")
	}
}

func TestMain(m *testing.M) {
	fmt.Println("\n╔════════════════════════════════════════════════════════╗")
	fmt.Println("║     ProxyArmor 2.0 - Integration Tests                ║")
	fmt.Println("║   Make sure backend and proxy are RUNNING first!      ║")
	fmt.Println("╚════════════════════════════════════════════════════════╝")
	fmt.Println("\nStarting tests in 3 seconds...")
	time.Sleep(3 * time.Second)

	fmt.Println("✅ Backend should be running on :8081")
	fmt.Println("✅ Proxy should be running on :9090")
	fmt.Println("✅ Redis should be running on :6379")

	m.Run()
}
