/**
 * @file Repomix Integration
 * @version 0.1.0
 * @status STABLE - DO NOT MODIFY WITHOUT TESTS
 * @lastModified 2024-03-23
 * 
 * Provides integration with Repomix for code analysis
 * 
 * IMPORTANT:
 * - All changes must be accompanied by tests
 * - Maintain type safety
 * 
 * Functionality:
 * - Execute Repomix analysis
 * - Configure analysis options
 * - Process analysis results
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as util from 'util';
import { createRequire } from 'module';

const execFileAsync = util.promisify(execFile);

/**
 * Path to the Repomix CLI script, resolved from the installed package so it
 * works whether or not node_modules/.bin is on PATH
 */
const REPOMIX_BIN = path.join(
  path.dirname(createRequire(import.meta.url).resolve('repomix')),
  '..',
  'bin',
  'repomix.cjs'
);

/**
 * Options for executing Repomix
 */
export interface RepomixOptions {
  repoPath?: string;         // Repository to pack (defaults to the current directory)
  specificFiles?: string[];  // Files, directories or glob patterns, relative to repoPath
  fileTypes?: string[];      // Extensions to include, such as ".ts" or "ts"
  excludePaths?: string[];   // Files, directories or glob patterns to leave out
}

/**
 * Converts a path into a pattern relative to the repository, rejecting anything
 * that would escape it or be split by Repomix's comma syntax
 * @param repoPath Absolute path of the repository
 * @param file File, directory or glob pattern
 * @returns Path relative to repoPath ('' for the repository itself)
 */
function toRepoRelative(repoPath: string, file: string): string {
  if (file.includes(',')) {
    throw new Error(`Invalid path "${file}": commas are not allowed`);
  }
  const relative = path.relative(repoPath, path.resolve(repoPath, file));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`File "${file}" is outside the repository ${repoPath}`);
  }
  return relative.split(path.sep).join('/');
}

/**
 * Checks whether a repository-relative path is an existing directory
 */
function isDirectory(repoPath: string, relative: string): boolean {
  return fs.statSync(path.join(repoPath, relative), { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/**
 * Normalizes file types to bare extensions, such as "ts"
 * @param fileTypes Extensions with or without a leading dot
 * @returns Extensions without the dot
 */
function toExtensions(fileTypes: string[]): string[] {
  return fileTypes.map((type) => {
    const extension = type.startsWith('.') ? type.slice(1) : type;
    if (!/^[A-Za-z0-9_-]+$/.test(extension)) {
      throw new Error(`Invalid file type "${type}": use an extension such as ".ts"`);
    }
    return extension;
  });
}

/**
 * Builds Repomix include patterns from specificFiles and fileTypes. With both,
 * fileTypes filters the files and applies inside the directories.
 * @param repoPath Absolute path of the repository
 * @param specificFiles Files, directories or glob patterns to include
 * @param fileTypes Extensions to include
 * @returns Include patterns relative to repoPath (empty means everything)
 */
function toIncludePatterns(repoPath: string, specificFiles: string[], fileTypes: string[]): string[] {
  const extensions = toExtensions(fileTypes);
  const typePatterns = (base: string) =>
    extensions.map((extension) => (base ? `${base}/**/*.${extension}` : `**/*.${extension}`));

  if (specificFiles.length === 0) {
    return typePatterns('');
  }

  const patterns = specificFiles.flatMap((file) => {
    const relative = toRepoRelative(repoPath, file);
    if (extensions.length === 0) {
      return [relative || '**'];
    }
    if (relative === '' || isDirectory(repoPath, relative)) {
      return typePatterns(relative);
    }
    return extensions.includes(path.extname(relative).slice(1)) ? [relative] : [];
  });

  if (patterns.length === 0) {
    throw new Error(`None of the specificFiles have the requested fileTypes (${fileTypes.join(', ')})`);
  }
  return patterns;
}

/**
 * Builds Repomix ignore patterns from excludePaths
 * @param repoPath Absolute path of the repository
 * @param excludePaths Files, directories or glob patterns to leave out
 * @returns Ignore patterns relative to repoPath
 */
function toIgnorePatterns(repoPath: string, excludePaths: string[]): string[] {
  return excludePaths.map((file) => {
    const relative = toRepoRelative(repoPath, file);
    if (relative === '') {
      throw new Error('excludePaths cannot exclude the whole repository');
    }
    return isDirectory(repoPath, relative) ? `${relative}/**` : relative;
  });
}

/**
 * Executes Repomix analysis with the given options
 * @param options Configuration options for the analysis
 * @returns Promise resolving to the analysis results
 */
export async function executeRepomix(options: RepomixOptions = {}): Promise<string> {
  const repoPath = path.resolve(options.repoPath ?? process.cwd());
  console.error('Analyzing repository at', repoPath, 'with Repomix...');

  if (!fs.statSync(repoPath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Repository path ${repoPath} is not a directory`);
  }

  const includePatterns = toIncludePatterns(repoPath, options.specificFiles ?? [], options.fileTypes ?? []);
  const ignorePatterns = toIgnorePatterns(repoPath, options.excludePaths ?? []);

  // Write to a fresh temp file so no stale or concurrent output is ever read back
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repomix-'));
  const outputPath = path.join(outputDir, 'repomix-output.txt');

  // Repomix runs repomix.config.js/.ts files as code, so never let it load one
  // from the repository under review (or the user's global config): passing our
  // own empty config makes it skip both
  const configPath = path.join(outputDir, 'repomix.config.json');
  fs.writeFileSync(configPath, '{}');

  // Arguments go straight to the process, never through a shell
  const args = [REPOMIX_BIN, '--style', 'plain', '--output', outputPath, '--config', configPath];
  if (includePatterns.length > 0) {
    args.push('--include', includePatterns.join(','));
  }
  if (ignorePatterns.length > 0) {
    args.push('--ignore', ignorePatterns.join(','));
  }
  args.push('--', repoPath);

  try {
    await execFileAsync(process.execPath, args, { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 });
    return fs.readFileSync(outputPath, 'utf-8');
  } catch (error) {
    console.error('Error executing Repomix:', error);
    throw new Error(`Failed to execute Repomix: ${(error as Error).message}`);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}
