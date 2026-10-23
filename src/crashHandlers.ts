/**
 * @file Crash Handlers
 * @version 0.1.0
 *
 * Stops the server on unexpected errors instead of running on in an unknown state
 */

/**
 * Logs uncaught exceptions and unhandled rejections, then exits with code 1
 * so the MCP client sees the server has failed
 * @param target The process to watch (defaults to the current process)
 */
export function installCrashHandlers(target: NodeJS.Process = process): void {
  target.on('uncaughtException', (error) => {
    console.error('Uncaught exception, shutting down:', error);
    target.exit(1);
  });

  target.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection, shutting down:', reason);
    target.exit(1);
  });
}
