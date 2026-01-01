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
  listFunctions,
  getCallGraph,
  formatCode,
  getSymbolSource,
  getHelp,
  TOOL_DOCS,
  MAX_CODE_SIZE,
  DEFAULT_LIMIT
} from "./tools.js";

const server = new McpServer({
  name: "deobfuscate-mcp-server",
  version: "1.0.0",
});

// Register tools using the high-level McpServer.tool API
server.tool(
  "deobfuscate",
  "Unpacks/deobfuscates minified code & caches result.",
  {
    code: z.string().max(MAX_CODE_SIZE, `Input code too large (max ${MAX_CODE_SIZE / 1024 / 1024}MB)`).optional(),
    filePath: z.string().optional(),
    unbundle: z.boolean().optional().default(true),
    returnCode: z.boolean().optional().default(false),
    mangle: z.boolean().optional().default(false),
    jsx: z.boolean().optional().default(true),
    skipVendor: z.boolean().optional().default(false)
  },
  async ({ code, filePath, unbundle, returnCode, mangle, jsx, skipVendor }) => {
    const result = await deobfuscate(code, unbundle, filePath, returnCode, mangle, jsx, skipVendor);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "list_modules",
  "Lists modules from cached bundle.",
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
  "Gets code for specific module ID from cache.",
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
  "Searches text/regex in cached modules.",
  {
    query: z.string(),
    isRegex: z.boolean().optional().default(false),
    limit: z.number().optional().default(DEFAULT_LIMIT)
  },
  async ({ query, isRegex, limit }) => {
    const results = await searchModules(query, isRegex, limit);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

server.tool(
  "list_functions",
  "Scans cached modules to list defined functions and classes.",
  {
    moduleId: z.string().optional(),
    limit: z.number().optional().default(DEFAULT_LIMIT)
  },
  async ({ moduleId, limit }) => {
    const results = await listFunctions(moduleId, limit);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

server.tool(
  "get_call_graph",
  "Generates a call graph for a specific function.",
  {
    symbolName: z.string(),
    moduleId: z.string(),
    scanAllModules: z.boolean().optional().default(false)
  },
  async ({ symbolName, moduleId, scanAllModules }) => {
    const graph = await getCallGraph(symbolName, moduleId, scanAllModules);
    return { content: [{ type: "text", text: JSON.stringify(graph, null, 2) }] };
  }
);

server.tool(
  "analyze_structure",
  "Returns structural summary (AST) of code.",
  {
    code: z.string().max(MAX_CODE_SIZE, `Input code too large (max ${MAX_CODE_SIZE / 1024 / 1024}MB)`).optional(),
    filePath: z.string().optional(),
    limit: z.number().optional().default(DEFAULT_LIMIT)
  },
  async ({ code, filePath, limit }) => {
    const structure = await analyzeStructure(code, limit, filePath);
    return { content: [{ type: "text", text: JSON.stringify(structure, null, 2) }] };
  }
);

server.tool(
  "get_symbol_source",
  "Extracts specific function/class source code.",
  {
    symbolName: z.string(),
    code: z.string().optional(),
    filePath: z.string().optional(),
    moduleId: z.string().optional()
  },
  async ({ symbolName, code, filePath, moduleId }) => {
    const result = await getSymbolSource(symbolName, code, moduleId, filePath);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "format_code",
  "Formats code with Prettier.",
  {
    code: z.string().max(MAX_CODE_SIZE, `Input code too large (max ${MAX_CODE_SIZE / 1024 / 1024}MB)`).optional(),
    filePath: z.string().optional(),
    parser: z.enum(["babel", "html", "css"]).optional().default("babel")
  },
  async ({ code, filePath, parser }) => {
    const formatted = await formatCode(code, parser, filePath);
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
  console.error("Deobfuscate MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});