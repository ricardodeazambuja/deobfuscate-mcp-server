#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  deobfuscate,
  analyzeStructure,
  listModules,
  getModule,
  searchModules,
  formatCode,
  getHelp,
  TOOL_DOCS,
  MAX_CODE_SIZE
} from "./tools.js";

const server = new McpServer({
  name: "minified-mcp-server",
  version: "1.0.0",
});

// Register tools using the high-level McpServer.tool API
server.tool(
  "deobfuscate",
  "Unpacks/deobfuscates minified code & caches result. (See get_help)",
  {
    code: z.string().max(MAX_CODE_SIZE, `Input code too large (max ${MAX_CODE_SIZE / 1024 / 1024}MB)`),
    unbundle: z.boolean().optional().default(true)
  },
  async ({ code, unbundle }) => {
    const result = await deobfuscate(code, unbundle);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "list_modules",
  "Lists modules from cached bundle. (See get_help)",
  {
    excludeVendor: z.boolean().optional().default(false)
  },
  async ({ excludeVendor }) => {
    const modules = await listModules(excludeVendor);
    return { content: [{ type: "text", text: JSON.stringify(modules, null, 2) }] };
  }
);

server.tool(
  "get_module",
  "Gets code for specific module ID from cache. (See get_help)",
  {
    id: z.string()
  },
  async ({ id }) => {
    const moduleCode = await getModule(id);
    return { content: [{ type: "text", text: moduleCode }] };
  }
);

server.tool(
  "search_modules",
  "Searches text/regex in cached modules. (See get_help)",
  {
    query: z.string(),
    isRegex: z.boolean().optional().default(false),
    limit: z.number().optional().default(50)
  },
  async ({ query, isRegex, limit }) => {
    const results = await searchModules(query, isRegex, limit);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

server.tool(
  "analyze_structure",
  "Returns structural summary (AST) of code. (See get_help)",
  {
    code: z.string().max(MAX_CODE_SIZE, `Input code too large (max ${MAX_CODE_SIZE / 1024 / 1024}MB)`),
    limit: z.number().optional().default(50)
  },
  async ({ code, limit }) => {
    const structure = await analyzeStructure(code, limit);
    return { content: [{ type: "text", text: JSON.stringify(structure, null, 2) }] };
  }
);

server.tool(
  "format_code",
  "Formats code with Prettier. (See get_help)",
  {
    code: z.string().max(MAX_CODE_SIZE, `Input code too large (max ${MAX_CODE_SIZE / 1024 / 1024}MB)`),
    parser: z.enum(["babel", "html", "css"]).optional().default("babel")
  },
  async ({ code, parser }) => {
    const formatted = await formatCode(code, parser);
    return { content: [{ type: "text", text: formatted }] };
  }
);

server.tool(
  "get_help",
  "Get detailed usage info and examples for a specific tool.",
  {
    tool_name: z.enum(Object.keys(TOOL_DOCS) as [string, ...string[]])
  },
  async ({ tool_name }) => {
    const doc = getHelp(tool_name);
    return { content: [{ type: "text", text: doc }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Minified MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});