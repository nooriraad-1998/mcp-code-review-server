/**
 * @file Crash Handler Tests
 *
 * Tests that unexpected errors stop the server instead of being swallowed
 */

import { describe, it, expect, mock } from "bun:test";
import { EventEmitter } from "events";
import { installCrashHandlers } from "../../src/crashHandlers.js";

function fakeProcess() {
  return Object.assign(new EventEmitter(), { exit: mock((_code?: number) => {}) });
}

describe("Crash handlers", () => {
  it("exits with code 1 on an uncaught exception", () => {
    const target = fakeProcess();
    installCrashHandlers(target as unknown as NodeJS.Process);

    target.emit("uncaughtException", new Error("boom"));

    expect(target.exit).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 on an unhandled promise rejection", () => {
    const target = fakeProcess();
    installCrashHandlers(target as unknown as NodeJS.Process);

    target.emit("unhandledRejection", new Error("boom"), Promise.resolve());

    expect(target.exit).toHaveBeenCalledWith(1);
  });
});
