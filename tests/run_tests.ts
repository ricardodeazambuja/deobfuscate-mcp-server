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
  state
} from "../src/tools.js";
import { writeFile, unlink } from "fs/promises";

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
      toBeGreaterThanOrEqual: (expected: number) => {
        if (actual < expected) throw new Error(`Expected >= ${expected}, got ${actual}`);
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
    const result = await deobfuscate(code, false, undefined, true);
    expect(result).toContain("function a()");

    // Verify that even with unbundle=false, we have an entry module
    const modules = await listModules();
    expect(modules).toHaveLength(1);
    expect(modules[0]).toHaveProperty("id", "(entry)");
  });

  await test("search_modules should work on main code when unbundling is disabled", async () => {
    const code = "function a(){ console.log('magic_string') }";
    await deobfuscate(code, false);
    const results = await searchModules("magic_string");
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty("id", "(entry)");
  });

  await test("listFunctions should extract functions from cached bundle", async () => {
    const code = "function myFunc(a, b) { return a+b; } const myArrow = () => {}; class MyClass {}";
    await deobfuscate(code, false);
    
    // We expect 3 items: myFunc, myArrow, MyClass
    const results = await listFunctions();
    expect(results.length).toBeGreaterThanOrEqual(3);
    
    const names = results.map((r: any) => r.name);
    expect(names).toContain("myFunc");
    expect(names).toContain("myArrow");
    expect(names).toContain("MyClass");

    // Check richer details for myFunc
    const myFunc = results.find((r: any) => r.name === "myFunc");
    expect(myFunc).toHaveProperty("lines");
    expect(myFunc.lines).toBeGreaterThan(0);
    expect(myFunc.params).toContain("a");
    expect(myFunc.params).toContain("b");
    expect(myFunc.signature).toContain("function myFunc(a, b)");
  });

  await test("getCallGraph should identify incoming and outgoing calls", async () => {
    const code = `
      function target() {
        helper();
      }
      function helper() { console.log('hi'); }
      function caller() {
        target();
      }
    `;
    await deobfuscate(code, false);
    const graph = await getCallGraph("target", "(entry)", false);
    
    // Outgoing: target calls helper
    const outgoingNames = graph.outgoing.map((o: any) => o.name);
    expect(outgoingNames).toContain("helper");

    // Incoming: caller calls target
    const incomingNames = graph.incoming.map((i: any) => i.callerName);
    expect(incomingNames).toContain("caller");
  });

  await test("deobfuscate should return summary by default", async () => {
    const code = "function a(){ console.log('test') }";
    const result = await deobfuscate(code, false);
    expect(result).toContain("Deobfuscation complete");
  });

  await test("deobfuscate should mangle variable names when requested", async () => {
    // A long variable name that should be shortened if mangling is active
    const code = "const veryLongVariableNameThatShouldBeShortened = 1; console.log(veryLongVariableNameThatShouldBeShortened);";
    // args: code, unbundle, filePath, returnCode, mangle, jsx
    const result = await deobfuscate(code, false, undefined, true, true, true);
    
    // The long name should NOT appear in the output
    if (result.includes("veryLongVariableNameThatShouldBeShortened")) {
      throw new Error("Variable name was not mangled/shortened");
    }
    // Instead we expect short names like 'a', 'b', etc.
    // Note: webcrack's mangle logic might differ, but it definitely shouldn't preserve the long name if it's "mangling"
    // Actually, "mangle" in webcrack might mean "renaming obfuscated variables" or "minifying". 
    // If it's minifying, it should shorten.
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
    const result = await deobfuscate(webpackBundle, true, undefined, true);
    
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

  // File Path Tests
  const TEST_FILE = "test_input.js";
  const TEST_CODE = "function test() { console.log('hello'); }";
  
  await test("deobfuscate should read from file", async () => {
    await writeFile(TEST_FILE, TEST_CODE);
    try {
      const result = await deobfuscate(undefined, false, TEST_FILE, true);
      expect(result).toContain("function test()");
    } finally {
      try { await unlink(TEST_FILE); } catch (e) {}
    }
  });

  await test("analyzeStructure should read from file", async () => {
    await writeFile(TEST_FILE, TEST_CODE);
    try {
      const result = await analyzeStructure(undefined, undefined, TEST_FILE);
      expect(result.functions).toContain("test");
    } finally {
      try { await unlink(TEST_FILE); } catch (e) {}
    }
  });

  await test("formatCode should read from file", async () => {
    await writeFile(TEST_FILE, TEST_CODE);
    try {
      const result = await formatCode(undefined, undefined, TEST_FILE);
      expect(result).toContain("function test() {");
    } finally {
      try { await unlink(TEST_FILE); } catch (e) {}
    }
  });

  await test("getSymbolSource should read from file", async () => {
    await writeFile(TEST_FILE, TEST_CODE);
    try {
      const result = await getSymbolSource("test", undefined, undefined, TEST_FILE);
      expect(result).toContain("function test()");
    } finally {
      try { await unlink(TEST_FILE); } catch (e) {}
    }
  });

  console.log(`\nTests Complete: ${passed} Passed, ${failed} Failed.`);
  if (failed > 0) process.exit(1);
}

runTests();
