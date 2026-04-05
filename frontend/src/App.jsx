import { useEffect, useMemo, useState } from 'react'
import './App.css'

const EVENTS_URL = 'http://localhost:9090/events'
const STORAGE_KEY = 'proxyarmor:events:v2'
const MAX_EVENTS = 100
const EVENT_PATTERN = /^\[([^\]]+)\]\s([^:]+):\s([\s\S]+)$/

const EMPTY_EVENT = {
  id: 'waiting',
  type: 'Waiting',
  timestamp: '',
  message: 'Start the proxy and run the backend demo scripts to watch live behavior.',
  line: '',
  details: {},
}

const STAT_CARDS = [
  {
    key: 'incoming',
    label: 'Incoming',
    type: 'Incoming',
    slug: 'incoming',
    description: 'Requests entering ProxyArmor before inspection or forwarding.',
  },
  {
    key: 'allowed',
    label: 'Allowed',
    type: 'Allowed',
    slug: 'allowed',
    description: 'Requests that safely reached the backend and returned a response.',
  },
  {
    key: 'blocked',
    label: 'Blocked',
    type: 'Blocked',
    slug: 'blocked',
    description: 'Threats or malformed requests stopped before they hit the backend.',
  },
  {
    key: 'rateLimited',
    label: 'Rate Limited',
    type: 'RateLimited',
    slug: 'rate-limited',
    description: 'Requests throttled by the sliding-window rate limiter.',
  },
  {
    key: 'blacklisted',
    label: 'Blacklisted',
    type: 'Blacklisted',
    slug: 'blacklisted',
    description: 'IPs permanently banned after repeated malicious traffic.',
  },
  {
    key: 'config',
    label: 'Config Updates',
    type: 'Config',
    slug: 'config-updates',
    description: 'Reloads and persistence events coming from config.json changes.',
  },
  {
    key: 'errors',
    label: 'Proxy Errors',
    type: 'ProxyError',
    slug: 'proxy-errors',
    description: 'Failures while ProxyArmor processed or forwarded traffic.',
  },
]

const STAT_BY_TYPE = Object.fromEntries(STAT_CARDS.map((card) => [card.type, card]))
const STAT_BY_SLUG = Object.fromEntries(STAT_CARDS.map((card) => [card.slug, card]))
const CONSUMED_DETAIL_KEYS = new Set([
  'method',
  'path',
  'rawPath',
  'search',
  'queryParams',
  'ip',
  'headers',
  'bodyBytes',
  'bodyPreview',
  'reason',
  'category',
  'signal',
  'reputation',
  'blacklisted',
  'violationCount',
  'maxViolations',
  'violationWindowMs',
  'windowMs',
  'configuredLimit',
  'effectiveLimit',
  'retryAfterMs',
  'matchedRule',
  'stage',
  'statusCode',
  'backendUrl',
  'targetOrigin',
  'targetPath',
  'upstreamStatus',
  'queueLength',
  'maxQueueLength',
])

function makeFallbackId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeEventRecord(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null
  }

  const type = typeof candidate.type === 'string' && candidate.type.trim()
    ? candidate.type.trim()
    : 'Unknown'
  const message = typeof candidate.message === 'string' && candidate.message.trim()
    ? candidate.message.trim()
    : 'No message'
  const timestamp = typeof candidate.timestamp === 'string' && candidate.timestamp.trim()
    ? candidate.timestamp
    : new Date().toISOString()
  const rawId = candidate.id === undefined || candidate.id === null ? makeFallbackId() : String(candidate.id)
  const id = rawId.includes(':') ? rawId : `${timestamp}:${rawId}`
  const details = candidate.details && typeof candidate.details === 'object' && !Array.isArray(candidate.details)
    ? candidate.details
    : {}
  const line = typeof candidate.line === 'string' && candidate.line.trim()
    ? candidate.line
    : `[${timestamp}] ${type}: ${message}`

  return {
    id,
    type,
    message,
    timestamp,
    line,
    details,
  }
}

function parseLegacyEventLine(line) {
  const match = line.match(EVENT_PATTERN)

  if (!match) {
    return normalizeEventRecord({
      type: 'Unknown',
      message: line,
      timestamp: new Date().toISOString(),
      line,
      details: {},
    })
  }

  return normalizeEventRecord({
    timestamp: match[1],
    type: match[2],
    message: match[3],
    line,
    details: {},
  })
}

