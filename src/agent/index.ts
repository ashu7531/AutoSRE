import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import * as path from "path";
import { searchIncidentMemory, addIncidentToMemory } from "./memory.js";

dotenv.config();

const ai = new GoogleGenAI({});

export async function runAgent(sendEvent: (data: any) => void) {
  sendEvent({ type: "log", message: "🛡️ Sentinel Agent Starting..." });

  // 1. Connect to our Mock MCP Server
  const serverPath = path.join(__dirname, "../mcp-server/index.ts");
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", serverPath],
  });

  const client = new Client(
    { name: "auto-sre-agent", version: "1.0.0" },
    { capabilities: {} }
  );

  sendEvent({ type: "log", message: "🔌 Connecting to Infrastructure MCP Server..." });
  await client.connect(transport);
  
  // 2. Fetch Tools
  const toolsResponse = await client.listTools();
  sendEvent({ type: "log", message: `🛠️ Discovered ${toolsResponse.tools.length} tools.` });

  const serviceName = "payment-api";

  sendEvent({ type: "alert", message: `🚨 Alert Triggered for ${serviceName}` });
  sendEvent({ type: "log", message: "🛡️ Phase 1: AI Validation Gate (Guardrail)..." });

  // --- NEW: GUARDRAIL PHASE ---
  // Fetch ONLY metrics first to see if this is worth investigating
  const metrics = await client.callTool({ name: "get_system_metrics", arguments: { serviceName } });
  
  const guardrailPrompt = `
    You are an SRE Guardrail Agent. Your job is to prevent alert fatigue.
    Look at the following metrics and determine if this is a real incident or a false alarm (e.g., a known daily cron job).
    
    Metrics: ${JSON.stringify(metrics.content)}
    
    You MUST respond in strict JSON format:
    {
      "is_real_anomaly": true or false,
      "reason": "Brief explanation"
    }
  `;

  try {
    const guardrailResponse = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: guardrailPrompt,
      config: {
          responseMimeType: "application/json",
      }
    });

    const guardrailDecision = JSON.parse(guardrailResponse.text || "{}");
    
    if (!guardrailDecision.is_real_anomaly) {
      sendEvent({ type: "done", message: `🛑 Alert Suppressed: ${guardrailDecision.reason}` });
      await transport.close();
      return; // Stop the investigation!
    }

    sendEvent({ type: "log", message: `✅ Validation Passed: ${guardrailDecision.reason}` });

  } catch (error) {
    sendEvent({ type: "log", message: "⚠️ Guardrail failed to parse, proceeding with investigation as a precaution." });
  }
  // --- END GUARDRAIL PHASE ---

  sendEvent({ type: "log", message: "🔄 Phase 2: Dispatching Parallel Collectors..." });

  // 3. Parallel Evidence Collection (The core SRE pattern)
  // We already have metrics, so we only fetch logs, commits, and dependencies
  const [logs, commits, dependencies] = await Promise.all([
    client.callTool({ name: "fetch_sentry_issues", arguments: {} }),
    client.callTool({ name: "get_recent_commits", arguments: { repoName: serviceName } }),
    client.callTool({ name: "get_dependency_health", arguments: { serviceName } })
  ]);

  sendEvent({ type: "log", message: "✅ Evidence Collected." });

  // 4. Incident Memory (Vector RAG)
  sendEvent({ type: "log", message: "📚 Phase 3: Querying Incident Memory (Vector Search)..." });
  
  // Create a summary of the current error to search the database
  const searchString = JSON.stringify(logs.content) + JSON.stringify(metrics.content);
  const pastIncident = await searchIncidentMemory(searchString);
  
  if (pastIncident) {
    sendEvent({ type: "info", message: `💡 Memory Match Found: ${pastIncident.incidentId} (${pastIncident.confidence_score} similarity)` });
  } else {
    sendEvent({ type: "info", message: "⚪ No similar past incidents found." });
  }

  // 5. LLM Analysis
  sendEvent({ type: "log", message: "🧠 Phase 4: LLM Cross-Correlation Analysis..." });
  
  const prompt = `
    You are an autonomous SRE incident response agent.
    Analyze the following evidence collected from our infrastructure tools and determine the root cause of the incident.
    
    Evidence:
    Metrics: ${JSON.stringify(metrics.content)}
    Logs: ${JSON.stringify(logs.content)}
    Commits: ${JSON.stringify(commits.content)}
    Dependencies: ${JSON.stringify(dependencies.content)}
    
    Past Incident Context (If any):
    ${pastIncident ? JSON.stringify(pastIncident) : "No similar past incidents."}
    
    Provide a Root Cause Analysis report with:
    1. Root Cause Summary (Be extremely concise)
    2. Timeline
    3. Recommended Remediation (Use the Past Incident Context if it is relevant to the current problem)
    
    Format the response in Markdown.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt,
    });
    
    sendEvent({ type: "report", message: response.text });

    // --- NEW: RAG FEEDBACK LOOP ---
    // In production this would happen when a human clicks "Resolve".
    // For this demo, we auto-save the incident into the memory database.
    const newIncId = `INC-${Math.floor(100 + Math.random() * 900)}`;
    const issueSummary = JSON.stringify(logs.content) + " " + JSON.stringify(metrics.content);
    addIncidentToMemory(newIncId, issueSummary, response.text || "Resolved.");
    sendEvent({ type: "info", message: `💾 Saved current incident to RAG database as ${newIncId}.` });
    // ------------------------------

  } catch (error: any) {
    if (error.status === 400 || error.message?.includes("API key")) {
       sendEvent({ type: "error", message: "LLM Analysis failed: Missing or invalid GEMINI_API_KEY. Add it to your .env file." });
    } else {
       sendEvent({ type: "error", message: `LLM Error: ${error.message}` });
    }
  }

  // Cleanup
  await transport.close();
}
