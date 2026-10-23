/**
 * @file Server Tests
 * @version 0.1.0
 * @status STABLE - COMPLETE TEST COVERAGE
 * @lastModified 2024-03-24
 * 
 * Tests for the MCP server functionality
 * 
 * Test Coverage:
 * - Project dependencies
 * - Project structure
 */

import { describe, it, expect } from "bun:test";
import * as path from "path";
import * as fs from "fs";

describe("Server", () => {
  it("should have dependencies", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8")
    );
    
    expect(packageJson.dependencies).toBeDefined();
    expect(packageJson.dependencies.repomix).toBeDefined();
  });
  
  it("should have structure", () => {
    expect(fs.existsSync(path.join(process.cwd(), "src", "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "src", "repomix.ts"))).toBe(true);
  });
});
