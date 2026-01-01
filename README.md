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
- **`get_symbol_source`**: Extracts only a specific function, class, or variable to save tokens.
- **`search_modules`**: Regex/String search across all modules.
- **`format_code`**: Standard Prettier formatting for JS/HTML/CSS.
- **`get_help`**: Returns detailed documentation for any tool.

## Installation & Setup

### Install from npm (Recommended)
```bash
npm install -g deobfuscate-mcp-server
```

### Build from source
```bash
git clone https://github.com/ricardodeazambuja/deobfuscate-mcp-server.git
cd deobfuscate-mcp-server
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

To use this server with your favorite LLM client, add the following configuration.

### Claude Code
Run the following command in your terminal:
```bash
claude mcp add deobfuscate-mcp-server -- npx -y deobfuscate-mcp-server
```
Alternatively, edit `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "deobfuscate-mcp-server": {
      "command": "npx",
      "args": ["-y", "deobfuscate-mcp-server"]
    }
  }
}
```

### Gemini CLI
Run the following command in your terminal:
```bash
gemini mcp add deobfuscate-mcp-server npx -y deobfuscate-mcp-server
```
Alternatively, edit `~/.gemini/settings.json`:
```json
{
  "mcpServers": {
    "deobfuscate-mcp-server": {
      "command": "npx",
      "args": ["-y", "deobfuscate-mcp-server"]
    }
  }
}
```

### Antigravity
Run the following command in your terminal:
```bash
antigravity --add-mcp '{"deobfuscate-mcp-server": {"command": "npx", "args": ["-y", "deobfuscate-mcp-server"]}}'
```
Alternatively, edit `~/.antigravity/settings.json`:
```json
{
  "mcpServers": {
    "deobfuscate-mcp-server": {
      "command": "npx",
      "args": ["-y", "deobfuscate-mcp-server"]
    }
  }
}
```

### Development / Local Usage
If you are running the server from the source code, replace the command with:
```json
"command": "node",
"args": ["ABSOLUTE_PATH_TO_DIST/index.js"]
```
*(Replace `ABSOLUTE_PATH_TO_DIST` with the actual absolute path to the `dist` folder on your machine)*

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
7.  **LLM**: "I just want to see the login function logic."
8.  **LLM**: Calls `get_symbol_source(symbolName="login", moduleId="88")`.
    *   *Server*: Returns only the source for the 'login' function.

## Development

- **Build**: `npm run build`
- **Test**: `npm test`

## Limits

- **File Size**: The server accepts input files (bundles) up to **50MB**.
- **Memory**: Unbundled modules are cached in RAM. Very large bundles (hundreds of MBs unpacked) may exhaust the server's available memory depending on your environment.
