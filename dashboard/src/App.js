import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  LineChart, Line, PieChart, Pie, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import './App.css';

const App = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  
  // Stats state
  const [stats, setStats] = useState({
    rps: 0,
    totalRequests: 0,
    totalBlocked: 0,
    totalForwarded: 0,
    blockedRate: 0,
  });

  // Chart data
  const [rpsHistory, setRpsHistory] = useState([]);
  const [blockedByType, setBlockedByType] = useState({});
  const [topIPs, setTopIPs] = useState({});
  const [topEndpoints, setTopEndpoints] = useState({});
  const [eventFeed, setEventFeed] = useState([]);
  
  // UI state
  const [wsStatus, setWsStatus] = useState('Disconnected');
  const [targetIP, setTargetIP] = useState('');
  const [commandMsg, setCommandMsg] = useState('');
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  
  const ws = useRef(null);
  const eventSource = useRef(null);

  const handleLogin = useCallback((e) => {
    e.preventDefault();
    if (username === 'ITAdmin') {
      setIsLoggedIn(true);
    }
  }, [username]);

  useEffect(() => {
    if (!isLoggedIn) return;

    // SSE Connection for Live Data
    eventSource.current = new EventSource('http://localhost:9090/events');
    
    eventSource.current.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);

        // Handle Stats Event
        if (data.type === 'stats') {
          setStats({
            rps: data.rps || 0,
            totalRequests: data.totalRequests || 0,
            totalBlocked: data.totalBlocked || 0,
            totalForwarded: data.totalForwarded || 0,
            blockedRate: data.blockedRate ? data.blockedRate.toFixed(2) : 0,
          });

          // Update RPS chart
          setRpsHistory(prev => {
            const newData = [
              ...prev,
              {
                time: new Date(data.timestamp).toLocaleTimeString(),
                rps: data.rps,
              }
            ];
            return newData.slice(-30);
          });

          // Update blocked by type
          if (data.blockedByType) {
            setBlockedByType(data.blockedByType);
          }

          // Update top IPs
          if (data.topIPs) {
            setTopIPs(data.topIPs);
          }

          // Update top endpoints
          if (data.topEndpoints) {
            setTopEndpoints(data.topEndpoints);
          }
        }
        // Handle individual security events
        else if (data.type === 'event') {
          setEventFeed(prev => {
            const newEvent = {
              id: Date.now(),
              ...data,
            };
            return [newEvent, ...prev.slice(0, 49)];
          });
        }
      } catch (err) {
        console.error("Dashboard Parsing Error:", err, "Raw Data:", e.data);
      }
    };

    eventSource.current.onerror = () => {
      console.error("SSE Connection lost");
      eventSource.current?.close();
    };

    // WebSocket Connection for Commands
    ws.current = new WebSocket('ws://localhost:9090/ws');
    ws.current.onopen = () => setWsStatus('Connected');
    ws.current.onclose = () => setWsStatus('Disconnected');
    ws.current.onmessage = (e) => {
      try {
        const res = JSON.parse(e.data);
        setCommandMsg(res.message);
        setTimeout(() => setCommandMsg(''), 4000);
      } catch (err) {
        console.error("WS Parsing Error:", err);
      }
    };

    return () => {
      eventSource.current?.close();
      ws.current?.close();
    };
  }, [isLoggedIn]);

  const sendCommand = useCallback((action) => {
    if (ws.current?.readyState === WebSocket.OPEN && targetIP) {
      ws.current.send(JSON.stringify({ action, ip: targetIP }));
      setTargetIP('');
    }
  }, [targetIP]);

  // Filter and search events
  const filteredEvents = eventFeed.filter(event => {
    const matchesFilter = filter === 'all' || event.decision === filter;
    const matchesSearch =
      event.ip?.includes(searchTerm) ||
      event.path?.includes(searchTerm) ||
      event.reason?.includes(searchTerm);
    return matchesFilter && matchesSearch;
  });

  // Chart data transformations
  const blockedTypeData = Object.entries(blockedByType).map(([key, value]) => ({
    name: key,
    value: value,
  }));

  const topIPsData = Object.entries(topIPs).map(([ip, count]) => ({
    name: ip,
    requests: count,
  }));

  const topEndpointsData = Object.entries(topEndpoints).map(([endpoint, count]) => ({
    name: endpoint,
    requests: count,
  }));

  const COLORS = ['#FF4D4D', '#FFA500', '#FFD700', '#4CAF50', '#2196F3', '#9C27B0'];

  if (!isLoggedIn) {
    return (
      <div style={styles.loginContainer}>
        <form onSubmit={handleLogin} style={styles.loginCard}>
          <h2 style={styles.loginTitle}>🛡️ ProxyArmor Security Console</h2>
          <p style={styles.loginSubtitle}>Advanced Reverse Proxy & API Gateway</p>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={styles.input}
            autoFocus
          />
          <button type="submit" style={styles.button}>
            Enter Dashboard
          </button>
          <p style={styles.hint}>Demo: Use username "ITAdmin"</p>
        </form>
      </div>
    );
  }

  return (
    <div style={styles.dashboard}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>🛡️ ProxyArmor Security Console</h1>
          <p style={styles.subtitle}>Real-time reverse proxy and security monitoring</p>
        </div>
        <div style={styles.wsIndicator}>
          <span
            style={{
              ...styles.statusDot,
              backgroundColor: wsStatus === 'Connected' ? '#4CAF50' : '#FF4D4D',
            }}
          />
          <span style={{ color: '#888' }}>{wsStatus}</span>
        </div>
      </header>

      {/* Stats Cards */}
      <div style={styles.statsGrid}>
        <StatCard
          label="Average RPS"
          value={stats.rps}
          unit="req/s"
          color="#61DAFB"
          icon="⚡"
        />
        <StatCard
          label="Total Requests"
          value={stats.totalRequests}
          unit=""
          color="#4CAF50"
          icon="📊"
        />
        <StatCard
          label="Blocked Requests"
          value={stats.totalBlocked}
          unit=""
          color="#FF4D4D"
          icon="🚫"
        />
        <StatCard
          label="Forwarded Requests"
          value={stats.totalForwarded}
          unit=""
          color="#2196F3"
          icon="✅"
        />
        <StatCard
          label="Block Rate"
          value={stats.blockedRate}
          unit="%"
          color="#FFA500"
          icon="📈"
        />
      </div>

      {/* Charts Section */}
      <div style={styles.chartsGrid}>
        {/* RPS Chart */}
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Requests Per Second (RPS)</h3>
          {rpsHistory.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={rpsHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="time" stroke="#888" fontSize={10} height={40} />
                <YAxis stroke="#888" fontSize={10} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e1e1e', border: '1px solid #333' }}
                  formatter={(v) => [v, 'RPS']}
                />
                <Line
                  type="monotone"
                  dataKey="rps"
                  stroke="#61DAFB"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={styles.noData}>Waiting for data...</div>
          )}
        </div>

        {/* Blocked by Type Pie Chart */}
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Blocked Requests by Type</h3>
          {blockedTypeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={blockedTypeData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {blockedTypeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [v, 'Count']} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={styles.noData}>No blocked requests yet</div>
          )}
        </div>

        {/* Top IPs Chart */}
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Top Source IPs</h3>
          {topIPsData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topIPsData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="name" stroke="#888" fontSize={10} />
                <YAxis stroke="#888" fontSize={10} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e1e1e', border: '1px solid #333' }}
                  formatter={(v) => [v, 'Requests']}
                />
                <Bar dataKey="requests" fill="#FF6B6B" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={styles.noData}>No data available</div>
          )}
        </div>

        {/* Top Endpoints Chart */}
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Top Endpoints</h3>
          {topEndpointsData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topEndpointsData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis type="number" stroke="#888" fontSize={10} />
                <YAxis dataKey="name" type="category" stroke="#888" fontSize={10} width={100} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e1e1e', border: '1px solid #333' }}
                  formatter={(v) => [v, 'Requests']}
                />
                <Bar dataKey="requests" fill="#4ECDC4" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={styles.noData}>No data available</div>
          )}
        </div>
      </div>

      {/* Control & Event Feed */}
      <div style={styles.controlSection}>
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>🔒 Firewall Control</h3>
          <div style={styles.controlPanel}>
            <input
              type="text"
              placeholder="Target IP (e.g., 192.168.1.1)"
              value={targetIP}
              onChange={(e) => setTargetIP(e.target.value)}
              style={styles.input}
            />
            <button
              onClick={() => sendCommand('block_ip')}
              style={{ ...styles.button, backgroundColor: '#FF4D4D' }}
            >
              ⛔ Block IP
            </button>
            <button
              onClick={() => sendCommand('unblock_ip')}
              style={{ ...styles.button, backgroundColor: '#4CAF50' }}
            >
              ✅ Allow IP
            </button>
          </div>
          {commandMsg && (
            <div style={styles.successMessage}>{commandMsg}</div>
          )}
        </div>

        <div style={{ ...styles.card, gridColumn: 'span 2' }}>
          <h3 style={styles.cardTitle}>📋 Security Event Feed (Last 100)</h3>
          <div style={styles.filterBar}>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={styles.select}
            >
              <option value="all">All Events</option>
              <option value="waf_blocked">WAF Blocked</option>
              <option value="rate_limited">Rate Limited</option>
              <option value="blacklist_blocked">Blacklisted</option>
            </select>
            <input
              type="text"
              placeholder="Search IP, endpoint, or reason..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ ...styles.input, flex: 1 }}
            />
          </div>
          <div style={styles.eventTable}>
            {filteredEvents.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={styles.tableHeader}>
                    <th style={styles.tableCell}>Time</th>
                    <th style={styles.tableCell}>IP</th>
                    <th style={styles.tableCell}>Method</th>
                    <th style={styles.tableCell}>Path</th>
                    <th style={styles.tableCell}>Reason</th>
                    <th style={styles.tableCell}>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map(event => (
                    <tr
                      key={event.id}
                      style={{
                        ...styles.tableRow,
                        backgroundColor: getRowColor(event.decision),
                      }}
                    >
                      <td style={styles.tableCell}>
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </td>
                      <td style={styles.tableCell}>{event.ip}</td>
                      <td style={styles.tableCell}>{event.method}</td>
                      <td style={styles.tableCell}>{event.path}</td>
                      <td style={styles.tableCell}>{event.reason}</td>
                      <td style={styles.tableCell}>
                        <span style={getDecisionBadge(event.decision)}>
                          {event.decision}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={styles.noData}>No events match your filters</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper Components
const StatCard = ({ label, value, unit, color, icon }) => (
  <div style={{ ...styles.statCard, borderLeftColor: color }}>
    <div style={styles.statIcon}>{icon}</div>
    <div>
      <p style={styles.statLabel}>{label}</p>
      <p style={{ ...styles.statValue, color }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
        <span style={styles.statUnit}> {unit}</span>
      </p>
    </div>
  </div>
);

// Helper Functions
const getRowColor = (decision) => {
  switch (decision) {
    case 'waf_blocked':
      return '#2a1a1a';
    case 'rate_limited':
      return '#2a2215';
    case 'blacklist_blocked':
      return '#1a2a2a';
    default:
      return 'transparent';
  }
};

const getDecisionBadge = (decision) => {
  const baseStyle = {
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 'bold',
    display: 'inline-block',
  };

  switch (decision) {
    case 'waf_blocked':
      return { ...baseStyle, backgroundColor: '#FF4D4D', color: 'white' };
    case 'rate_limited':
      return { ...baseStyle, backgroundColor: '#FFA500', color: 'white' };
    case 'blacklist_blocked':
      return { ...baseStyle, backgroundColor: '#2196F3', color: 'white' };
    default:
      return { ...baseStyle, backgroundColor: '#4CAF50', color: 'white' };
  }
};

// Styles
const styles = {
  dashboard: {
    minHeight: '100vh',
    backgroundColor: '#0f0f0f',
    color: '#fff',
    padding: '20px',
    fontFamily: "'Segoe UI', 'Inter', sans-serif",
  },
  loginContainer: {
    height: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f0f0f',
    backgroundImage:
      'radial-gradient(at 20% 50%, rgba(97, 218, 251, 0.1) 0px, transparent 50%), ' +
      'radial-gradient(at 80% 80%, rgba(255, 77, 77, 0.1) 0px, transparent 50%)',
  },
  loginCard: {
    backgroundColor: '#1e1e1e',
    padding: '50px',
    borderRadius: '12px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)',
    width: '400px',
    border: '1px solid #333',
  },
  loginTitle: {
    color: '#61DAFB',
    marginBottom: '10px',
    fontSize: '28px',
  },
  loginSubtitle: {
    color: '#888',
    marginBottom: '30px',
    fontSize: '14px',
  },
  hint: {
    fontSize: '12px',
    marginTop: '15px',
    color: '#666',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '30px',
    borderBottom: '1px solid #333',
    paddingBottom: '20px',
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    color: '#61DAFB',
    marginBottom: '5px',
    fontSize: '32px',
  },
  subtitle: {
    color: '#888',
    fontSize: '14px',
  },
  wsIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: '#1e1e1e',
    padding: '10px 15px',
    borderRadius: '8px',
  },
  statusDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '15px',
    marginBottom: '30px',
  },
  statCard: {
    backgroundColor: '#1e1e1e',
    padding: '20px',
    borderRadius: '8px',
    borderLeft: '4px solid',
    display: 'flex',
    gap: '15px',
    alignItems: 'flex-start',
  },
  statIcon: {
    fontSize: '28px',
  },
  statLabel: {
    fontSize: '12px',
    color: '#888',
    margin: '0 0 8px 0',
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    margin: 0,
  },
  statUnit: {
    fontSize: '14px',
    fontWeight: 'normal',
  },
  chartsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '20px',
    marginBottom: '30px',
  },
  card: {
    backgroundColor: '#1e1e1e',
    padding: '20px',
    borderRadius: '8px',
    border: '1px solid #333',
  },
  cardTitle: {
    color: '#61DAFB',
    marginBottom: '15px',
    fontSize: '16px',
    fontWeight: '600',
  },
  noData: {
    textAlign: 'center',
    color: '#666',
    padding: '40px 20px',
    fontSize: '14px',
  },
  controlSection: {
    display: 'grid',
    gridTemplateColumns: '1fr 2fr',
    gap: '20px',
  },
  controlPanel: {
    display: 'flex',
    gap: '10px',
    flexDirection: 'column',
  },
  input: {
    padding: '10px 15px',
    borderRadius: '6px',
    border: '1px solid #333',
    backgroundColor: '#121212',
    color: '#fff',
    fontSize: '13px',
  },
  button: {
    padding: '10px 20px',
    borderRadius: '6px',
    border: 'none',
    color: '#fff',
    fontWeight: '600',
    cursor: 'pointer',
    fontSize: '13px',
    transition: 'opacity 0.2s',
  },
  successMessage: {
    backgroundColor: '#1a3a1a',
    color: '#4CAF50',
    padding: '10px 15px',
    borderRadius: '6px',
    marginTop: '10px',
    fontSize: '13px',
    border: '1px solid #2a5a2a',
  },
  filterBar: {
    display: 'flex',
    gap: '10px',
    marginBottom: '15px',
  },
  select: {
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #333',
    backgroundColor: '#121212',
    color: '#fff',
    fontSize: '13px',
    cursor: 'pointer',
  },
  eventTable: {
    maxHeight: '400px',
    overflowY: 'auto',
    borderRadius: '6px',
    border: '1px solid #333',
  },
  tableHeader: {
    backgroundColor: '#0f0f0f',
    borderBottom: '2px solid #333',
    position: 'sticky',
    top: 0,
  },
  tableRow: {
    borderBottom: '1px solid #333',
    transition: 'background-color 0.2s',
  },
  tableCell: {
    padding: '12px 15px',
    fontSize: '12px',
    textAlign: 'left',
  },
};

export default App;