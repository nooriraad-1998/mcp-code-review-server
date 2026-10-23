/**
 * @file LLM Integration Tests
 *
 * Tests for the LLM service and code review service, with the network
 * replaced by a fake node-fetch
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

type FakeRequest = { url: string; init: any };

let requests: FakeRequest[] = [];
let respond: (request: FakeRequest) => any = () => {
  throw new Error("No fake response set");
};

mock.module("node-fetch", () => ({
  default: async (url: string, init: any) => {
    const request = { url, init };
    requests.push(request);
    return respond(request);
  },
}));

const { LLMService } = await import("../../src/llm/service.js");
const { CodeReviewService } = await import("../../src/llm/codeReviewService.js");
const { loadLLMConfig } = await import("../../src/llm/config.js");
const { callWithRetry } = await import("../../src/llm/errors.js");

const validReview = JSON.stringify({ summary: "ok", issues: [], strengths: [], recommendations: [] });
const cutOffReview = '{"summary": "ok", "issues": [{"type": "QUAL';

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const replies = {
  ANTHROPIC: (text: string, cutOff = false) =>
    jsonResponse({ content: [{ type: "text", text }], stop_reason: cutOff ? "max_tokens" : "end_turn" }),
  OPEN_AI: (text: string, cutOff = false) =>
    jsonResponse({ choices: [{ message: { content: text }, finish_reason: cutOff ? "length" : "stop" }] }),
  GEMINI: (text: string, cutOff = false) =>
    jsonResponse({ candidates: [{ content: { parts: [{ text }] }, finishReason: cutOff ? "MAX_TOKENS" : "STOP" }] }),
};

const savedEnv = { ...process.env };

beforeEach(() => {
  requests = [];
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("Gemini API key handling", () => {
  const config = { provider: "GEMINI" as const, model: "gemini-test", apiKey: "SECRET-GEMINI-KEY" };

  it("sends the key in a header, not in the URL", async () => {
    respond = () => replies.GEMINI(validReview);

    await new LLMService(config).generateReview("prompt");

    expect(requests[0].url).not.toContain("SECRET-GEMINI-KEY");
    expect(requests[0].init.headers["x-goog-api-key"]).toBe("SECRET-GEMINI-KEY");
  });

  it("does not leak the key in network error messages", async () => {
    respond = (request) => {
      throw new Error(`request to ${request.url} failed, reason: connect ECONNREFUSED`);
    };

    const error = await new LLMService(config).generateReview("prompt").catch((e: Error) => e);

    expect(error.message).toContain("ECONNREFUSED");
    expect(error.message).not.toContain("SECRET-GEMINI-KEY");
  });
});

describe("Output token limit", () => {
  const config = { provider: "ANTHROPIC" as const, model: "claude-test", apiKey: "key" };

  it("asks for 8192 output tokens by default", async () => {
    respond = () => replies.ANTHROPIC(validReview);

    await new LLMService(config).generateReview("prompt");

    expect(JSON.parse(requests[0].init.body).max_tokens).toBe(8192);
  });

  it("reads LLM_MAX_TOKENS into the config and sends it", async () => {
    process.env.LLM_PROVIDER = "ANTHROPIC";
    process.env.ANTHROPIC_API_KEY = "key";
    process.env.LLM_MAX_TOKENS = "20000";
    respond = () => replies.ANTHROPIC(validReview);

    const loaded = loadLLMConfig();
    await new LLMService(loaded).generateReview("prompt");

    expect(loaded.maxTokens).toBe(20000);
    expect(JSON.parse(requests[0].init.body).max_tokens).toBe(20000);
  });

  it("rejects an LLM_MAX_TOKENS that is not a positive number", () => {
    process.env.LLM_PROVIDER = "ANTHROPIC";
    process.env.ANTHROPIC_API_KEY = "key";
    process.env.LLM_MAX_TOKENS = "lots";

    expect(() => loadLLMConfig()).toThrow(/LLM_MAX_TOKENS/);
  });

  for (const provider of ["ANTHROPIC", "OPEN_AI", "GEMINI"] as const) {
    it(`reports a cut-off ${provider} reply clearly instead of a JSON error`, async () => {
      respond = () => replies[provider](cutOffReview, true);

      const error = await new LLMService({ provider, model: "m", apiKey: "key" })
        .generateReview("prompt")
        .catch((e: Error) => e);

      expect(error.message).toMatch(/cut off/);
      expect(error.message).toMatch(/LLM_MAX_TOKENS/);
    });
  }
});

describe("Retries", () => {
  const config = { provider: "ANTHROPIC" as const, model: "claude-test", apiKey: "key" };
  const review = () => callWithRetry(() => new LLMService(config).generateReview("prompt"), 3, 1);

  function errorResponse(status: number) {
    return { ok: false, status, statusText: "Error", text: async () => "error body", json: async () => ({}) };
  }

  for (const status of [429, 500, 503, 529]) {
    it(`retries a ${status} reply and returns the next successful one`, async () => {
      respond = () => (requests.length === 1 ? errorResponse(status) : replies.ANTHROPIC(validReview));

      const result = await review();

      expect(requests.length).toBe(2);
      expect(result.summary).toBe("ok");
    });
  }

  it("retries a network error", async () => {
    respond = (request) => {
      if (requests.length === 1) {
        throw new Error(`request to ${request.url} failed, reason: socket hang up`);
      }
      return replies.ANTHROPIC(validReview);
    };

    const result = await review();

    expect(requests.length).toBe(2);
    expect(result.summary).toBe("ok");
  });

  for (const status of [400, 401, 404]) {
    it(`does not retry a ${status} reply`, async () => {
      respond = () => errorResponse(status);

      await expect(review()).rejects.toThrow(new RegExp(String(status)));
      expect(requests.length).toBe(1);
    });
  }

  it("does not retry a cut-off reply", async () => {
    respond = () => replies.ANTHROPIC(cutOffReview, true);

    await expect(review()).rejects.toThrow(/cut off/);
    expect(requests.length).toBe(1);
  });

  it("gives up after the maximum number of retries", async () => {
    respond = () => errorResponse(529);

    await expect(review()).rejects.toThrow(/529/);
    expect(requests.length).toBe(4);
  });
});

describe("Large codebases", () => {
  const options = { detailLevel: "basic" as const, focusAreas: ["quality" as const] };

  // Each file is ~90K characters, so every file lands in its own chunk
  function repomixOutput(fileCount: number): string {
    let output = "";
    for (let i = 1; i <= fileCount; i++) {
      output += `================\nFile: src/file${i}.ts\n================\n`;
      output += `// MARKER_${i}\n` + "const value = 1;\n".repeat(5300);
    }
    return output;
  }

  function serviceWithFakeLLM() {
    const service = new CodeReviewService({ provider: "ANTHROPIC", model: "m", apiKey: "key" });
    const prompts: string[] = [];
    (service as any).llmService = {
      generateReview: async (prompt: string) => {
        prompts.push(prompt);
        const n = prompts.length;
        return {
          summary: `summary ${n}`,
          issues: [{ type: "QUALITY", severity: "LOW", description: `issue ${n}`, recommendation: "fix" }],
          strengths: [`strength ${n}`],
          recommendations: [`recommendation ${n}`],
        };
      },
    };
    return { service, prompts };
  }

  it("reviews every part of a codebase larger than one chunk", async () => {
    const { service, prompts } = serviceWithFakeLLM();

    const result = await service.reviewCodeFromRepomix(repomixOutput(3), options);

    expect(prompts.length).toBe(3);
    const allPrompts = prompts.join("\n");
    for (const marker of ["MARKER_1", "MARKER_2", "MARKER_3"]) {
      expect(allPrompts).toContain(marker);
    }
    expect(result.issues.map((issue) => issue.description)).toEqual(["issue 1", "issue 2", "issue 3"]);
    expect(result.strengths).toEqual(["strength 1", "strength 2", "strength 3"]);
    expect(result.coverage).toEqual({ reviewedParts: 3, totalParts: 3 });
  });

  it("tells the model which part of the codebase it is reviewing", async () => {
    const { service, prompts } = serviceWithFakeLLM();

    await service.reviewCodeFromRepomix(repomixOutput(2), options);

    expect(prompts[0]).toContain("part 1 of 2");
    expect(prompts[1]).toContain("part 2 of 2");
  });

  it("states clearly when parts are skipped because of REVIEW_MAX_PARTS", async () => {
    process.env.REVIEW_MAX_PARTS = "1";
    const { service, prompts } = serviceWithFakeLLM();

    const result = await service.reviewCodeFromRepomix(repomixOutput(3), options);

    expect(prompts.length).toBe(1);
    expect(result.coverage).toEqual({ reviewedParts: 1, totalParts: 3 });
    expect(result.summary).toContain("Only part 1 of 3");
  });

  it("does not split a small codebase or mention parts", async () => {
    const { service, prompts } = serviceWithFakeLLM();

    const result = await service.reviewCodeFromRepomix("File: a.ts\nconst a = 1;\n", options);

    expect(prompts.length).toBe(1);
    expect(prompts[0]).not.toContain("part 1 of");
    expect(result.summary).toBe("summary 1");
    expect(result.coverage).toEqual({ reviewedParts: 1, totalParts: 1 });
  });
});
