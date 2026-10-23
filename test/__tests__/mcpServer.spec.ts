/**
 * @file MCP Server End-to-End Tests
 *
 * Starts the real server over stdio and calls it with the MCP SDK client
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverEntry = path.join(process.cwd(), "src", "index.ts");

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };

describe("MCP server", () => {
  let client: Client;
  let repoDir: string;
  let serverDir: string;

  beforeAll(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-server-test-"));
    fs.writeFileSync(path.join(repoDir, "math.js"), "function add(a, b) { return a + b; }");
    fs.writeFileSync(path.join(repoDir, "notes.md"), "# Notes");

    // Run from a separate empty directory with no API keys: tools must use
    // repoPath rather than the server's own directory, no .env is loaded,
    // and code_review can never reach a real LLM
    serverDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-server-cwd-"));
    fs.writeFileSync(path.join(serverDir, "server-only.js"), "const serverOnly = true;");
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [serverEntry],
        cwd: serverDir,
        env: { PATH: "/usr/bin:/bin", HOME: os.homedir() },
        stderr: "ignore",
      })
    );
  });

  afterAll(async () => {
    await client?.close();
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(serverDir, { recursive: true, force: true });
  });

  async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    return (await client.callTool({ name, arguments: args })) as ToolResult;
  }

  it("lists the analyze_repo and code_review tools", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(["analyze_repo", "code_review"]);
  });

  it("analyze_repo packs the requested repository", async () => {
    const result = await callTool("analyze_repo", { repoPath: repoDir });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("function add(a, b)");
    expect(result.content[0].text).not.toContain("serverOnly");
  });

  it("analyze_repo applies fileTypes", async () => {
    const result = await callTool("analyze_repo", { repoPath: repoDir, fileTypes: [".md"] });

    expect(result.content[0].text).toContain("# Notes");
    expect(result.content[0].text).not.toContain("function add");
  });

  it("analyze_repo returns an error for paths outside the repository", async () => {
    const result = await callTool("analyze_repo", { repoPath: repoDir, specificFiles: ["../outside.js"] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/outside the repository/);
  });

  it("code_review explains missing LLM settings instead of crashing", async () => {
    const result = await callTool("code_review", { repoPath: repoDir });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/LLM_PROVIDER/);
  });

  it("keeps working after an error", async () => {
    const result = await callTool("analyze_repo", { repoPath: repoDir });

    expect(result.content[0].text).toContain("function add(a, b)");
  });
});
