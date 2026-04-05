import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import './App.css';

const App = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [stats, setStats] = useState({ rps: 0, totalBlocked: 0, totalForwarded: 0 });
  const [chartData, setChartData] = useState([]);
  const [blockedFeed, setBlockedFeed] = useState([]);
  const [wsStatus, setWsStatus] = useState('Disconnected');
  const [targetIP, setTargetIP] = useState('');
  const [commandMsg, setCommandMsg] = useState('');
  const ws = useRef(null);

  const handleLogin = (e) => {
    e.preventDefault();
    if (username === 'ITAdmin') setIsLoggedIn(true);
  };

  useEffect(() => {
    if (!isLoggedIn) return;

    // 1. SSE Connection for Live Data
    const eventSource = new EventSource('http://localhost:9090/events');
    
    eventSource.onmessage = (e) => {
      const event = JSON.parse(e.data);
      
      if (event.type === 'stats') {
        // reason field contains our JSON stats string from Go
        const payload = JSON.parse(event.reason);
        setStats(prev => ({ 
          ...prev, 
          rps: payload.rps, 
          totalBlocked: payload.totalBlocked 
        }));
        
        setChartData(prev => [
          ...prev.slice(-29), 
          { time: new Date().toLocaleTimeString().split(' ')[0], rps: payload.rps }
        ]);
      } else if (event.decision === 'forwarded') {
        setStats(prev => ({ ...prev, totalForwarded: prev.totalForwarded + 1 }));
      } else {
        // It's a security event (blocked/waf/rate_limit)
        setBlockedFeed(prev => [{ ...event, id: Date.now() }, ...prev.slice(0, 49)]);
      }
    };

    // 2. WebSocket Connection for Commands
    ws.current = new WebSocket('ws://localhost:9090/ws');
    ws.current.onopen = () => setWsStatus('Connected');
    ws.current.onclose = () => setWsStatus('Disconnected');
    ws.current.onmessage = (e) => {
      const res = JSON.parse(e.data);
      setCommandMsg(res.message);
      setTimeout(() => setCommandMsg(''), 4000);
    };

    return () => {
      eventSource.close();
      ws.current?.close();
    };
  }, [isLoggedIn]);

  const sendCommand = (action) => {
    if (ws.current?.readyState === WebSocket.OPEN && targetIP) {
      ws.current.send(JSON.stringify({ action, ip: targetIP }));
      setTargetIP('');
    }
  };

  if (!isLoggedIn) {
    return (
      <div style={styles.loginContainer}>
        <form onSubmit={handleLogin} style={styles.loginCard}>
          <h2 style={{ color: '#61dafb', marginBottom: '20px' }}>ProxyArmor Login</h2>
          <input 
            type="text" placeholder="Username" value={username}
            onChange={(e) => setUsername(e.target.value)} style={styles.input}
          />
          <button type="submit" style={styles.button}>Enter Dashboard</button>
          <p style={{ fontSize: '12px', marginTop: '10px', color: '#888' }}>Hint: Use ITAdmin</p>
        </form>
      </div>
    );
  }

  return (
    <div style={styles.dashboard}>
      <header style={styles.header}>
        <h1 style={{ color: '#61dafb' }}>ProxyArmor Security Console</h1>
        <div style={{ display: 'flex', gap: '20px' }}>
          <div style={styles.statBox}>RPS: <span style={{ color: '#61dafb' }}>{stats.rps}</span></div>
          <div style={styles.statBox}>Blocked: <span style={{ color: '#ff4d4d' }}>{stats.totalBlocked}</span></div>
          <div style={styles.statBox}>Forwarded: <span style={{ color: '#4caf50' }}>{stats.totalForwarded}</span></div>
          <div style={{ ...styles.statBox, color: wsStatus === 'Connected' ? '#4caf50' : '#ff4d4d' }}>● {wsStatus}</div>
        </div>
      </header>

      <div style={styles.grid}>
        <div style={styles.card}>
          <h3>Traffic Flow (Requests Per Second)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#444" />
              <XAxis dataKey="time" stroke="#888" fontSize={10} />
              <YAxis stroke="#888" />
              <Tooltip contentStyle={{ backgroundColor: '#222', border: 'none' }} />
              <Line type="monotone" dataKey="rps" stroke="#61dafb" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={styles.card}>
          <h3>Interactive Firewall Control</h3>
          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <input 
              type="text" placeholder="Target IP (e.g. 127.0.0.1)" value={targetIP}
              onChange={(e) => setTargetIP(e.target.value)} style={styles.input}
            />
            <button onClick={() => sendCommand('block_ip')} style={{ ...styles.button, backgroundColor: '#ff4d4d', color: 'white' }}>Block IP</button>
            <button onClick={() => sendCommand('unblock_ip')} style={{ ...styles.button, backgroundColor: '#444', color: 'white' }}>Allow IP</button>
          </div>
          {commandMsg && <p style={{ color: '#61dafb', marginTop: '10px' }}>{commandMsg}</p>}
        </div>

        <div style={{ ...styles.card, gridColumn: 'span 2' }}>
          <h3>Security Event Feed (Live)</h3>
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr style={{ color: '#888', textAlign: 'left', borderBottom: '2px solid #333' }}>
                  <th style={{ padding: '10px' }}>Time</th>
                  <th style={{ padding: '10px' }}>IP Address</th>
                  <th style={{ padding: '10px' }}>Method</th>
                  <th style={{ padding: '10px' }}>Path</th>
                  <th style={{ padding: '10px' }}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {blockedFeed.map(event => (
                  <tr key={event.id} style={{ borderBottom: '1px solid #333', color: event.decision === 'waf_blocked' ? '#ff4d4d' : event.decision === 'rate_limited' ? '#ffa500' : '#aaa' }}>
                    <td style={{ padding: '10px' }}>{new Date(event.timestamp).toLocaleTimeString()}</td>
                    <td style={{ padding: '10px' }}>{event.ip}</td>
                    <td style={{ padding: '10px' }}>{event.method}</td>
                    <td style={{ padding: '10px' }}>{event.path}</td>
                    <td style={{ padding: '10px' }}>{event.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  loginContainer: { height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212', color: 'white', fontFamily: "'Inter', sans-serif" },
  loginCard: { backgroundColor: '#1e1e1e', padding: '40px', borderRadius: '12px', textAlign: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', width: '350px' },
  dashboard: { minHeight: '100vh', backgroundColor: '#0f0f0f', color: 'white', padding: '20px', fontFamily: "'Inter', sans-serif" },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', borderBottom: '1px solid #333', paddingBottom: '10px' },
  statBox: { backgroundColor: '#1e1e1e', padding: '10px 20px', borderRadius: '8px', fontWeight: 'bold', fontSize: '14px' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' },
  card: { backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' },
  input: { flex: 1, padding: '12px', borderRadius: '6px', border: '1px solid #444', backgroundColor: '#121212', color: 'white' },
  button: { padding: '12px 24px', borderRadius: '6px', border: 'none', backgroundColor: '#61dafb', color: 'black', fontWeight: 'bold', cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: '10px', fontSize: '13px' }
};

export default App;