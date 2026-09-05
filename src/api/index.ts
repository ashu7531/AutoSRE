import express from "express";
import cors from "cors";
import * as fs from "fs";
import * as path from "path";
import { runAgent } from "../agent/index.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;

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

app.listen(PORT, () => {
  console.log(`AutoSRE Backend running on http://localhost:${PORT}`);
});
