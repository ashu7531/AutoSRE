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
  
  if (request.params.name === "get_recent_commits") {
    try {
      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        return { content: [{ type: "text", text: "Error: GITHUB_TOKEN not found in .env" }] };
      }

      // We will default to looking at this current project's repo as a demo!
      // In production, this would use request.params.arguments.repoName
      const owner = "ashu7531"; 
      const repo = "AutoSRE";

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
