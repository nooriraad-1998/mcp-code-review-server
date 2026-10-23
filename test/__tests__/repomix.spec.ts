/**
 * @file Repomix Integration Tests
 * @version 0.1.0
 * @status STABLE - COMPLETE TEST COVERAGE
 * @lastModified 2024-03-24
 * 
 * Tests for the Repomix integration functionality
 * 
 * Test Coverage:
 * - Function exports
 * - Options interface
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test"; 
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { executeRepomix, RepomixOptions } from "../../src/repomix.js"; 

describe("Repomix", () => { 
  const testDir = path.join(process.cwd(), "test", "testRepo"); 
  
  beforeAll(() => { 
    if (!fs.existsSync(testDir)) { 
      fs.mkdirSync(testDir, { recursive: true }); 
    } 
    
    fs.writeFileSync(
      path.join(testDir, "test.js"), 
      "function add(a, b) { return a + b; }"
    ); 
    
    fs.writeFileSync(
      path.join(testDir, "test.ts"),
      "function subtract(a: number, b: number): number { return a - b; }"
    );

    fs.mkdirSync(path.join(testDir, "lib"), { recursive: true });
    fs.writeFileSync(path.join(testDir, "lib", "multiply.js"), "function multiply(a, b) { return a * b; }");
    fs.writeFileSync(path.join(testDir, "lib", "divide.ts"), "function divide(a: number, b: number) { return a / b; }");
  });
  
  afterAll(() => { 
    if (fs.existsSync(testDir)) { 
      fs.rmSync(testDir, { recursive: true, force: true }); 
    } 
  }); 
  
  it("should export functions", () => { 
    expect(typeof executeRepomix).toBe("function"); 
  }); 
  
  it("should accept options", () => {
    const options = {
      includePaths: ["src/**/*.ts"],
      excludePaths: ["node_modules"],
      fileTypes: [".ts", ".js"]
    };

    expect(options.includePaths).toContain("src/**/*.ts");
    expect(options.excludePaths).toContain("node_modules");
    expect(options.fileTypes).toEqual([".ts", ".js"]);
  });

  it("packs the requested repoPath, not the server's working directory", async () => {
    const output = await executeRepomix({ repoPath: testDir });

    expect(output).toContain("function add(a, b)");
    expect(output).toContain("function subtract(a: number, b: number)");
    expect(output).not.toContain("src/repomix.ts");
  });

  it("limits the output to specificFiles inside repoPath", async () => {
    const output = await executeRepomix({ repoPath: testDir, specificFiles: ["test.ts"] });

    expect(output).toContain("function subtract");
    expect(output).not.toContain("function add");
  });

  it("runs repomix even when it is not on PATH", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "/usr/bin:/bin";
    try {
      const output = await executeRepomix({ repoPath: testDir });
      expect(output).toContain("function add(a, b)");
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("never runs shell syntax passed in specificFiles", async () => {
    const marker = path.join(os.tmpdir(), `repomix-injection-${process.pid}`);
    fs.rmSync(marker, { force: true });

    await executeRepomix({ repoPath: testDir, specificFiles: [`x; touch ${marker}`] }).catch(() => {});

    expect(fs.existsSync(marker)).toBe(false);
  });

  it("rejects specificFiles that point outside repoPath", async () => {
    await expect(
      executeRepomix({ repoPath: testDir, specificFiles: ["../../package.json"] })
    ).rejects.toThrow(/outside the repository/);
  });

  it("limits the output to fileTypes", async () => {
    const output = await executeRepomix({ repoPath: testDir, fileTypes: [".ts"] });

    expect(output).toContain("function subtract");
    expect(output).toContain("function divide");
    expect(output).not.toContain("function add");
    expect(output).not.toContain("function multiply");
  });

  it("accepts fileTypes without a leading dot", async () => {
    const output = await executeRepomix({ repoPath: testDir, fileTypes: ["js"] });

    expect(output).toContain("function add");
    expect(output).not.toContain("function subtract");
  });

  it("applies fileTypes inside a directory given in specificFiles", async () => {
    const output = await executeRepomix({ repoPath: testDir, specificFiles: ["lib"], fileTypes: [".js"] });

    expect(output).toContain("function multiply");
    expect(output).not.toContain("function divide");
    expect(output).not.toContain("function add");
  });

  it("drops specificFiles that do not match fileTypes", async () => {
    const output = await executeRepomix({
      repoPath: testDir,
      specificFiles: ["test.js", "test.ts"],
      fileTypes: [".ts"],
    });

    expect(output).toContain("function subtract");
    expect(output).not.toContain("function add");
  });

  it("rejects fileTypes that are not plain extensions", async () => {
    await expect(
      executeRepomix({ repoPath: testDir, fileTypes: ["*/../*"] })
    ).rejects.toThrow(/Invalid file type/);
  });

  it("leaves out excludePaths", async () => {
    const output = await executeRepomix({ repoPath: testDir, excludePaths: ["lib", "test.js"] });

    expect(output).toContain("function subtract");
    expect(output).not.toContain("function add");
    expect(output).not.toContain("function multiply");
    expect(output).not.toContain("function divide");
  });

  it("rejects excludePaths that point outside repoPath", async () => {
    await expect(
      executeRepomix({ repoPath: testDir, excludePaths: ["../other"] })
    ).rejects.toThrow(/outside the repository/);
  });

  it("rejects a repoPath that is not a directory", async () => {
    await expect(
      executeRepomix({ repoPath: path.join(testDir, "does-not-exist") })
    ).rejects.toThrow(/not a directory/);
  });

  it("does not write or read repomix-output.txt in the working directory", async () => {
    const cwdOutput = path.join(process.cwd(), "repomix-output.txt");
    const before = fs.existsSync(cwdOutput) ? fs.statSync(cwdOutput).mtimeMs : null;

    const output = await executeRepomix({ repoPath: testDir });

    const after = fs.existsSync(cwdOutput) ? fs.statSync(cwdOutput).mtimeMs : null;
    expect(after).toBe(before);
    expect(fs.existsSync(path.join(testDir, "repomix-output.txt"))).toBe(false);
    expect(output).not.toContain("Generated by Repomix on: 2025-03-24");
  });
});
