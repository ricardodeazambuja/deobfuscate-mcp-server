# Deobfuscate MCP Server

An **LLM-Optimized** Model Context Protocol (MCP) server designed to help Large Language Models reverse-engineer, navigate, and understand minified and bundled JavaScript code.

## Why this Server?

Standard "beautifiers" only format code, leaving LLMs to struggle with massive, linear text files that overflow context windows. This server treats minified code as a **searchable database**, allowing LLMs to:

1.  **De-obfuscate & Unbundle**: Uses `webcrack` to split Webpack/Browserify bundles into individual modules.
2.  **See the Architecture**: Returns a JSON summary of the file's structure (exports, functions) before reading the code.
3.  **Navigate Randomly**: Read specific modules on-demand (`get_module`) instead of the whole file.
4.  **Search Semantically**: Find where specific strings or patterns exist across thousands of unbundled modules.

## Features

- **`deobfuscate`**: The entry point. Unpacks bundles and caches them in memory.
- **`analyze_structure`**: Returns a high-level AST summary (functions, classes, exports) to save tokens.
- **`list_modules`**: Lists all modules found in the unpacked bundle.
- **`get_module`**: Fetches the formatted source code of a single module.
- **`search_modules`**: Regex/String search across all modules.
- **`format_code`**: Standard Prettier formatting for JS/HTML/CSS.
- **`get_help`**: Returns detailed documentation for any tool.

## Installation & Setup

### Build from source
```bash
npm install
npm run build
```

### Pack and Install (Optional)
To create a distributable tarball and install it globally:
```bash
npm pack
npm install -g ./deobfuscate-mcp-server-1.0.0.tgz
```

## Client Configuration

To use this server with your favorite LLM client, add the following configuration. Replace `ABSOLUTE_PATH_TO_DIST` with the actual absolute path to `dist/index.js` on your machine.

### Claude Code
Run the following command in your terminal:
```bash
claude mcp add deobfuscate-mcp-server -- node ABSOLUTE_PATH_TO_DIST/index.js
```
Alternatively, edit `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "deobfuscate-mcp-server": {
      "command": "node",
      "args": ["ABSOLUTE_PATH_TO_DIST/index.js"]
    }
  }
}
```

### Gemini CLI
Edit `~/.gemini/settings.json`:
```json
{
  "mcpServers": {
    "deobfuscate-mcp-server": {
      "command": "node",
      "args": ["ABSOLUTE_PATH_TO_DIST/index.js"]
    }
  }
}
```

### Antigravity
Google Antigravity typically uses a similar configuration to Gemini. Edit `~/.antigravity/settings.json` (or use the integrated MCP Store UI to add a custom server):
```json
{
  "mcpServers": {
    "deobfuscate-mcp-server": {
      "command": "node",
      "args": ["ABSOLUTE_PATH_TO_DIST/index.js"]
    }
  }
}
```

## Usage

Start the server:

```bash
node dist/index.js
```

### Example Workflow for an LLM

1.  **User**: "Analyze this minified file: `bundle.min.js`..."
2.  **LLM**: Calls `deobfuscate(code="...")`.
    *   *Server*: "Unbundled 150 modules. Main entry point returned."
3.  **LLM**: "Okay, I see the entry point requires module 42. What is that?"
4.  **LLM**: Calls `get_module(id="42")`.
    *   *Server*: Returns code for module 42.
5.  **LLM**: "Where is the 'login' function defined?"
6.  **LLM**: Calls `search_modules(query="function login")`.
    *   *Server*: "Found in module 88."

## Development

- **Build**: `npm run build`
- **Test**: `npm test`

## Limits

- **File Size**: The server accepts input files (bundles) up to **50MB**.
- **Memory**: Unbundled modules are cached in RAM. Very large bundles (hundreds of MBs unpacked) may exhaust the server's available memory depending on your environment.
