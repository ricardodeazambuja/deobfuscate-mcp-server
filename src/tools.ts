import { webcrack } from "webcrack";
import * as parser from "@babel/parser";
import _traverse from "@babel/traverse";
import { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { format } from "prettier";
import { readFile } from "fs/promises";

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
- code (string): Optional. The raw minified code (Max ${MAX_MB}).
- filePath (string): Optional. Path to a local file containing the code.
- unbundle (boolean): Default true. Set to false if you only want variable renaming without bundle splitting.
- mangle (boolean): Default false. Set to true to shorten variable names (saves tokens, useful if names are garbage).
- jsx (boolean): Default true. Attempts to reverse-engineer React.createElement calls back to JSX.
- skipVendor (boolean): Default false. If true, permanently removes vendor modules (node_modules, webpack, etc.) from the cache.
- returnCode (boolean): Default false. If true, returns the full deobfuscated code. If false, returns a summary (recommended for large files).
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
- code (string): Optional. The JS code to analyze (Max ${MAX_MB}).
- filePath (string): Optional. Path to a local file containing the code.
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
- code (string): Optional. The code to format (Max ${MAX_MB}).
- filePath (string): Optional. Path to a local file containing the code.
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
- filePath (string): Optional. Path to a local file containing the code.
- moduleId (string): Optional. The ID of the module in the cached bundle to search in.
Key Behavior:
- Saves tokens by returning only the requested symbol instead of the entire file.
- Uses AST parsing to accurately locate the symbol.
`,
  list_functions: `
Tool: list_functions
Description: Scans cached modules to list defined functions and classes.
Input:
- moduleId (string): Optional. If provided, limits the scan to this specific module.
- limit (number): Optional. Max number of results. Default ${DEFAULT_LIMIT}.
Key Behavior:
- Returns { moduleId, modulePath, name, type, line, params, lines, signature } for found symbols.
- Useful for mapping out the logic within the deobfuscated bundle.
`,
  get_call_graph: `
Tool: get_call_graph
Description: Generates a call graph for a specific function (incoming and outgoing calls).
Input:
- symbolName (string): The function name to analyze.
- moduleId (string): The module ID where the function is defined.
- scanAllModules (boolean): Default false. If true, searches all cached modules for incoming calls (slower).
Key Behavior:
- Outgoing: Analyzes the function body to see what it calls.
- Incoming: Scans code to see who calls this function.
- Returns { outgoing: [], incoming: [] } listing caller/callee names and locations.
`
};

/**
 * Helper to format code consistently
 */
async function formatJS(code: string) {
  return await format(code, PRETTIER_OPTIONS);
}

export async function getSymbolSource(symbolName: string, code?: string, moduleId?: string, filePath?: string) {
  let sourceCode = code;
  if (filePath) {
      sourceCode = await readFile(filePath, 'utf-8');
  }
  
  if (moduleId) {
    if (!state.lastBundle) throw new Error('No bundle cached. Run deobfuscate first.');
    const mod = state.lastBundle.modules.get(moduleId);
    if (!mod) throw new Error(`Module ${moduleId} not found.`);
    sourceCode = mod.code;
  }

  if (!sourceCode) throw new Error("Either 'code', 'filePath' or 'moduleId' must be provided.");

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

export async function analyzeStructure(code?: string, limit: number = DEFAULT_LIMIT, filePath?: string) {
  try {
    let sourceCode = code;
    if (filePath) {
        sourceCode = await readFile(filePath, 'utf-8');
    }

    if (!sourceCode) throw new Error("Either 'code' or 'filePath' must be provided.");

    const ast = parser.parse(sourceCode, BABEL_PARSER_OPTIONS);

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

export async function deobfuscate(
  code?: string, 
  unbundle: boolean = true, 
  filePath?: string, 
  returnCode: boolean = false,
  mangle: boolean = false,
  jsx: boolean = true,
  skipVendor: boolean = false
) {
  let sourceCode = code;
  if (filePath) {
      sourceCode = await readFile(filePath, 'utf-8');
  }

  if (!sourceCode) throw new Error("Either 'code' or 'filePath' must be provided.");

  const result = await webcrack(sourceCode, { unpack: unbundle, mangle, jsx });
  
  // Create a unified modules map
  // If webcrack found a bundle, start with its modules. Otherwise start empty.
  const modules = result.bundle ? new Map(result.bundle.modules) : new Map();

  let removedCount = 0;
  if (skipVendor && result.bundle) {
    for (const [id, mod] of modules) {
      if (isVendorModule(mod.path)) {
        modules.delete(id);
        removedCount++;
      }
    }
  }

  // Always add the main entry point / leftover code as a virtual module
  // This ensures search_modules and list_modules work even if unbundling fails or is disabled
  modules.set("(entry)", {
    id: "(entry)",
    path: "Main Entry Point",
    code: result.code
  });

  state.lastBundle = { modules };
  
  if (!returnCode) {
    const moduleCount = modules.size;
    let summary = `Deobfuscation complete.
Modules found: ${moduleCount} (including main entry)
Total code length: ${result.code.length} characters (main entry)
The code has been cached in memory.`;

    if (removedCount > 0) {
      summary += `\nSkipped vendor modules: ${removedCount}`;
    }

    summary += `\nUse 'list_modules' to inspect individual modules.
To see the full deobfuscated code, run this tool again with 'returnCode: true'.`;
    return summary;
  }

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

export async function listFunctions(moduleId?: string, limit: number = DEFAULT_LIMIT) {
  if (!state.lastBundle) {
    throw new Error("No bundle found. Run 'deobfuscate' first.");
  }

  const results: any[] = [];
  const modulesToScan: any[] = [];

  if (moduleId) {
    const mod = state.lastBundle.modules.get(moduleId);
    if (!mod) throw new Error(`Module ${moduleId} not found.`);
    modulesToScan.push(mod);
  } else {
    for (const mod of state.lastBundle.modules.values()) {
       modulesToScan.push(mod);
    }
  }

  function getParamNames(params: any[]): string[] {
    return params.map(p => {
      if (t.isIdentifier(p)) return p.name;
      if (t.isAssignmentPattern(p) && t.isIdentifier(p.left)) return p.left.name + "?";
      if (t.isRestElement(p) && t.isIdentifier(p.argument)) return "..." + p.argument.name;
      return "{destructured}";
    });
  }

  for (const mod of modulesToScan) {
    if (results.length >= limit) break;

    try {
      const ast = parser.parse(mod.code, BABEL_PARSER_OPTIONS);
      
      traverse(ast, {
        FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
          if (path.node.id) {
            const params = getParamNames(path.node.params);
            const start = path.node.loc?.start.line ?? 0;
            const end = path.node.loc?.end.line ?? 0;
            results.push({
              moduleId: mod.id,
              modulePath: mod.path,
              name: path.node.id.name,
              type: "function",
              line: start,
              params: params,
              lines: end - start + 1,
              signature: `function ${path.node.id.name}(${params.join(", ")})`
            });
          }
        },
        ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
          if (path.node.id) {
            const start = path.node.loc?.start.line ?? 0;
            const end = path.node.loc?.end.line ?? 0;
            results.push({
              moduleId: mod.id,
              modulePath: mod.path,
              name: path.node.id.name,
              type: "class",
              line: start,
              params: [],
              lines: end - start + 1,
              signature: `class ${path.node.id.name}`
            });
          }
        },
        VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
          if (t.isIdentifier(path.node.id) && path.node.init) {
             let isFunc = false;
             let params: string[] = [];
             let signaturePrefix = "";

             if (t.isArrowFunctionExpression(path.node.init)) {
                isFunc = true;
                params = getParamNames(path.node.init.params);
                signaturePrefix = "const " + path.node.id.name + " = (" + params.join(", ") + ") =>";
             } else if (t.isFunctionExpression(path.node.init)) {
                isFunc = true;
                params = getParamNames(path.node.init.params);
                signaturePrefix = "const " + path.node.id.name + " = function(" + params.join(", ") + ")";
             }

             if (isFunc) {
               const start = path.node.loc?.start.line ?? 0;
               const end = path.node.loc?.end.line ?? 0;
               results.push({
                moduleId: mod.id,
                modulePath: mod.path,
                name: path.node.id.name,
                type: "variable_function",
                line: start,
                params: params,
                lines: end - start + 1,
                signature: signaturePrefix
              });
             }
          }
        }
      });
    } catch (e) {
      // Ignore parse errors
    }
  }

  return results.slice(0, limit);
}

export async function getCallGraph(symbolName: string, moduleId: string, scanAllModules: boolean = false) {
  if (!state.lastBundle) {
    throw new Error("No bundle found. Run 'deobfuscate' first.");
  }

  const targetModule = state.lastBundle.modules.get(moduleId);
  if (!targetModule) throw new Error(`Module ${moduleId} not found.`);

  const graph = {
    symbol: symbolName,
    moduleId,
    outgoing: [] as any[],
    incoming: [] as any[]
  };

  // 1. Analyze Outgoing Calls (what symbolName calls)
  try {
    const ast = parser.parse(targetModule.code, BABEL_PARSER_OPTIONS);
    let foundTarget = false;

    traverse(ast, {
      // Find the target function definition first
      enter(path) {
        let isTarget = false;
        if (path.isFunctionDeclaration() && path.node.id?.name === symbolName) isTarget = true;
        if (path.isVariableDeclarator() && t.isIdentifier(path.node.id) && path.node.id.name === symbolName && (t.isFunction(path.node.init) || t.isArrowFunctionExpression(path.node.init))) isTarget = true;
        if (path.isClassDeclaration() && path.node.id?.name === symbolName) isTarget = true; // Classes "call" via constructor

        if (isTarget) {
          foundTarget = true;
          // Now traverse purely within this scope to find calls
          path.traverse({
            CallExpression(callPath) {
              let calleeName = "";
              if (t.isIdentifier(callPath.node.callee)) {
                calleeName = callPath.node.callee.name;
              } else if (t.isMemberExpression(callPath.node.callee)) {
                if (t.isIdentifier(callPath.node.callee.property)) {
                  calleeName = "." + callPath.node.callee.property.name;
                  if (t.isIdentifier(callPath.node.callee.object)) {
                    calleeName = callPath.node.callee.object.name + calleeName;
                  }
                }
              }

              if (calleeName) {
                graph.outgoing.push({
                  name: calleeName,
                  line: callPath.node.loc?.start.line
                });
              }
            }
          });
          path.skip(); // Don't traverse children twice
        }
      }
    });

    if (!foundTarget) {
      // If we didn't find the definition, we can't determine outgoing calls reliably via AST of body
      // But we can still do incoming.
    }
  } catch (e) {
    // Ignore parse errors
  }

  // 2. Analyze Incoming Calls (who calls symbolName)
  let modulesToScan: any[] = [];
  if (scanAllModules) {
    for (const mod of state.lastBundle.modules.values()) {
      if (mod.code.includes(symbolName)) { // Fast pre-filter
        modulesToScan.push(mod);
      }
    }
  } else {
    // If not scanning all, we at least scan the current module for recursive or internal calls
    modulesToScan.push(targetModule);
  }

  for (const mod of modulesToScan) {
    try {
      const ast = parser.parse(mod.code, BABEL_PARSER_OPTIONS);
      
      traverse(ast, {
        CallExpression(path) {
          let match = false;
          // Check if this call is calling our symbol
          if (t.isIdentifier(path.node.callee) && path.node.callee.name === symbolName) {
            match = true;
          } else if (t.isMemberExpression(path.node.callee) && t.isIdentifier(path.node.callee.property) && path.node.callee.property.name === symbolName) {
            match = true;
          }

          if (match) {
            // Find who called it (parent function)
            const parentFunc = path.getFunctionParent();
            let callerName = "(top-level)";
            
            if (parentFunc) {
              if (parentFunc.isFunctionDeclaration() && parentFunc.node.id) {
                callerName = parentFunc.node.id.name;
              } else if (parentFunc.isFunctionExpression() || parentFunc.isArrowFunctionExpression()) {
                // Try to find variable assignment
                if (parentFunc.parentPath.isVariableDeclarator() && t.isIdentifier(parentFunc.parentPath.node.id)) {
                  callerName = parentFunc.parentPath.node.id.name;
                } else if (parentFunc.parentPath.isClassMethod() && t.isIdentifier(parentFunc.parentPath.node.key)) {
                   callerName = parentFunc.parentPath.node.key.name;
                } else {
                  callerName = "(anonymous function)";
                }
              } else if (parentFunc.isClassMethod() && t.isIdentifier(parentFunc.node.key)) {
                callerName = parentFunc.node.key.name;
              }
            }

            graph.incoming.push({
              callerModuleId: mod.id,
              callerName: callerName,
              line: path.node.loc?.start.line
            });
          }
        }
      });
    } catch (e) {
      // Ignore
    }
  }

  // Deduplicate results
  graph.outgoing = [...new Set(graph.outgoing.map(o => JSON.stringify(o)))].map(s => JSON.parse(s));
  graph.incoming = [...new Set(graph.incoming.map(i => JSON.stringify(i)))].map(s => JSON.parse(s));

  return graph;
}

export async function formatCode(code?: string, parserName: string = "babel", filePath?: string) {
  let sourceCode = code;
  if (filePath) {
      sourceCode = await readFile(filePath, 'utf-8');
  }
  
  if (!sourceCode) throw new Error("Either 'code' or 'filePath' must be provided.");

  return await format(sourceCode, { parser: parserName as any });
}

export function getHelp(toolName: string) {
  const doc = TOOL_DOCS[toolName as keyof typeof TOOL_DOCS];
  if (!doc) {
    throw new Error(`No documentation found for tool: ${toolName}`);
  }
  return doc;
}