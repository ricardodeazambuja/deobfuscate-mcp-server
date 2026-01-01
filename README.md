# Minified Code MCP Server

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

## Installation

```bash
npm install
npm run build
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
