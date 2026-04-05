import { useEffect, useState } from 'react'
import './App.css'

const EVENTS_URL = 'http://localhost:9090/events'
const INITIAL_STATS = {
  incoming: 0,
  allowed: 0,
  blocked: 0,
  rateLimited: 0,
  blacklisted: 0,
  config: 0,
  errors: 0,
}

function parseEventLine(line) {
  const match = line.match(/^\[[^\]]+\]\s([^:]+):\s([\s\S]+)$/)

  if (!match) {
    return {
      type: 'Unknown',
      message: line,
    }
  }

  return {
    type: match[1],
    message: match[2],
  }
}

function updateStats(previousStats, type) {
  switch (type) {
    case 'Incoming':
      return { ...previousStats, incoming: previousStats.incoming + 1 }
    case 'Allowed':
      return { ...previousStats, allowed: previousStats.allowed + 1 }
    case 'Blocked':
      return { ...previousStats, blocked: previousStats.blocked + 1 }
    case 'RateLimited':
      return { ...previousStats, rateLimited: previousStats.rateLimited + 1 }
    case 'Blacklisted':
      return { ...previousStats, blacklisted: previousStats.blacklisted + 1 }
    case 'Config':
      return { ...previousStats, config: previousStats.config + 1 }
    case 'ProxyError':
      return { ...previousStats, errors: previousStats.errors + 1 }
    default:
      return previousStats
  }
}

function App() {
  const [logs, setLogs] = useState([])
  const [status, setStatus] = useState('Connecting')
  const [stats, setStats] = useState(INITIAL_STATS)
  const [lastEvent, setLastEvent] = useState({
    type: 'Waiting',
    message: 'Start the proxy and run the backend demo scripts to watch live behavior.',
  })

  useEffect(() => {
    const eventSource = new EventSource(EVENTS_URL)

    eventSource.onopen = () => {
      setStatus('Live')
    }

    eventSource.onmessage = (event) => {
      const parsedEvent = parseEventLine(event.data)

      setLogs((previousLogs) => [event.data, ...previousLogs].slice(0, 100))
      setStats((previousStats) => updateStats(previousStats, parsedEvent.type))
      setLastEvent(parsedEvent)
    }

    eventSource.onerror = () => {
      setStatus('Reconnecting')
    }

    return () => {
      eventSource.close()
    }
  }, [])

  return (
    <main className="dashboard-shell">
      <section className="dashboard-panel">
        <div className="dashboard-header">
          <div>
            <p className="eyebrow">Live monitoring</p>
            <h1>ProxyArmor Dashboard</h1>
            <p className="subcopy">
              Watch requests, rate limits, config reloads, and security blocks
              stream in from the proxy.
            </p>
          </div>
          <div className={`status-pill status-${status.toLowerCase()}`}>
            <span className="status-dot" />
            {status}
          </div>
        </div>

        <section className="stats-grid" aria-label="Live counters">
          <article className="stat-card">
            <span className="stat-label">Incoming</span>
            <strong>{stats.incoming}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-label">Allowed</span>
            <strong>{stats.allowed}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-label">Blocked</span>
            <strong>{stats.blocked}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-label">Rate Limited</span>
            <strong>{stats.rateLimited}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-label">Blacklisted</span>
            <strong>{stats.blacklisted}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-label">Config Updates</span>
            <strong>{stats.config}</strong>
          </article>
        </section>

        <section className="signal-card" aria-live="polite">
          <div>
            <p className="signal-label">Latest Event</p>
            <h2>{lastEvent.type}</h2>
            <p>{lastEvent.message}</p>
          </div>
          <span className={`signal-pill signal-${lastEvent.type.toLowerCase()}`}>
            {lastEvent.type}
          </span>
        </section>

        <section className="log-card" aria-live="polite">
          <div className="log-card-header">
            <h2>Activity Feed</h2>
            <span>{logs.length} events</span>
          </div>

          {logs.length === 0 ? (
            <div className="empty-state">
              <p>No activity yet...</p>
              <p>Run `npm run demo:normal` or `npm run demo:sqli` in `backend` to populate live traffic.</p>
            </div>
          ) : (
            <div className="log-list">
              {logs.map((log, index) => (
                <div className="log-row" key={`${log}-${index}`}>
                  <span className="log-index">{String(index + 1).padStart(2, '0')}</span>
                  <code>{log}</code>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  )
}

export default App
