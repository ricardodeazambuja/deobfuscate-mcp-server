import { webcrack } from "webcrack";
import * as parser from "@babel/parser";
import _traverse from "@babel/traverse";
import { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { format } from "prettier";

const traverse = _traverse.default;

// Shared state and constants
export const MAX_CODE_SIZE = 50 * 1024 * 1024; // 50MB
export const DEFAULT_LIMIT = 50;

export const BABEL_PARSER_OPTIONS: parser.ParserOptions = {
  sourceType: "module",
  plugins: ["jsx", "typescript"],
};

export const PRETTIER_OPTIONS: any = {
  parser: "babel",
  semi: true,
  singleQuote: true,
};

const MAX_MB = `${MAX_CODE_SIZE / 1024 / 1024}MB`;

export const state = {
  lastBundle: null as any
};

export const TOOL_DOCS = {
  deobfuscate: `
Tool: deobfuscate
Description: Primary entry point. Takes minified JavaScript code and uses 'webcrack' to de-obfuscate and unpack it.
Key Behavior:
- Unpacks Webpack/Browserify/Parcel bundles into individual modules.
- Caches the unbundled modules in memory for subsequent use by 'list_modules', 'get_module', and 'search_modules'.
- Returns the main entry point code and a summary of the operation.
Input:
- code (string): The raw minified code (Max ${MAX_MB}).
- unbundle (boolean): Default true. Set to false if you only want variable renaming without bundle splitting.
`,
  list_modules: `
Tool: list_modules
Description: Returns a JSON list of all modules found in the currently cached bundle (from the last 'deobfuscate' call).
Input:
- excludeVendor (boolean): Default false. If true, filters out modules from 'node_modules', 'webpack', etc.
Key Behavior:
- Requires 'deobfuscate' to have been run successfully first.
- Returns an array of objects containing { id, path, size, isVendor }.
- Use this to map out the bundle before requesting specific module content.
`,
  get_module: `
Tool: get_module
Description: Fetches the source code of a specific module from the cached bundle.
Input:
- id (string): The module ID (as returned by 'list_modules').
Key Behavior:
- Throws error if no bundle is cached or ID is invalid.
- Returns formatted, readable code for that specific module.
`,
  search_modules: `
Tool: search_modules
Description: Scans all cached modules for a specific text string or regular expression.
Input:
- query (string): The text or regex pattern to search for.
- isRegex (boolean): Default false. Treat 'query' as a JS RegExp if true.
- limit (number): Optional. Max number of results to return. Default ${DEFAULT_LIMIT}.
Key Behavior:
- Useful for finding where specific constants, API keys, or function names are defined across a large bundle.
- Returns a list of matches with module IDs and paths.
`,
  analyze_structure: `
Tool: analyze_structure
Description: Performs a static analysis (AST) of the provided code to generate a high-level architectural summary.
Input:
- code (string): The JS code to analyze (Max ${MAX_MB}).
- limit (number): Optional. Limit the number of functions/classes/exports returned. Default ${DEFAULT_LIMIT}.
Key Behavior:
- Identifies Top-Level Functions, Classes, Exported Variables/Functions.
- Returns a JSON summary.
- Does NOT return the full code. Use this to get a "Table of Contents" before reading the file.
`,
  format_code: `
Tool: format_code
Description: Standard code formatter using Prettier.
Input:
- code (string): The code to format (Max ${MAX_MB}).
- parser (enum): 'babel' (for JS/TS), 'html', or 'css'.
`,
  get_help: `
Tool: get_help
Description: Returns detailed documentation for a specific tool.
Input:
- tool_name (string): The name of the tool to get help for.
`,
  get_symbol_source: `
Tool: get_symbol_source
Description: Extracts the source code of a specific function, class, or variable from a module or provided code snippet.
Input:
- symbolName (string): The name of the symbol to extract.
- code (string): Optional. The source code to search in (Max ${MAX_MB}).
- moduleId (string): Optional. The ID of the module in the cached bundle to search in.
Key Behavior:
- Saves tokens by returning only the requested symbol instead of the entire file.
- Uses AST parsing to accurately locate the symbol.
`
};

/**
 * Helper to format code consistently
 */
async function formatJS(code: string) {
  return await format(code, PRETTIER_OPTIONS);
}

export async function getSymbolSource(symbolName: string, code?: string, moduleId?: string) {
  let sourceCode = code;
  if (moduleId) {
    if (!state.lastBundle) throw new Error('No bundle cached. Run deobfuscate first.');
    const mod = state.lastBundle.modules.get(moduleId);
    if (!mod) throw new Error(`Module ${moduleId} not found.`);
    sourceCode = mod.code;
  }

  if (!sourceCode) throw new Error("Either 'code' or 'moduleId' must be provided.");

  const ast = parser.parse(sourceCode, BABEL_PARSER_OPTIONS);

  let foundCode: string | null = null;

  traverse(ast, {
    enter(path) {
      if (foundCode) return;

      let match = false;
      if (path.isFunctionDeclaration() || path.isClassDeclaration()) {
        if (path.node.id?.name === symbolName) match = true;
      } else if (path.isVariableDeclarator()) {
        if (t.isIdentifier(path.node.id) && path.node.id.name === symbolName) {
          if (path.parentPath.isVariableDeclaration()) {
            path = path.parentPath;
          }
          match = true;
        }
      }

      if (match) {
        const { start, end } = path.node;
        if (start !== null && end !== null) {
          foundCode = sourceCode!.slice(start, end);
        }
      }
    },
  });

  if (!foundCode) throw new Error(`Symbol '${symbolName}' not found.`);

  return await formatJS(foundCode);
}

export async function analyzeStructure(code: string, limit: number = DEFAULT_LIMIT) {
  try {
    const ast = parser.parse(code, BABEL_PARSER_OPTIONS);

    const structure: any = {
      functions: [] as string[],
      classes: [] as string[],
      exports: [] as string[],
      variables: [] as string[],
    };

    traverse(ast, {
      FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
        if (path.node.id) structure.functions.push(path.node.id.name);
      },
      ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
        if (path.node.id) structure.classes.push(path.node.id.name);
      },
      VariableDeclaration(path: NodePath<t.VariableDeclaration>) {
        path.node.declarations.forEach((decl) => {
          if (t.isVariableDeclarator(decl) && t.isIdentifier(decl.id)) {
            structure.variables.push(decl.id.name);
          }
        });
      },
      ExportNamedDeclaration(path: NodePath<t.ExportNamedDeclaration>) {
        if (path.node.declaration) {
          if (t.isFunctionDeclaration(path.node.declaration) && path.node.declaration.id) {
            structure.exports.push(path.node.declaration.id.name);
          } else if (t.isVariableDeclaration(path.node.declaration)) {
            path.node.declaration.declarations.forEach((decl) => {
              if (t.isVariableDeclarator(decl) && t.isIdentifier(decl.id)) structure.exports.push(decl.id.name);
            });
          }
        }
      },
    });

    return {
      functions: structure.functions.slice(0, limit),
      classes: structure.classes.slice(0, limit),
      exports: structure.exports.slice(0, limit),
      totalFunctions: structure.functions.length,
      totalVariables: structure.variables.length,
      message: "Summary generated. Use get_module or read_code for specific parts."
    };
  } catch (error: any) {
    throw new Error(`Failed to parse AST: ${error.message}`);
  }
}

