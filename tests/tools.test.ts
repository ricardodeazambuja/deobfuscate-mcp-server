import {
  deobfuscate,
  analyzeStructure,
  listModules,
  getModule,
  searchModules,
  formatCode,
  getSymbolSource,
  getHelp,
  state
} from "../src/tools.js";

// Mock webcrack since it's the core heavy dependency
// We can test the integration with webcrack, but for unit tests, mocking ensures stability
// However, since we want to verify real functionality, we will use a small real code snippet
// and only mock if it proves too slow/complex. For now, let's use real execution.

describe("Minified MCP Tools", () => {
  
  beforeEach(() => {
    // Reset state between tests
    state.lastBundle = null;
  });

  test("analyzeStructure should extract functions and exports", async () => {
    const code = "export function testFunc() { console.log('hello'); } const a = 1;";
    const result = await analyzeStructure(code);
    
    expect(result.functions).toContain("testFunc");
    expect(result.exports).toContain("testFunc");
    expect(result.totalVariables).toBeGreaterThan(0);
  });

  test("analyzeStructure should respect the limit parameter", async () => {
    const code = "function a(){} function b(){} function c(){}";
    const result = await analyzeStructure(code, 2);
    expect(result.functions).toHaveLength(2);
    expect(result.totalFunctions).toBe(3);
  });

  test("formatCode should format JS code", async () => {
    const code = "function a(){return 1}";
    const formatted = await formatCode(code);
    expect(formatted).toContain("function a() {");
    expect(formatted).toContain("return 1;");
  });

  test("getHelp should return docs for existing tools", () => {
    const doc = getHelp("deobfuscate");
    expect(doc).toContain("Tool: deobfuscate");
    expect(() => getHelp("nonexistent")).toThrow();
  });

  test("getSymbolSource should extract function code", async () => {
    const code = "function test() { return 1; } const other = 2;";
    const result = await getSymbolSource("test", code);
    expect(result).toContain("function test()");
    expect(result).not.toContain("const other = 2;");
  });

  test("getSymbolSource should extract variable declaration", async () => {
    const code = "const myVar = { a: 1 }; function x() {}";
    const result = await getSymbolSource("myVar", code);
    expect(result).toContain("const myVar = {");
    expect(result).not.toContain("function x()");
  });

  describe("Bundle Operations", () => {
    // A simple bundled-like string (simulated behavior since webcrack handles complex bundling)
    // We will test deobfuscate with a simple string first
    const simpleCode = "function a(){ console.log('test') }";

    test("deobfuscate should process simple code", async () => {
      const result = await deobfuscate(simpleCode, false, undefined, true);
      expect(result).toContain("function a()");
      
      // Verify that even with unbundle=false, we have an entry module
      const modules = await listModules();
      expect(modules).toHaveLength(1);
      expect(modules[0].id).toBe("(entry)");
    });

    test("search_modules should work on main code when unbundling is disabled", async () => {
      await deobfuscate(simpleCode, false);
      const results = await searchModules("console.log");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("(entry)");
    });

    test("deobfuscate should return summary by default", async () => {
      const result = await deobfuscate(simpleCode, false);
      expect(result).toContain("Deobfuscation complete");
      expect(result).not.toContain("function a()");
    });

    test("deobfuscate should unpack a real mock Webpack bundle", async () => {
      const webpackBundle = `
        (function(modules) {
          function __webpack_require__(id) {
            var module = { exports: {} };
            modules[id](module, module.exports, __webpack_require__);
            return module.exports;
          }
          return __webpack_require__(0);
        })([
          function(module, exports, __webpack_require__) {
            console.log("entry point");
            __webpack_require__(1);
          },
          function(module, exports, __webpack_require__) {
            console.log("module 1");
          }
        ]);
      `;
      const result = await deobfuscate(webpackBundle, true, undefined, true);
      expect(result).toContain("Unbundled");
      
      const modules = await listModules();
      expect(modules.length).toBeGreaterThanOrEqual(2);
      
      const mod1 = await getModule(modules[1].id);
      expect(mod1).toContain("console.log('module 1')");
    });

    test("listModules should fail if no bundle exists", async () => {
      await expect(listModules()).rejects.toThrow("No bundle found");
    });
    
    // NOTE: Testing actual bundle unpacking requires a valid Webpack bundle string.
    // Creating a mock bundle is complex. We will trust webcrack's library tests
    // and verify that our state management works if we manually inject a bundle.
    
    test("stateful operations (list, get, search) should work with injected state", async () => {
      // Manually inject a mock bundle into state
      state.lastBundle = {
        modules: new Map([
          ["1", { id: "1", path: "./src/app.js", code: "const a = 'apple';" }],
          ["2", { id: "2", path: "node_modules/react/index.js", code: "const b = 'banana';" }],
          ["3", { id: "3", path: "webpack/bootstrap", code: "const c = 'cherry';" }]
        ])
      };

      // Test default list (all modules)
      const allModules = await listModules();
      expect(allModules).toHaveLength(3);
      expect(allModules[0]).toHaveProperty("id", "1");
      expect(allModules[0]).toHaveProperty("isVendor", false);
      expect(allModules[1]).toHaveProperty("isVendor", true);

      // Test filtered list (exclude vendor)
      const appModules = await listModules(true);
      expect(appModules).toHaveLength(1);
      expect(appModules[0].path).toBe("./src/app.js");

      const mod1 = await getModule("1");
      expect(mod1).toContain("const a = 'apple';");

      const searchRes = await searchModules("banana");
      expect(searchRes).toHaveLength(1);
      expect(searchRes[0].id).toBe("2");
    });

    test("searchModules should respect the limit parameter", async () => {
      state.lastBundle = {
        modules: new Map([
          ["1", { id: "1", path: "a.js", code: "match" }],
          ["2", { id: "2", path: "b.js", code: "match" }],
          ["3", { id: "3", path: "c.js", code: "match" }]
        ])
      };
      const results = await searchModules("match", false, 2);
      expect(results).toHaveLength(2);
    });
  });
});
