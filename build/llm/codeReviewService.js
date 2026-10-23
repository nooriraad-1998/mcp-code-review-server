/**
 * @file Code Review Service
 * @version 0.1.0
 *
 * Service for performing code reviews using LLMs
 */
import * as fs from 'fs';
import { LLMService } from './service.js';
import { CodeReviewPromptBuilder } from './prompt.js';
import { CodeProcessor } from './processor.js';
import { callWithRetry } from './errors.js';
/**
 * Service for performing code reviews
 */
export class CodeReviewService {
    llmService;
    promptBuilder;
    codeProcessor;
    /**
     * Creates a new CodeReviewService
     * @param config LLM configuration
     */
    constructor(config) {
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
    async reviewCodeFromFile(filePath, options) {
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
    async reviewCodeFromRepomix(repomixOutput, options) {
        console.error('Processing Repomix output...');
        const processedRepo = await this.codeProcessor.processRepomixOutput(repomixOutput);
        console.error(`Processed Repomix output (${processedRepo.length} characters)`);
        return this.reviewCode(processedRepo, options);
    }
    /**
     * Reviews code
     * @param code Code to review
     * @param options Code review options
     * @returns Code review result
     */
    async reviewCode(code, options) {
        try {
            console.error('Building code review prompt...');
            const prompt = this.promptBuilder.buildCodeReviewPrompt(code, options);
            console.error('Sending code to LLM for review...');
            // Use retry logic for robustness
            const result = await callWithRetry(() => this.llmService.generateReview(prompt), 3, // max retries
            2000 // initial delay
            );
            console.error('Review completed successfully');
            return result;
        }
        catch (error) {
            console.error('Error reviewing code:', error);
            throw new Error(`Failed to review code: ${error.message}`);
        }
    }
}
