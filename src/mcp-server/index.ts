import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from 'fs';
import * as path from 'path';
import dotenv from "dotenv";

dotenv.config();

// Load the current active scenario
function loadScenario() {
  const scenarioPath = path.join(__dirname, '../scenarios/active.json');
  if (fs.existsSync(scenarioPath)) {
    return JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
  }
  return { logs: [], commits: [], metrics: [] };
}

const server = new Server(
  {
    name: "auto-sre-mock-infrastructure",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_error_logs",
        description: "Fetch recent error logs for a given service.",
        inputSchema: {
          type: "object",
          properties: {
            serviceName: { type: "string" },
            timeRangeMins: { type: "number" }
          },
          required: ["serviceName"]
        }
      },
      {
        name: "fetch_sentry_issues",
        description: "Fetch real, live unhandled exceptions directly from the production Sentry project.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "get_recent_commits",
        description: "Fetch recent GitHub commits for a repository.",
        inputSchema: {
          type: "object",
          properties: {
            repoName: { type: "string" }
          },
          required: ["repoName"]
        }
      },
      {
        name: "get_system_metrics",
        description: "Fetch anomaly metrics (CPU, Memory, Error Rates) for a service.",
        inputSchema: {
          type: "object",
          properties: {
            serviceName: { type: "string" }
          },
          required: ["serviceName"]
        }
      },
      {
        name: "get_dependency_health",
        description: "Fetch health status of external dependencies (e.g. AWS, Stripe, Database).",
        inputSchema: {
          type: "object",
          properties: {
            serviceName: { type: "string" }
          },
          required: ["serviceName"]
        }
      }
    ]
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const scenario = loadScenario();
  
  if (request.params.name === "get_error_logs") {
    return {
      content: [{ type: "text", text: JSON.stringify(scenario.logs || []) }]
    };
  }

  if (request.params.name === "fetch_sentry_issues") {
    try {
      const token = process.env.SENTRY_AUTH_TOKEN;
      if (!token) {
        return { content: [{ type: "text", text: "Error: SENTRY_AUTH_TOKEN not found in .env" }] };
      }

      // Hardcoded to the user's actual live Sentry project
      const orgSlug = "test-xml";
      const projectSlug = "agentic-workflow-compiler";

      const response = await fetch(`https://sentry.io/api/0/projects/${orgSlug}/${projectSlug}/issues/`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });
      
      if (!response.ok) {
        return { content: [{ type: "text", text: `Sentry API Error: ${response.statusText}` }] };
      }
      
      const issues = await response.json();
      
      // Format it so the LLM gets only the necessary crash data, not the massive raw JSON
      const formattedIssues = issues.slice(0, 3).map((issue: any) => ({
         id: issue.id,
         title: issue.title,
         culprit: issue.culprit,
         lastSeen: issue.lastSeen,
         count: issue.count,
         permalink: issue.permalink,
         metadata: issue.metadata
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(formattedIssues) }]
      };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error fetching live Sentry issues: ${err.message}` }] };
    }
  }
  
  if (request.params.name === "get_recent_commits") {
    try {
      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        return { content: [{ type: "text", text: "Error: GITHUB_TOKEN not found in .env" }] };
      }

      // We will look at the actual repository that is crashing!
      const owner = "ashu7531"; 
      const repo = "agentic-workflow-compiler";

      // --- DEMO vs PRODUCTION LIMITATION ---
      // Currently, we only fetch the 'commit message'. 
      // In a real production system, relying purely on developer messages is dangerous 
      // because they can be inaccurate or misleading. 
      // TO-DO for Production: Upgrade this fetch to hit the GitHub Compare API 
      // to download the actual Code Diffs (the exact lines of code changed) 
      // so the LLM can verify if the code changes actually caused the outage.
      // -------------------------------------
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=5`, {
        headers: {
          "Authorization": `token ${token}`,
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "AutoSRE-Agent"
        }
      });
      
      if (!response.ok) {
        return { content: [{ type: "text", text: `GitHub API Error: ${response.statusText}` }] };
      }
      
      const commits = await response.json();
      
      // Format it cleanly so the LLM doesn't get overwhelmed by massive JSON
      const formattedCommits = commits.map((c: any) => ({
         hash: c.sha.substring(0, 7),
         author: c.commit.author.name,
         message: c.commit.message,
         timestamp: c.commit.author.date
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(formattedCommits) }]
      };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error fetching real commits: ${err.message}` }] };
    }
  }
  
  if (request.params.name === "get_system_metrics") {
    return {
      content: [{ type: "text", text: JSON.stringify(scenario.metrics || []) }]
    };
  }

  if (request.params.name === "get_dependency_health") {
    return {
      content: [{ type: "text", text: JSON.stringify(scenario.dependencies || []) }]
    };
  }
  
  throw new Error(`Tool not found: ${request.params.name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Sentinel Mock MCP Server running on stdio");
}

main().catch(console.error);
