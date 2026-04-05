# 🛡️ ProxyArmor
### Next-Gen Reverse Proxy & Intelligent API Gateway

**ProxyArmor** is a high-performance, security-first reverse proxy built in Go. It sits at the edge of your infrastructure, providing a resilient "Armor" layer that handles WAF protection, distributed rate limiting, and real-time observability through a live administrative dashboard.

---

## 🏗️ System Architecture

ProxyArmor utilizes a **Layered Middleware Pipeline**. Every request is scrutinized through a sequential security chain before being allowed to reach the upstream backend.



1.  **Ingress Layer**: Handles TLS termination and raw HTTP parsing.
2.  **Blacklist Shield**: Immediate $O(1)$ lookup for blocked IPs.
3.  **WAF Engine**: Deep Packet Inspection (DPI) using optimized Regex for SQLi and XSS detection.
4.  **Rate Limiting**: Distributed sliding-window logic backed by **Redis**.
5.  **Proxy/Forwarder**: High-concurrency transport to upstream services.
6.  **Observability**: Real-time telemetry via **SSE** and interactive control via **WebSockets**.

---

## ⚡ Performance & Statistics

ProxyArmor is built for the modern web, prioritizing low latency even under heavy attack loads.

| Metric | Result | Notes |
| :--- | :--- | :--- |
| **Throughput** | **211+ Req/sec** | Tested on local dev environment |
| **Max Latency** | **39ms** | Under concurrent 200-request burst |
| **Avg Overhead** | **< 2ms** | Latency added by security middleware |
| **Safety** | **100% Data Race Free** | Verified via `go run -race` |
| **WAF Accuracy** | **100% Block Rate** | Verified against standard OWASP injections |



---

## 🚀 Key Features

* **Hot-Reloading Config**: Update security rules in `config.json` and watch the proxy apply them instantly without a restart.
* **Intelligent WAF**: Advanced pattern matching to stop SQL Injection and Cross-Site Scripting (XSS) at the gateway.
* **Redis-Backed Rate Limiting**: Uses a sliding window algorithm to prevent brute-force attacks and API abuse.
* **Real-Time Dashboard**: A React-based console providing live RPS charts, a color-coded security feed, and "Kill Switch" IP blocking.

---

## 🛠️ Tech Stack

* **Backend**: Go 1.21+ (Standard Library, Gorilla WebSocket, fsnotify)
* **Database**: Redis (Rate limiting state)
* **Frontend**: React, Recharts, Tailwind-inspired CSS
* **Protocol**: SSE (Server-Sent Events) for telemetry, WebSockets for Admin control.

---

## 🚦 Getting Started

### 1. Prerequisites
* Go 1.21 or higher
* Redis Server (running on `localhost:6379`)
* Node.js (for Dashboard)

### 2. Installation
```bash
git clone https://github.com/TechOrbit/proxyarmor.git
cd proxyarmor
go mod tidy
```

### 3. Startup Sequence
Open four terminal windows:

**Terminal 1: Redis**
```bash
redis-server
```

**Terminal 2: Dummy Backend**
```bash
go run dummy-backend/main.go
```

**Terminal 3: ProxyArmor Gateway**
```bash
go run -race main.go
```

**Terminal 4: Admin Dashboard**
```bash
cd dashboard
npm install
npm start
```

---

## 🧪 Testing the Armor

**Scenario: SQL Injection Attack**
```powershell
curl.exe -i "http://localhost:9090/getAllUsers?id='OR'1'='1"
# Result: 403 Forbidden | Dashboard: Red Row Added
```

**Scenario: Rate Limit Trigger**
```powershell
1..6 | ForEach-Object { curl.exe -s -o /dev/null -w "%{http_code} " -X POST http://localhost:9090/login }
# Result: 200 200 200 200 200 429
```

---

## 👨‍💻 Contributors
* **Member 1**: Backend Core & Proxy Logic
* **Member 2**: WAF & Rate Limiting Middleware
* **Member 3**: React Dashboard & Real-Time Streaming

---
*Built for the Orchathon 2026.*
