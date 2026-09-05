# AutoSRE - Autonomous Incident Response Agent

AutoSRE is an autonomous AI agent designed to investigate, analyze, and resolve infrastructure incidents in real-time. It acts as a Level 1 SRE (Site Reliability Engineer), instantly correlating logs, metrics, deployments, and past incidents to generate Root Cause Analysis (RCA) reports.

## Architecture

This project is built using a decoupled architecture powered by the **Model Context Protocol (MCP)**.
- **The Brain (Agent):** Orchestrates the investigation using Google Gemini 3.6 Flash.
- **The Hands (MCP Server):** A local server that interfaces with external tools (GitHub, Datadog/Metrics, Logs) to fetch deterministic context for the LLM.

### The Pipeline
1. **Validation Gate (Guardrail):** Before starting an expensive investigation, the AI analyzes the metrics against historical baselines to detect and suppress false alarms (e.g., noisy cron jobs).
2. **Parallel Collectors:** The Agent dispatches concurrent `Promise.all` requests to the MCP server to fetch Logs, Metrics, Commits, and Dependency Health simultaneously.
3. **Incident Memory (Vector RAG):** The Agent queries a dynamic memory database to see if similar outages have occurred in the past, injecting past solutions into its current context.
4. **LLM Cross-Correlation:** Gemini analyzes the collected evidence and streams a real-time Markdown RCA report to the frontend via Server-Sent Events (SSE).

## Demo Limitations vs. Production Roadmap

This repository is currently configured as a Proof of Concept (PoC) for reliable demonstrations. If upgrading to a true production environment, the following architectural changes must be made:

### 1. GitHub Commits vs. Code Diffs
- **Current (Demo):** The MCP Server connects to the real GitHub REST API but only fetches the **Commit Messages**. 
- **Production Limitation:** Developers often write inaccurate or completely unrelated commit messages. If a developer fixes a CSS button but writes "Update database port", the AI will hallucinate and falsely blame them for a database crash.
- **Production Solution:** Upgrade the GitHub MCP tool to fetch the actual **Code Diffs** (the exact lines of code changed) using the GitHub Compare API. This allows the LLM to verify if the code changes actually caused the outage, rather than relying on human text.

### 2. Mock Infrastructure vs. Real Observability
- **Current (Demo):** To prevent the need for expensive Datadog/Coralogix subscriptions during demos, the logs and metrics are read from localized JSON `scenario` files.
- **Production Solution:** Because the project uses the MCP architecture, the Agent code requires zero changes. The MCP Server simply needs to be updated to make HTTP `fetch` calls to the Datadog or Prometheus APIs instead of reading local JSON.

### 3. In-Memory RAG vs. Persistent Vector DB
- **Current (Demo):** The Incident Memory (RAG) uses an in-memory array and a localized Jaccard/Token similarity engine. It successfully stores new RCA reports dynamically, but the memory resets when the Node.js server restarts.
- **Production Solution:** Replace the in-memory array with a PostgreSQL database equipped with the `pgvector` extension (e.g., Supabase). Implement a 30-day Time-To-Live (TTL) on vector embeddings to prevent RAG poisoning from outdated system architectures.

## Getting Started

1. Clone the repository and run `npm install` in both the root and `frontend/` directories.
2. Create a `.env` file in the root directory:
   ```env
   GEMINI_API_KEY=your_gemini_key
   GITHUB_TOKEN=your_github_pat_with_repo_access
   ```
3. Start the server:
```bash
npm run dev
```

## 🚀 Live Demonstration (Auto-Triggered RCA)

Instead of using mock scenarios, this project is wired into a live production environment!

1. Open the **AutoSRE Dashboard** in your browser and leave the tab open:
   [https://auto-sre-omega.vercel.app/](https://auto-sre-omega.vercel.app/)
2. In a separate tab, trigger a real production crash by hitting this URL:
   [https://cascade-backend-sgi5.onrender.com/sentry-debug](https://cascade-backend-sgi5.onrender.com/sentry-debug)
3. Sentry will instantly catch the `ZeroDivisionError`, fire a webhook to AutoSRE, and the AutoSRE UI will magically start streaming the autonomous investigation in real-time!

> **Note:** The AI Agent pulls live crash data from the Sentry API and live commit history from the `agentic-workflow-compiler` GitHub repository to determine root cause.
4. Start the frontend: `cd frontend && npm run dev`
5. Navigate to `http://localhost:5174` and trigger an incident.
