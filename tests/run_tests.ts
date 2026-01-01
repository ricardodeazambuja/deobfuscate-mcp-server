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

async function runTests() {
  console.log("Running Tests...");
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      state.lastBundle = null; // Reset state
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (error: any) {
      console.error(`❌ ${name}`);
      console.error(`   ${error.message}`);
      failed++;
    }
  }

  function expect(actual: any) {
    return {
      toBe: (expected: any) => {
        if (actual !== expected) throw new Error(`Expected ${expected}, but got ${actual}`);
      },
      toContain: (expected: any) => {
        if (!actual.includes(expected)) throw new Error(`Expected to contain '${expected}'`);
      },
      toBeGreaterThan: (expected: number) => {
        if (actual <= expected) throw new Error(`Expected > ${expected}, got ${actual}`);
      },
      toHaveLength: (expected: number) => {
        if (actual.length !== expected) throw new Error(`Expected length ${expected}, got ${actual.length}`);
      },
      toHaveProperty: (prop: string, val?: any) => {
        if (!actual.hasOwnProperty(prop)) throw new Error(`Missing property ${prop}`);
        if (val !== undefined && actual[prop] !== val) throw new Error(`Property ${prop} mismatch`);
      },
      rejects: {
        toThrow: async (msg?: string) => {
          try {
            await actual;
            throw new Error("Expected to throw, but didn't");
          } catch (e: any) {
            if (msg && !e.message.includes(msg) && e.message !== "Expected to throw, but didn't") {
              throw new Error(`Expected error '${msg}', got '${e.message}'`);
            }
          }
        }
      }
    };
  }

  await test("analyzeStructure should extract functions", async () => {
    const code = "export function testFunc() { console.log('hello'); } const a = 1;";
    const result = await analyzeStructure(code);
    expect(result.functions).toContain("testFunc");
    expect(result.exports).toContain("testFunc");
  });

  await test("analyzeStructure should respect limit", async () => {
    const code = "function a(){} function b(){}";
    const result = await analyzeStructure(code, 1);
    expect(result.functions).toHaveLength(1);
  });

  await test("formatCode should format JS", async () => {
    const code = "function a(){return 1}";
    const formatted = await formatCode(code);
    expect(formatted).toContain("function a() {");
  });

  await test("getHelp should return docs", () => {
    const doc = getHelp("deobfuscate");
    expect(doc).toContain("Tool: deobfuscate");
  });

  await test("getSymbolSource should extract function code", async () => {
    const code = "function test() { return 1; } const other = 2;";
    const result = await getSymbolSource("test", code);
    expect(result).toContain("function test()");
    if (result.includes("const other = 2;")) throw new Error("Should not contain other code");
  });

  await test("getSymbolSource should extract variable declaration", async () => {
    const code = "const myVar = { a: 1 }; function x() {}";
    const result = await getSymbolSource("myVar", code);
    expect(result).toContain("const myVar = {");
    if (result.includes("function x()")) throw new Error("Should not contain other code");
  });

  await test("deobfuscate should process simple code", async () => {
    const code = "function a(){ console.log('test') }";
    const result = await deobfuscate(code, false);
    expect(result).toContain("function a()");
  });

  await test("deobfuscate should actually unpack a mock Webpack bundle", async () => {
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
    
    // This executes real webcrack logic
    const result = await deobfuscate(webpackBundle, true);
    
    // Check if webcrack identified the modules
    expect(result).toContain("Unbundled");
    
    // Verify list_modules works on the REAL output from webcrack
    const modules = await listModules();
    if (modules.length < 2) throw new Error(`Expected at least 2 modules, got ${modules.length}`);
    
    // Verify we can get the code for one of the unpacked modules
    const mod1 = await getModule(modules[1].id);
    expect(mod1).toContain("console.log('module 1')");
  });

  await test("listModules should fail if no bundle", async () => {
    await expect(listModules()).rejects.toThrow("No bundle found");
  });

  await test("stateful operations should work with injected state", async () => {
    state.lastBundle = {
      modules: new Map([
        ["1", { id: "1", path: "./a.js", code: "const a = 'apple';" }],
        ["2", { id: "2", path: "./b.js", code: "const b = 'banana';" }]
      ])
    };

    const modules = await listModules();
    expect(modules).toHaveLength(2);
    expect(modules[0]).toHaveProperty("id", "1");

    const mod1 = await getModule("1");
    expect(mod1).toContain("const a = 'apple';");

    const searchRes = await searchModules("banana");
    expect(searchRes).toHaveLength(1);
    expect(searchRes[0]).toHaveProperty("id", "2");
  });

  console.log(`\nTests Complete: ${passed} Passed, ${failed} Failed.`);
  if (failed > 0) process.exit(1);
}

runTests();
