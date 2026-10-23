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
 * Result of a code review performed by an LLM
 */
export interface CodeReviewResult {
  overview: string;
  issues: Array<{
    file: string;
    line?: number;
    severity: 'critical' | 'major' | 'minor' | 'suggestion';
    description: string;
    recommendation?: string;
  }>;
  recommendations: string[];
  score: number;
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
    await execFileAsync(process.execPath, args, { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 });
    return fs.readFileSync(outputPath, 'utf-8');
  } catch (error) {
    console.error('Error executing Repomix:', error);
    throw new Error(`Failed to execute Repomix: ${(error as Error).message}`);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

/**
 * Send the Repomix output to an LLM for code review
 * This is a placeholder implementation that will be completed later
 * 
 * @param repomixOutputPath Path to the Repomix output file
 * @param systemPrompt The system prompt for the LLM
 * @param userPrompt The user prompt for the LLM
 * @returns A promise that resolves to the code review result
 */
export async function sendToLLM(
  repomixOutputPath: string, 
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  userPrompt: string = DEFAULT_USER_PROMPT
): Promise<CodeReviewResult> {
  try {
    // Read the Repomix output file
    const codebaseContent = fs.readFileSync(repomixOutputPath, 'utf-8');
    console.error(`Read ${codebaseContent.length} characters from Repomix output`);
    
    // For now, return a placeholder result
    // TODO: Implement actual LLM API call
    return {
      overview: "Placeholder for LLM code review",
      issues: [{
        file: "example.ts",
        line: 1,
        severity: "suggestion",
        description: "This is a placeholder issue",
        recommendation: "This is a placeholder recommendation"
      }],
      recommendations: ["This is a placeholder recommendation"],
      score: 5
    };
  } catch (error) {
    console.error('Error sending to LLM:', error);
    throw new Error(`Failed to get LLM code review: ${error}`);
  }
}

/**
 * Default system prompt for code review
 */
export const DEFAULT_SYSTEM_PROMPT = `
You are an expert code reviewer with extensive experience in software architecture, performance optimization, security, and best practices. Analyze the provided codebase and provide a comprehensive review that includes:

1. Overall architecture assessment
2. Identified issues with line numbers and severity ratings
3. Security vulnerabilities
4. Performance bottlenecks
5. Code quality and maintainability concerns
6. Specific recommendations for improvement
7. An overall score from 0-10

Format your response as a detailed report with clear sections and actionable feedback.
`;

/**
 * Default user prompt for code review
 */
export const DEFAULT_USER_PROMPT = `
Please review the code provided and give detailed feedback.
`;

/**
 * Analyzes a repository using Repomix and returns a code review
 * 
 * @param repoPath Path to the repository to analyze
 * @param options Options for Repomix execution
 * @param systemPrompt Custom system prompt for the LLM
 * @param userPrompt Custom user prompt for the LLM
 * @returns A promise that resolves to the code review result
 */
export async function analyzeRepo(
  repoPath: string,
  options: RepomixOptions = {},
  systemPrompt?: string,
  userPrompt?: string
): Promise<CodeReviewResult> {
  // Execute Repomix to get the flattened codebase
  const repomixOutputPath = await executeRepomix({ ...options, repoPath });
  
  // Send the flattened codebase to an LLM for analysis
  const result = await sendToLLM(
    repomixOutputPath, 
    systemPrompt || DEFAULT_SYSTEM_PROMPT,
    userPrompt || DEFAULT_USER_PROMPT
  );
  
  return result;
} 