import express from "express";
import cors from "cors";
import * as fs from "fs";
import * as path from "path";
import { runAgent } from "../agent/index.js";
import { initMemoryDB, getClient } from "../agent/memory.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;

// Global list to hold connected browsers listening for live updates
let sseClients: express.Response[] = [];

app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  sseClients.push(res);
  req.on("close", () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

app.get("/api/scenarios", (req, res) => {
  const scenariosDir = path.join(__dirname, "../scenarios");
  const files = fs.readdirSync(scenariosDir).filter(f => f.endsWith(".json") && f !== "active.json");
  const scenarios = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(scenariosDir, f), "utf8"));
    return { id: f.replace(".json", ""), name: data.scenario_name, description: data.description };
  });
  res.json(scenarios);
});

app.get("/api/trigger", async (req, res) => {
  const scenarioId = req.query.scenario as string;
  
  if (scenarioId) {
    // Copy the selected scenario to active.json
    const source = path.join(__dirname, `../scenarios/${scenarioId}.json`);
    const dest = path.join(__dirname, "../scenarios/active.json");
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, dest);
    }
  }

  // Setup SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent({ type: "info", message: "Starting Investigation..." });

  try {
    await runAgent(sendEvent);
    sendEvent({ type: "done", message: "Investigation Complete." });
  } catch (err: any) {
    sendEvent({ type: "error", message: err.message || "An error occurred." });
  } finally {
    res.end();
  }
});

// --- NEW: SENTRY WEBHOOK (Auto-Trigger) ---
app.post("/api/webhook/sentry", async (req, res) => {
  console.log("🔔 Sentry Webhook Received! Auto-triggering RCA Pipeline...");
  
  res.status(202).json({ message: "Incident response triggered" });

  // Broadcast the events to any browser that has the UI open!
  const broadcastEvent = (data: any) => {
    console.log(`[AutoSRE background]: ${data.message}`);
    sseClients.forEach(client => client.write(`data: ${JSON.stringify(data)}\n\n`));
  };

  try {
    broadcastEvent({ type: "info", message: "🔔 Webhook Alert Received from Sentry!" });
    broadcastEvent({ type: "info", message: "Starting Autonomous Investigation..." });
    await runAgent(broadcastEvent);
    broadcastEvent({ type: "done", message: "Autonomous Investigation Complete." });
  } catch (err: any) {
    console.error("AutoSRE background task failed:", err);
    broadcastEvent({ type: "error", message: err.message || "An error occurred." });
  }
});

// --- NEW: HISTORY ENDPOINT (To view auto-generated RCAs) ---
app.get("/api/history", async (req, res) => {
  try {
    const client = getClient();
    const result = await client.query('SELECT id, issue, resolution FROM incident_memory ORDER BY id DESC LIMIT 10');
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Initialize database then start server
initMemoryDB().then(() => {
  app.listen(PORT, () => {
    console.log(`AutoSRE Backend running on http://localhost:${PORT}`);
  });
});