function parseIncomingEvent(rawPayload) {
  if (typeof rawPayload !== 'string') {
    return null
  }

  try {
    return normalizeEventRecord(JSON.parse(rawPayload))
  } catch {
    return parseLegacyEventLine(rawPayload)
  }
}

function loadStoredEvents() {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)

    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.map(normalizeEventRecord).filter(Boolean).slice(0, MAX_EVENTS)
  } catch {
    return []
  }
}

function buildStats(events) {
  const baseStats = {
    incoming: 0,
    allowed: 0,
    blocked: 0,
    rateLimited: 0,
    blacklisted: 0,
    config: 0,
    errors: 0,
  }

  for (const event of events) {
    const stat = STAT_BY_TYPE[event.type]

    if (stat) {
      baseStats[stat.key] += 1
    }
  }

  return baseStats
}

function getRouteFromHash(hash = '') {
  const cleanedHash = hash.replace(/^#/, '') || '/'
  const eventMatch = cleanedHash.match(/^\/event\/(.+)$/)

  if (eventMatch) {
    return {
      name: 'event',
      eventId: decodeURIComponent(eventMatch[1]),
    }
  }

  const categoryMatch = cleanedHash.match(/^\/category\/(.+)$/)

  if (categoryMatch) {
    return {
      name: 'category',
      slug: decodeURIComponent(categoryMatch[1]),
    }
  }

  return { name: 'dashboard' }
}

function useHashRoute() {
  const [route, setRoute] = useState(() => {
    if (typeof window === 'undefined') {
      return { name: 'dashboard' }
    }

    return getRouteFromHash(window.location.hash)
  })

  useEffect(() => {
    const updateRoute = () => {
      setRoute(getRouteFromHash(window.location.hash))
    }

    window.addEventListener('hashchange', updateRoute)
    return () => window.removeEventListener('hashchange', updateRoute)
  }, [])

  return route
}

function getTone(type) {
  switch (type) {
    case 'Allowed':
    case 'Live':
    case 'Startup':
      return 'good'
    case 'Blocked':
    case 'Blacklisted':
    case 'ProxyError':
    case 'Dropped':
      return 'danger'
    case 'RateLimited':
    case 'Config':
    case 'Queued':
      return 'warn'
    default:
      return 'neutral'
  }
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return 'Waiting for live traffic'
  }

  const value = new Date(timestamp)

  if (Number.isNaN(value.getTime())) {
    return timestamp
  }

  return value.toLocaleString()
}

function formatDuration(milliseconds) {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds)) {
    return null
  }

  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)} ms`
  }

  if (milliseconds < 60000) {
    const seconds = milliseconds / 1000
    return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} sec`
  }

  if (milliseconds < 3600000) {
    const minutes = milliseconds / 60000
    return `${minutes.toFixed(minutes >= 10 ? 0 : 1)} min`
  }

  const hours = milliseconds / 3600000
  return `${hours.toFixed(hours >= 10 ? 0 : 1)} hr`
}

function formatRule(rule) {
  if (!rule || typeof rule !== 'object') {
    return null
  }

  const method = rule.method || '*'
  const path = rule.path || '*'
  return `${method} ${path}`
}

function formatValue(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }

  return String(value)
}

function getSummaryChips(event) {
  const chips = []
  const { details } = event

  if (details.method && details.path) {
    chips.push(`${details.method} ${details.path}`)
  } else if (details.path) {
    chips.push(details.path)
  }

  if (details.ip) {
    chips.push(details.ip)
  }

  if (details.reason) {
    chips.push(details.reason)
  } else if (details.category) {
    chips.push(details.category)
  }

  return chips.slice(0, 3)
}

function DetailList({ items }) {
  const visibleItems = items.filter((item) => item.value !== null)

  if (visibleItems.length === 0) {
    return null
  }

  return (
    <div className="detail-grid">
      {visibleItems.map((item) => (
        <article className="detail-item" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </article>
      ))}
    </div>
  )
}

function TypePill({ type }) {
  return <span className={`type-pill tone-${getTone(type)}`}>{type}</span>
}

