/**
 * @file LLM Type Definitions
 * @version 0.1.0
 * 
 * Contains type definitions for LLM integration
 */

/**
 * Supported LLM providers
 */
export type LLMProvider = 'OPEN_AI' | 'ANTHROPIC' | 'GEMINI';

/**
 * LLM configuration
 */
export interface LLMConfig {
  /**
   * The LLM provider to use
   */
  provider: LLMProvider;
  
  /**
   * The model name to use
   */
  model: string;
  
  /**
   * The API key (if not provided in environment variables)
   */
  apiKey?: string;

  /**
   * Maximum number of tokens the LLM may generate per request
   */
  maxTokens?: number;
}

/**
 * Code review options
 */
export interface CodeReviewOptions {
  /**
   * Level of detail for the code review
   */
  detailLevel: 'basic' | 'detailed';
  
  /**
   * Areas to focus on during the code review
   */
  focusAreas: ('security' | 'performance' | 'quality' | 'maintainability')[];
}

/**
 * Code review result issue
 */
export interface CodeReviewIssue {
  /**
   * Type of issue
   */
  type: 'SECURITY' | 'PERFORMANCE' | 'QUALITY' | 'MAINTAINABILITY';
  
  /**
   * Severity of the issue
   */
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  
  /**
   * Description of the issue
   */
  description: string;
  
  /**
   * Line numbers associated with the issue (if applicable)
   */
  line_numbers?: number[];
  
  /**
   * Recommended fix for the issue
   */
  recommendation: string;
}

/**
 * Structured code review result
 */
export interface CodeReviewResult {
  /**
   * Brief summary of the code and its purpose
   */
  summary: string;
  
  /**
   * List of issues found in the code
   */
  issues: CodeReviewIssue[];
  
  /**
   * List of code strengths
   */
  strengths: string[];
  
  /**
   * List of overall recommendations
   */
  recommendations: string[];

  /**
   * How much of the codebase was reviewed, in parts sent to the LLM
   */
  coverage?: {
    reviewedParts: number;
    totalParts: number;
  };
} 