# 🧠 AutoSRE: System Architecture & Workflow Walkthrough

This document explains the end-to-end architecture of **AutoSRE**, an autonomous Site Reliability Engineering (SRE) agent. It outlines the complete workflow from incident detection to autonomous root cause analysis.

---

## 📖 The Story of an Outage (End-to-End Flow)

Imagine it is 3:00 AM. A junior developer working on your company's main product backend, the `agentic-workflow-compiler`, accidentally pushes a bad commit to production. 

Here is exactly what happens next, entirely autonomously, without a single human touching the keyboard.

### Step 1: The Production Crash
A user visits the `agentic-workflow-compiler` application and triggers the bad code. The Python FastAPI server hits a fatal error (e.g., `ZeroDivisionError`) and crashes, returning an HTTP 500 to the user.

### Step 2: The Sentry Observer
The `agentic-workflow-compiler` has the **Sentry SDK** installed. Sentry acts as a security camera for the code. The moment the Python code crashes, the Sentry SDK catches the exact stack trace, the line of code that failed, and the time of the crash. It immediately beams this data to the Sentry Cloud Dashboard.

### Step 3: The Webhook Auto-Trigger
Sentry realizes this is a brand new, unhandled exception. Because we configured a custom **Internal Integration Webhook** in Sentry, Sentry immediately fires an HTTP POST request to our SRE Agent's backend URL: `https://autosre-backend.onrender.com/api/webhook/sentry`.

### Step 4: The Agent Wakes Up & Broadcasts
The AutoSRE Express.js backend receives the webhook. It immediately:
1. **Wakes up the LLM Agent** (Google Gemini) in the background.
2. **Broadcasts an Alert**: The backend loops through any open **Server-Sent Event (SSE)** connections. If an engineer happens to have the AutoSRE React Dashboard open on their laptop, the dashboard magically clears itself and prints: *"🔔 Webhook Alert Received from Sentry! Starting Autonomous Investigation..."*

### Step 5: Tool Calling (The MCP Infrastructure)
The Gemini Agent needs evidence to figure out *why* the crash happened. 
Instead of hardcoding APIs into the AI, AutoSRE uses the **Model Context Protocol (MCP)**. MCP acts as a secure bridge between the AI and the company's infrastructure. 

The AI looks at the MCP Server and discovers the tools available to it. It executes **Parallel Tool Calling** to gather evidence instantly:
1. **`fetch_sentry_issues`**: Reaches back into the Sentry API to download the exact stack trace and error message of the crash.
2. **`get_recent_commits`**: Authenticates with the GitHub API and downloads the latest commits from the `agentic-workflow-compiler` repository to see if a developer just changed the code.
3. **`get_system_metrics`**: Checks CPU, Memory, and Network latency to ensure the crash wasn't caused by a server running out of RAM. *(Currently mocked for safety)*.
4. **`get_dependency_health`**: Checks if external dependencies (like Stripe or AWS S3) are currently down. *(Currently mocked for safety)*.

### Step 6: Vector RAG Memory (Has this happened before?)
Before making a decision, the SRE Agent takes the error logs and converts them into a massive mathematical array (a 3,072-dimension Vector Embedding). 
It queries a **Supabase PostgreSQL database equipped with `pgvector`**. It asks: *"Have we ever seen a crash that looks mathematically similar to this one in the past?"*

If it finds a match, it pulls the historical **Root Cause Analysis (RCA)** to see how senior engineers fixed it last time.

### Step 7: Cross-Correlation & RCA Generation
The Agent now has the complete picture:
- The exact Python error.
- The latest GitHub commits.
- System health metrics.
- Past historical incidents.

The AI cross-correlates all this data. It notices that 5 minutes ago, a developer named Ashutosh committed a change titled "Update payment logic", and right after that, the `ZeroDivisionError` started happening. 

The Agent writes a highly detailed, markdown-formatted **Root Cause Analysis (RCA)** report containing a Summary, a Timeline of events, and Immediate Remediation steps.

### Step 8: The Resolution
As the Agent generates the RCA, it streams the text directly to the React UI via the SSE connection. 
Finally, the Agent takes this brand new RCA, converts it into a vector, and **saves it into the Supabase Memory Database**. 
Now, if this exact same crash happens again 6 months from now, the Agent will remember exactly how to fix it!

---

## 🛠️ Core Features & Capabilities

The following architectural decisions enable the autonomous capabilities of the platform:

1. **Event-Driven Auto-Triggering:** The platform doesn't require humans to start investigations. It is fully integrated with enterprise observability tools (Sentry) via webhooks to trigger RCAs the millisecond a crash occurs.
2. **Model Context Protocol (MCP) Architecture:** The AI is strictly decoupled from the infrastructure APIs. It negotiates access to internal tools (GitHub, Sentry, Metrics) dynamically using standard MCP schemas.
3. **Parallel Evidence Collection:** Unlike standard Chatbots that ask one question at a time, this agent executes parallel tool calls to gather logs, metrics, and commits simultaneously, drastically reducing investigation time.
4. **Long-Term Vector Memory (RAG):** The system learns over time. Every resolved incident is embedded via Gemini Embeddings and stored in a PostgreSQL `pgvector` database, allowing the AI to instantly recognize recurring bugs.
5. **Real-Time SSE Streaming:** The backend utilizes Server-Sent Events to push live terminal execution logs and Markdown RCA reports directly to the React frontend, allowing engineers to watch the AI's "thought process" in real-time.
