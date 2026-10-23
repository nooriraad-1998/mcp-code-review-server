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
 * A file Repomix left out of its output because its secret scan found likely
 * credentials in it
 */
export interface ExcludedFile {
  path: string;        // Path relative to the repository
  issueCount: number;  // Number of likely credentials found
}

/**
 * Result of packing a repository
 */
export interface RepomixResult {
  output: string;                // Packed repository text
  excludedFiles: ExcludedFile[]; // Files the secret scan left out of output
}

/**
 * Checks whether a path lies inside a directory (or is the directory itself)
 */
function isInside(directory: string, target: string): boolean {
  const relative = path.relative(directory, target);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Resolves symlinks in the longest part of a path that exists on disk, so a
 * glob or a not-yet-existing file is checked through the directories above it
 * @param target Absolute path
 * @returns Real path of the deepest existing ancestor of target (or target itself)
 */
function realPathOfExistingPart(target: string): string {
  let current = target;
  while (!fs.existsSync(current) && path.dirname(current) !== current) {
    current = path.dirname(current);
  }
  return fs.realpathSync(current);
}

/**
 * Converts a path into a pattern relative to the repository, rejecting anything
 * that would escape it, either directly or through a symlink, or be split by
 * Repomix's comma syntax
 * @param repoPath Absolute path of the repository
 * @param realRepoPath repoPath with symlinks resolved
 * @param file File, directory or glob pattern
 * @returns Path relative to repoPath ('' for the repository itself)
 */
function toRepoRelative(repoPath: string, realRepoPath: string, file: string): string {
  if (file.includes(',')) {
    throw new Error(`Invalid path "${file}": commas are not allowed`);
  }
  const resolved = path.resolve(repoPath, file);
  const relative = path.relative(repoPath, resolved);
  if (!isInside(repoPath, resolved)) {
    throw new Error(`File "${file}" is outside the repository ${repoPath}`);
  }
  // Repomix follows symlinked directories named in a pattern, so a link such
  // as src/root -> / would otherwise expose any file on the machine
  if (!isInside(realRepoPath, realPathOfExistingPart(resolved))) {
    throw new Error(`File "${file}" is a symlink to somewhere outside the repository ${repoPath}`);
  }
  return relative.split(path.sep).join('/');
}

/**
 * Reads the files Repomix's secret scan excluded from its console report
 * @param stdout Repomix's standard output
 * @returns The excluded files, in the order Repomix listed them
 */
function parseExcludedFiles(stdout: string): ExcludedFile[] {
  const lines = stdout.split('\n');
  const start = lines.findIndex((line) => /suspicious file\(s\) detected and excluded/.test(line));
  if (start === -1) {
    return [];
  }
  const expected = Number(lines[start].match(/(\d+) suspicious file/)?.[1]);

  const excludedFiles: ExcludedFile[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const file = lines[i].match(/^\d+\.\s+(.+)$/);
    if (file) {
      const count = lines[i + 1]?.match(/^\s+- (\d+) security issues? detected/);
      excludedFiles.push({ path: file[1], issueCount: count ? Number(count[1]) : 1 });
    } else if (lines[i].trim() === '') {
      break;
    }
  }

  // Fail closed: a file left out without saying which one is a silent gap in the review
  if (excludedFiles.length !== expected) {
    throw new Error(
      `Repomix excluded ${expected} file(s) as likely secrets but their names could not be read from its report`
    );
  }
  return excludedFiles;
}

/**
 * Describes the excluded files at the top of the packed output
 * @param excludedFiles Files the secret scan left out
 * @returns Notice text, or '' when nothing was left out
 */
function excludedFilesNotice(excludedFiles: ExcludedFile[]): string {
  if (excludedFiles.length === 0) {
    return '';
  }
  const list = excludedFiles
    .map((file) => `- ${file.path} (${file.issueCount} likely credential${file.issueCount === 1 ? '' : 's'})`)
    .join('\n');
  return `WARNING: ${excludedFiles.length} file(s) were left out of this output because Repomix's secret scan ` +
    `found likely credentials in them. Their contents are not shown below and were not analyzed:\n${list}\n\n`;
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
 * @param realRepoPath repoPath with symlinks resolved
 * @param specificFiles Files, directories or glob patterns to include
 * @param fileTypes Extensions to include
 * @returns Include patterns relative to repoPath (empty means everything)
 */
function toIncludePatterns(
  repoPath: string,
  realRepoPath: string,
  specificFiles: string[],
  fileTypes: string[]
): string[] {
  const extensions = toExtensions(fileTypes);
  const typePatterns = (base: string) =>
    extensions.map((extension) => (base ? `${base}/**/*.${extension}` : `**/*.${extension}`));

  if (specificFiles.length === 0) {
    return typePatterns('');
  }

  const patterns = specificFiles.flatMap((file) => {
    const relative = toRepoRelative(repoPath, realRepoPath, file);
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
 * @param realRepoPath repoPath with symlinks resolved
 * @param excludePaths Files, directories or glob patterns to leave out
 * @returns Ignore patterns relative to repoPath
 */
function toIgnorePatterns(repoPath: string, realRepoPath: string, excludePaths: string[]): string[] {
  return excludePaths.map((file) => {
    const relative = toRepoRelative(repoPath, realRepoPath, file);
    if (relative === '') {
      throw new Error('excludePaths cannot exclude the whole repository');
    }
    return isDirectory(repoPath, relative) ? `${relative}/**` : relative;
  });
}

/**
 * Executes Repomix analysis with the given options
 * @param options Configuration options for the analysis
 * @returns Promise resolving to the analysis results, starting with a warning
 * that lists any files the secret scan left out
 */
export async function executeRepomix(options: RepomixOptions = {}): Promise<string> {
  const { output, excludedFiles } = await packRepository(options);
  return excludedFilesNotice(excludedFiles) + output;
}

/**
 * Packs a repository with Repomix
 * @param options Configuration options for the analysis
 * @returns Promise resolving to the packed text and the files the secret scan left out
 */
export async function packRepository(options: RepomixOptions = {}): Promise<RepomixResult> {
  const repoPath = path.resolve(options.repoPath ?? process.cwd());
  console.error('Analyzing repository at', repoPath, 'with Repomix...');

  if (!fs.statSync(repoPath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Repository path ${repoPath} is not a directory`);
  }

  const realRepoPath = fs.realpathSync(repoPath);
  const includePatterns = toIncludePatterns(repoPath, realRepoPath, options.specificFiles ?? [], options.fileTypes ?? []);
  const ignorePatterns = toIgnorePatterns(repoPath, realRepoPath, options.excludePaths ?? []);

  // Write to a fresh temp file so no stale or concurrent output is ever read back
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repomix-'));
  const outputPath = path.join(outputDir, 'repomix-output.txt');

  // Arguments go straight to the process, never through a shell
  const args = [REPOMIX_BIN, '--style', 'plain', '--output', outputPath];
  if (includePatterns.length > 0) {
    args.push('--include', includePatterns.join(','));
  }
  if (ignorePatterns.length > 0) {
    args.push('--ignore', ignorePatterns.join(','));
  }
  args.push('--', repoPath);

  try {
    // The secret scan's report only goes to stdout, so keep it plain to parse
    const { stdout } = await execFileAsync(process.execPath, args, {
      cwd: repoPath,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
    });
    return { output: fs.readFileSync(outputPath, 'utf-8'), excludedFiles: parseExcludedFiles(stdout) };
  } catch (error) {
    console.error('Error executing Repomix:', error);
    throw new Error(`Failed to execute Repomix: ${(error as Error).message}`);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}
