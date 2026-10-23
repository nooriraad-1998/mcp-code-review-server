/**
 * @file Code Review Service
 * @version 0.1.0
 * 
 * Service for performing code reviews using LLMs
 */

import * as fs from 'fs';
import { LLMConfig, CodeReviewOptions, CodeReviewResult } from './types.js';
import { LLMService } from './service.js';
import { CodeReviewPromptBuilder } from './prompt.js';
import { CodeProcessor } from './processor.js';
import { callWithRetry } from './errors.js';

/**
 * Default maximum number of parts of a large codebase to review
 */
const DEFAULT_MAX_PARTS = 5;

/**
 * Service for performing code reviews
 */
export class CodeReviewService {
  private llmService: LLMService;
  private promptBuilder: CodeReviewPromptBuilder;
  private codeProcessor: CodeProcessor;
  
  /**
   * Creates a new CodeReviewService
   * @param config LLM configuration
   */
  constructor(config: LLMConfig) {
    this.llmService = new LLMService(config);
    this.promptBuilder = new CodeReviewPromptBuilder();
    this.codeProcessor = new CodeProcessor();
  }
  
  /**
   * Reviews code from a file
   * @param filePath Path to the file to review
   * @param options Code review options
   * @returns Code review result
   */
  async reviewCodeFromFile(filePath: string, options: CodeReviewOptions): Promise<CodeReviewResult> {
    console.error(`Reviewing code from file: ${filePath}`);
    const code = fs.readFileSync(filePath, 'utf-8');
    return this.reviewCode(code, options);
  }
  
  /**
   * Reviews code from repomix output
   * @param repomixOutput Repomix output or path to Repomix output file
   * @param options Code review options
   * @returns Code review result
   */
  async reviewCodeFromRepomix(repomixOutput: string, options: CodeReviewOptions): Promise<CodeReviewResult> {
    console.error('Processing Repomix output...');
    const parts = await this.codeProcessor.processRepomixOutput(repomixOutput);
    const partsToReview = parts.slice(0, this.maxParts());
    console.error(`Reviewing ${partsToReview.length} of ${parts.length} part(s)`);

    const results: CodeReviewResult[] = [];
    for (let i = 0; i < partsToReview.length; i++) {
      const part = parts.length > 1 ? { index: i + 1, total: parts.length } : undefined;
      results.push(await this.reviewCode(partsToReview[i], options, part));
    }

    return this.mergeResults(results, parts.length);
  }

  /**
   * Reads the maximum number of parts to review from REVIEW_MAX_PARTS
   * @returns Maximum number of parts (each part is one LLM request)
   */
  private maxParts(): number {
    const value = process.env.REVIEW_MAX_PARTS;
    if (!value) {
      return DEFAULT_MAX_PARTS;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`REVIEW_MAX_PARTS must be a positive whole number, got "${value}"`);
    }
    return parsed;
  }

  /**
   * Combines the reviews of each part into one result
   * @param results Review result for each reviewed part, in order
   * @param totalParts Number of parts the codebase was split into
   * @returns Combined code review result
   */
  private mergeResults(results: CodeReviewResult[], totalParts: number): CodeReviewResult {
    const coverage = { reviewedParts: results.length, totalParts };

    let summary = results.length === 1
      ? results[0].summary
      : results.map((result, i) => `Part ${i + 1}: ${result.summary}`).join('\n');
    if (results.length < totalParts) {
      const [reviewed, verb] = results.length === 1 ? ['part 1', 'was'] : [`parts 1-${results.length}`, 'were'];
      summary = `Only ${reviewed} of ${totalParts} ${verb} reviewed (REVIEW_MAX_PARTS=${results.length}); ` +
        `the rest of the codebase was not checked.\n${summary}`;
    }

    return {
      summary,
      issues: results.flatMap((result) => result.issues),
      strengths: results.flatMap((result) => result.strengths),
      recommendations: results.flatMap((result) => result.recommendations),
      coverage
    };
  }

  /**
   * Reviews code
   * @param code Code to review
   * @param options Code review options
   * @param part Which part of the codebase this is, when it was split
   * @returns Code review result
   */
  private async reviewCode(
    code: string,
    options: CodeReviewOptions,
    part?: { index: number; total: number }
  ): Promise<CodeReviewResult> {
    try {
      console.error('Building code review prompt...');
      const prompt = this.promptBuilder.buildCodeReviewPrompt(code, options, part);
      
      console.error('Sending code to LLM for review...');
      // Use retry logic for robustness
      const result = await callWithRetry(
        () => this.llmService.generateReview(prompt),
        3,  // max retries
        2000 // initial delay
      );
      
      console.error('Review completed successfully');
      return result;
    } catch (error) {
      console.error('Error reviewing code:', error);
      throw new Error(`Failed to review code: ${(error as Error).message}`);
    }
  }
} 