export async function deobfuscate(code: string, unbundle: boolean = true) {
  const result = await webcrack(code, { unpack: unbundle });
  state.lastBundle = result.bundle || null;
  
  let responseText = result.code;
  if (result.bundle) {
    responseText = "// Unbundled " + result.bundle.modules.size + " modules.\n// Use 'list_modules' to see them all.\n// Main entry point:\n" + result.code;
  }

  return await formatJS(responseText);
}

function isVendorModule(path: string): boolean {
  if (!path) return false;
  const vendorPatterns = [
    "node_modules",
    "webpack/runtime",
    "webpack/bootstrap",
    "(webpack)",
    "vendor/",
    "bower_components",
    "jspm_packages",
    "shims/"
  ];
  // normalize path to avoid OS specific issues, though webcrack usually outputs forward slashes
  const normalized = path.replace(/\\/g, "/");
  return vendorPatterns.some(pattern => normalized.includes(pattern));
}

export async function listModules(excludeVendor: boolean = false) {
  if (!state.lastBundle) {
    throw new Error("No bundle found. Run 'deobfuscate' with a bundled file first.");
  }
  
  let modules = Array.from(state.lastBundle.modules.values()) as any[];
  
  if (excludeVendor) {
    modules = modules.filter(m => !isVendorModule(m.path));
  }

  return modules.map((m: any) => ({
    id: m.id,
    path: m.path,
    size: m.code.length,
    isVendor: isVendorModule(m.path)
  }));
}

export async function getModule(id: string) {
  if (!state.lastBundle) {
    throw new Error("No bundle found. Run 'deobfuscate' first.");
  }
  const module = state.lastBundle.modules.get(id);
  if (!module) {
    throw new Error(`Module ${id} not found.`);
  }
  return await formatJS(module.code);
}

export async function searchModules(query: string, isRegex: boolean = false, limit: number = DEFAULT_LIMIT) {
  if (!state.lastBundle) {
    throw new Error("No bundle found. Run 'deobfuscate' first.");
  }

  const results: any[] = [];
  let regex: RegExp | null = null;
  
  if (isRegex) {
    try {
      regex = new RegExp(query, "i");
    } catch (e) {
      throw new Error(`Invalid regular expression: ${query}`);
    }
  }

  state.lastBundle.modules.forEach((m: any) => {
    if (isRegex && regex) {
      if (regex.test(m.code)) results.push({ id: m.id, path: m.path });
    } else {
      if (m.code.includes(query)) results.push({ id: m.id, path: m.path });
    }
  });

  return results.slice(0, limit);
}

export async function formatCode(code: string, parserName: string = "babel") {
  return await format(code, { parser: parserName as any });
}

export function getHelp(toolName: string) {
  const doc = TOOL_DOCS[toolName as keyof typeof TOOL_DOCS];
  if (!doc) {
    throw new Error(`No documentation found for tool: ${toolName}`);
  }
  return doc;
}