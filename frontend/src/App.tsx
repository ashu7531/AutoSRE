import { useState, useEffect, useRef } from 'react';
import { Activity, Play, CheckCircle, ShieldAlert, Terminal, FileText, AlertTriangle } from 'lucide-react';
import { marked } from 'marked';

type LogEntry = {
  id: number;
  type: 'log' | 'info' | 'alert' | 'error' | 'done' | 'report';
  message: string;
};

type Scenario = {
  id: string;
  name: string;
  description: string;
};

function App() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<string>('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [report, setReport] = useState<string | null>(null);
  const [isInvestigating, setIsInvestigating] = useState(false);
  
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('https://autosre-backend.onrender.com/api/scenarios')
      .then(res => res.json())
      .then(data => {
        setScenarios(data);
        if (data.length > 0) setSelectedScenario(data[0].id);
      })
      .catch(err => console.error("Failed to load scenarios:", err));
  }, []);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // --- NEW: LIVE WEBHOOK LISTENER ---
  useEffect(() => {
    const liveStream = new EventSource('https://autosre-backend.onrender.com/api/stream');
    let liveIdCounter = 1000; // start high so it doesn't collide with manual triggers

    liveStream.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      // Auto-clear the UI if a new webhook alert comes in
      if (data.type === 'alert' || data.message.includes("Webhook Alert")) {
        setLogs([]);
        setReport(null);
        setIsInvestigating(true);
      }

      if (data.type === 'report') {
        setReport(data.message);
      } else {
        setLogs(prev => {
          // Prevent duplicates if we just cleared the array
          if (data.message.includes("Webhook Alert") && prev.length > 0) return prev;
          return [...prev, { id: liveIdCounter++, type: data.type, message: data.message }];
        });
      }

      if (data.type === 'done' || data.type === 'error') {
        setIsInvestigating(false);
      }
    };

    return () => {
      liveStream.close();
    };
  }, []);

  const startInvestigation = () => {
    setLogs([]);
    setReport(null);
    setIsInvestigating(true);

    const eventSource = new EventSource(`https://autosre-backend.onrender.com/api/trigger?scenario=${selectedScenario}`);
    
    let idCounter = 0;

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'report') {
        setReport(data.message);
      } else {
        setLogs(prev => [...prev, { id: idCounter++, type: data.type, message: data.message }]);
      }

      if (data.type === 'done' || data.type === 'error') {
        eventSource.close();
        setIsInvestigating(false);
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE Error:", err);
      setLogs(prev => [...prev, { id: idCounter++, type: 'error', message: 'Connection to backend lost.' }]);
      eventSource.close();
      setIsInvestigating(false);
    };
  };

  return (
    <div className="dashboard">
      <header className="header">
        <div className="header-left">
          <Activity size={24} color="var(--text-primary)" />
          <h1>AutoSRE</h1>
        </div>
        <div className="badge">Internal Tooling / Agent</div>
      </header>

      <div className="panel controls">
        <div className="input-group">
          <label>Select Incident Scenario</label>
          <select 
            value={selectedScenario} 
            onChange={(e) => setSelectedScenario(e.target.value)}
            disabled={isInvestigating}
          >
            {scenarios.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} - {s.description}
              </option>
            ))}
          </select>
        </div>
        <button 
          className="btn-trigger" 
          onClick={startInvestigation}
          disabled={isInvestigating || !selectedScenario}
        >
          {isInvestigating ? (
            <><Activity className="spinner" size={16} /> Investigating...</>
          ) : (
            <><Play size={16} /> Trigger Incident</>
          )}
        </button>
      </div>

      <div className="main-content">
        {/* Terminal Window */}
        <div className="terminal-window">
          <div className="terminal-header">
            <Terminal size={14} style={{marginRight: '6px'}} /> Execution Logs
          </div>
          <div className="terminal-body">
            <div className="log-entry log-info">System idle. Ready for alerts.</div>
            {logs.map((log) => (
              <div key={log.id} className={`log-entry log-${log.type}`}>
                {log.type === 'alert' && <ShieldAlert size={14} style={{verticalAlign: 'text-bottom', marginRight: '6px', color: 'var(--error)'}}/>}
                {log.type === 'error' && <AlertTriangle size={14} style={{verticalAlign: 'text-bottom', marginRight: '6px', color: 'var(--error)'}}/>}
                {log.type === 'done' && <CheckCircle size={14} style={{verticalAlign: 'text-bottom', marginRight: '6px', color: 'var(--success)'}}/>}
                {log.message}
              </div>
            ))}
            <div ref={terminalEndRef} />
          </div>
        </div>

        {/* RCA Report Window */}
        <div className="panel report-panel">
          <h2><FileText size={14} style={{verticalAlign: 'text-bottom', marginRight: '6px'}} /> Root Cause Analysis</h2>
          <div className="report-content">
            {report ? (
              <div dangerouslySetInnerHTML={{ __html: marked(report) }} />
            ) : isInvestigating ? (
              <div className="empty-state">
                <Activity className="spinner" size={24} style={{marginBottom: '1rem', color: 'var(--text-secondary)'}} />
                <p>Agent is analyzing infrastructure data...</p>
              </div>
            ) : (
              <div className="empty-state">
                <p>No active incidents.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
