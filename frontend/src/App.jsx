import { useEffect, useState } from 'react'
import './App.css'

const EVENTS_URL = 'http://localhost:9090/events'

function App() {
  const [logs, setLogs] = useState([])
  const [status, setStatus] = useState('Connecting')

  useEffect(() => {
    const eventSource = new EventSource(EVENTS_URL)

    eventSource.onopen = () => {
      setStatus('Live')
    }

    eventSource.onmessage = (event) => {
      setLogs((previousLogs) => [event.data, ...previousLogs].slice(0, 100))
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
              Watch requests, blocks, and rate-limit events stream in from the
              proxy.
            </p>
          </div>
          <div className={`status-pill status-${status.toLowerCase()}`}>
            <span className="status-dot" />
            {status}
          </div>
        </div>

        <section className="log-card" aria-live="polite">
          <div className="log-card-header">
            <h2>Activity Feed</h2>
            <span>{logs.length} events</span>
          </div>

          {logs.length === 0 ? (
            <div className="empty-state">
              <p>No activity yet...</p>
              <p>Open the proxy routes to watch traffic appear here instantly.</p>
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