function EmptyState({ title, copy }) {
  return (
    <div className="empty-state">
      <p>{title}</p>
      <p>{copy}</p>
    </div>
  )
}

function EventRow({ event, index }) {
  const chips = getSummaryChips(event)

  return (
    <a className="log-row" href={`#/event/${encodeURIComponent(event.id)}`}>
      <span className="log-index">{String(index + 1).padStart(2, '0')}</span>
      <div className="log-main">
        <div className="log-topline">
          <strong>{event.message}</strong>
          <TypePill type={event.type} />
        </div>
        <p className="log-time">{formatTimestamp(event.timestamp)}</p>
        {chips.length > 0 ? (
          <div className="log-chips">
            {chips.map((chip) => (
              <span className="log-chip" key={`${event.id}-${chip}`}>
                {chip}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <span className="log-link">Open details</span>
    </a>
  )
}

function DashboardView({ status, stats, events, lastEvent }) {
  return (
    <>
      <div className="dashboard-header">
        <div>
          <p className="eyebrow">Live monitoring</p>
          <h1>ProxyArmor Dashboard</h1>
          <p className="subcopy">
            Open each dashboard block for its own detail page, then drill into any
            single incident for the full request and protection context.
          </p>
        </div>
        <div className={`status-pill status-${status.toLowerCase()}`}>
          <span className="status-dot" />
          {status}
        </div>
      </div>

      <section className="stats-grid" aria-label="Live counters">
        {STAT_CARDS.map((card) => (
          <a className="stat-card" href={`#/category/${card.slug}`} key={card.key}>
            <span className="stat-label">{card.label}</span>
            <strong>{stats[card.key]}</strong>
            <p>{card.description}</p>
            <span className="stat-link">Open detailed page</span>
          </a>
        ))}
      </section>

      <section className="signal-card" aria-live="polite">
        <div className="signal-copy">
          <p className="signal-label">Latest Event</p>
          <div className="signal-header">
            <h2>{lastEvent.type}</h2>
            <TypePill type={lastEvent.type} />
          </div>
          <p>{lastEvent.message}</p>
          <p className="signal-time">{formatTimestamp(lastEvent.timestamp)}</p>
        </div>
        {lastEvent.id === EMPTY_EVENT.id ? (
          <span className="signal-link muted-link">Waiting for events</span>
        ) : (
          <a className="signal-link" href={`#/event/${encodeURIComponent(lastEvent.id)}`}>
            View incident detail
          </a>
        )}
      </section>

      <section className="list-card" aria-live="polite">
        <div className="list-header">
          <div>
            <h2>Activity Feed</h2>
            <p>Every event is clickable and opens its own detailed page.</p>
          </div>
          <span>{events.length} events</span>
        </div>

        {events.length === 0 ? (
          <EmptyState
            title="No activity yet..."
            copy="Run `npm run demo:normal` or `npm run demo:sqli` in `backend` to populate live traffic."
          />
        ) : (
          <div className="log-list">
            {events.map((event, index) => (
              <EventRow event={event} index={index} key={event.id} />
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function CategoryPage({ card, events }) {
  const latestEvent = events[0] || null
  const summaryItems = [
    {
      label: 'Captured Events',
      value: formatValue(events.length),
    },
    {
      label: 'Latest Seen',
      value: latestEvent ? formatTimestamp(latestEvent.timestamp) : 'No data yet',
    },
    {
      label: 'Latest IP',
      value: latestEvent ? formatValue(latestEvent.details.ip) : null,
    },
    {
      label: 'Latest Path',
      value: latestEvent ? formatValue(latestEvent.details.path) : null,
    },
  ]

  return (
    <>
      <div className="page-toolbar">
        <a className="ghost-link" href="#/">
          Back to dashboard
        </a>
      </div>

      <section className="hero-card">
        <p className="eyebrow">Dashboard Block Detail</p>
        <div className="hero-header">
          <div>
            <h1>{card.label}</h1>
            <p>{card.description}</p>
          </div>
          <TypePill type={card.type} />
        </div>
        <DetailList items={summaryItems} />
      </section>

      <section className="list-card">
        <div className="list-header">
          <div>
            <h2>{card.label} Events</h2>
            <p>Open any row below to inspect the full event payload.</p>
          </div>
          <span>{events.length} matching</span>
        </div>

        {events.length === 0 ? (
          <EmptyState
            title={`No ${card.label.toLowerCase()} events yet`}
            copy="Keep the dashboard open and trigger traffic to see this page fill in live."
          />
        ) : (
          <div className="log-list">
            {events.map((event, index) => (
              <EventRow event={event} index={index} key={event.id} />
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function EventDetailPage({ event }) {
  const card = STAT_BY_TYPE[event.type] || null
  const requestItems = [
    { label: 'Event ID', value: formatValue(event.id) },
    { label: 'Timestamp', value: formatValue(formatTimestamp(event.timestamp)) },
    { label: 'Method', value: formatValue(event.details.method) },
    { label: 'Path', value: formatValue(event.details.path) },
    { label: 'Request URL', value: formatValue(event.details.rawPath) },
    { label: 'Client IP', value: formatValue(event.details.ip) },
    { label: 'Stage', value: formatValue(event.details.stage) },
    { label: 'Status Code', value: formatValue(event.details.statusCode) },
    { label: 'Upstream Status', value: formatValue(event.details.upstreamStatus) },
    { label: 'Backend URL', value: formatValue(event.details.backendUrl) },
    { label: 'Target Origin', value: formatValue(event.details.targetOrigin) },
    { label: 'Target Path', value: formatValue(event.details.targetPath) },
    { label: 'Body Size', value: event.details.bodyBytes === undefined ? null : `${event.details.bodyBytes} bytes` },
  ]
  const securityItems = [
    { label: 'Reason', value: formatValue(event.details.reason) },
    { label: 'Category', value: formatValue(event.details.category) },
    { label: 'Signal', value: formatValue(event.details.signal) },
    { label: 'Reputation Score', value: formatValue(event.details.reputation) },
    { label: 'Blacklisted', value: formatValue(event.details.blacklisted) },
    { label: 'Violation Count', value: formatValue(event.details.violationCount) },
    { label: 'Max Violations', value: formatValue(event.details.maxViolations) },
    { label: 'Violation Window', value: formatValue(formatDuration(event.details.violationWindowMs)) },
    { label: 'Configured Limit', value: formatValue(event.details.configuredLimit) },
    { label: 'Effective Limit', value: formatValue(event.details.effectiveLimit) },
    { label: 'Rate Limit Window', value: formatValue(formatDuration(event.details.windowMs)) },
    { label: 'Retry After', value: formatValue(formatDuration(event.details.retryAfterMs)) },
    { label: 'Matched Rule', value: formatValue(formatRule(event.details.matchedRule)) },
    { label: 'Queue Length', value: formatValue(event.details.queueLength) },
    { label: 'Max Queue Length', value: formatValue(event.details.maxQueueLength) },
  ]
  const headers = event.details.headers && typeof event.details.headers === 'object'
    ? Object.entries(event.details.headers)
    : []
  const queryParams = Array.isArray(event.details.queryParams) ? event.details.queryParams : []
  const remainingDetails = Object.fromEntries(
    Object.entries(event.details).filter(([key]) => !CONSUMED_DETAIL_KEYS.has(key))
  )

  return (
    <>
      <div className="page-toolbar">
        <a className="ghost-link" href="#/">
          Back to dashboard
        </a>
        {card ? (
          <a className="ghost-link" href={`#/category/${card.slug}`}>
            View all {card.label.toLowerCase()}
          </a>
        ) : null}
      </div>

      <section className="hero-card">
        <p className="eyebrow">Incident Detail</p>
        <div className="hero-header">
          <div>
            <h1>{event.type} Event</h1>
            <p>{event.message}</p>
          </div>
          <TypePill type={event.type} />
        </div>
        <p className="hero-time">{formatTimestamp(event.timestamp)}</p>
      </section>

      <section className="detail-section">
        <div className="section-header">
          <h2>Request Context</h2>
          <p>Core request metadata for this event.</p>
        </div>
        <DetailList items={requestItems} />
      </section>

      <section className="detail-section">
        <div className="section-header">
          <h2>Protection Details</h2>
          <p>Security, rate-limit, blacklist, and queue information when available.</p>
        </div>
        <DetailList items={securityItems} />
      </section>

      <section className="detail-section">
        <div className="section-header">
          <h2>Headers</h2>
          <p>Captured request headers included in the event payload.</p>
        </div>
        {headers.length === 0 ? (
          <EmptyState
            title="No headers captured"
            copy="This event did not include a request-header snapshot."
          />
        ) : (
          <div className="kv-list">
            {headers.map(([key, value]) => (
              <article className="kv-item" key={key}>
                <span>{key}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="detail-section">
        <div className="section-header">
          <h2>Query Parameters</h2>
          <p>Parsed from the request URL when a search string was present.</p>
        </div>
        {queryParams.length === 0 ? (
          <EmptyState
            title="No query parameters"
            copy="This request did not include any parsed search params."
          />
        ) : (
          <div className="kv-list">
            {queryParams.map((param, index) => (
              <article className="kv-item" key={`${param.key}-${param.value}-${index}`}>
                <span>{param.key}</span>
                <strong>{param.value || '(empty)'}</strong>
              </article>
            ))}
          </div>
        )}
      </section>

      {event.details.bodyPreview ? (
        <section className="detail-section">
          <div className="section-header">
            <h2>Body Preview</h2>
            <p>A trimmed view of the captured request body.</p>
          </div>
          <pre className="raw-block">{event.details.bodyPreview}</pre>
        </section>
      ) : null}

      {Object.keys(remainingDetails).length > 0 ? (
        <section className="detail-section">
          <div className="section-header">
            <h2>Additional Detail</h2>
            <p>Any extra structured fields that did not fit the standard sections.</p>
          </div>
          <pre className="raw-block">{JSON.stringify(remainingDetails, null, 2)}</pre>
        </section>
      ) : null}

      <section className="detail-section">
        <div className="section-header">
          <h2>Raw Event Line</h2>
          <p>The original human-readable event emitted by the backend.</p>
        </div>
        <pre className="raw-block">{event.line}</pre>
      </section>
    </>
  )
}

function MissingPage({ title, copy }) {
  return (
    <>
      <div className="page-toolbar">
        <a className="ghost-link" href="#/">
          Back to dashboard
        </a>
      </div>
      <section className="hero-card">
        <p className="eyebrow">Not Found</p>
        <h1>{title}</h1>
        <p>{copy}</p>
      </section>
    </>
  )
}

function App() {
  const [events, setEvents] = useState(loadStoredEvents)
  const [status, setStatus] = useState('Connecting')
  const route = useHashRoute()

  useEffect(() => {
    const eventSource = new EventSource(EVENTS_URL)

    eventSource.onopen = () => {
      setStatus('Live')
    }

    eventSource.onmessage = (event) => {
      const parsedEvent = parseIncomingEvent(event.data)

      if (!parsedEvent) {
        return
      }

      setEvents((previousEvents) => {
        const nextEvents = [parsedEvent, ...previousEvents.filter((item) => item.id !== parsedEvent.id)]
        return nextEvents.slice(0, MAX_EVENTS)
      })
    }

    eventSource.onerror = () => {
      setStatus('Reconnecting')
    }

    return () => {
      eventSource.close()
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events))
    } catch {
      // Ignore storage failures and keep the in-memory event stream alive.
    }
  }, [events])

  const stats = useMemo(() => buildStats(events), [events])
  const lastEvent = events[0] || EMPTY_EVENT

  let content

  if (route.name === 'category') {
    const card = STAT_BY_SLUG[route.slug]

    content = card
      ? <CategoryPage card={card} events={events.filter((event) => event.type === card.type)} />
      : (
        <MissingPage
          title="This dashboard block does not exist"
          copy="Use the dashboard cards to open one of the supported detailed pages."
        />
      )
  } else if (route.name === 'event') {
    const currentEvent = events.find((event) => event.id === route.eventId)

    content = currentEvent
      ? <EventDetailPage event={currentEvent} />
      : (
        <MissingPage
          title="This incident is no longer in the local history"
          copy="ProxyArmor keeps the latest 100 events in the browser. Return to the dashboard and reopen a recent event."
        />
      )
  } else {
    content = (
      <DashboardView
        status={status}
        stats={stats}
        events={events}
        lastEvent={lastEvent}
      />
    )
  }

  return (
    <main className="dashboard-shell">
      <section className="dashboard-panel">{content}</section>
    </main>
  )
}

export default App
