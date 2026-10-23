/**
 * @file LLM Service
 * @version 0.1.0
 * 
 * Service for interacting with LLMs using direct API calls
 */

import { LLMConfig, CodeReviewOptions, CodeReviewResult } from './types.js';
import { RetryableAPIError } from './errors.js';
import fetch from 'node-fetch';

/**
 * Prefixes an error message with context, keeping whether it is retryable
 * @param error The original error
 * @param context Text to put before the original message
 * @returns A new error of the same kind
 */
function withContext(error: unknown, context: string): Error {
  const message = `${context}: ${(error as Error).message}`;
  return error instanceof RetryableAPIError
    ? new RetryableAPIError(message, error.retryable)
    : new Error(message);
}

// Response types for different LLM providers
interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason?: string;
  }>;
}

interface AnthropicResponse {
  content: Array<{
    text: string;
  }>;
  stop_reason?: string;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason?: string;
  }>;
}

/**
 * Default maximum number of tokens the LLM may generate per request
 */
const DEFAULT_MAX_TOKENS = 8192;

/**
 * Service for interacting with LLMs via direct API calls
 */
export class LLMService {
  private config: LLMConfig;
  
  /**
   * Creates a new LLMService
   * @param config LLM configuration
   */
  constructor(config: LLMConfig) {
    this.config = config;
    console.error(`LLM service initialized with provider ${config.provider} and model ${config.model}`);
  }
  
  /**
   * Generates a review using the LLM
   * @param prompt Prompt to send to the LLM
   * @returns Generated review
   */
  async generateReview(prompt: string): Promise<CodeReviewResult> {
    try {
      console.error('Sending code review request to LLM...');
      
      // Ensure API key exists
      if (!this.config.apiKey) {
        throw new Error(`API key not provided for ${this.config.provider}`);
      }
      
      // Determine the API endpoint based on the provider
      let endpoint: string;
      let headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      let requestBody: any;
      const maxTokens = this.config.maxTokens ?? DEFAULT_MAX_TOKENS;

      switch (this.config.provider) {
        case 'OPEN_AI':
          endpoint = 'https://api.openai.com/v1/chat/completions';
          headers['Authorization'] = `Bearer ${this.config.apiKey}`;
          requestBody = {
            model: this.config.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            max_tokens: maxTokens,
            response_format: { type: 'json_object' }
          };
          break;

        case 'ANTHROPIC':
          endpoint = 'https://api.anthropic.com/v1/messages';
          headers['x-api-key'] = this.config.apiKey;
          headers['anthropic-version'] = '2023-06-01';
          requestBody = {
            model: this.config.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            max_tokens: maxTokens
          };
          break;

        case 'GEMINI':
          // Key goes in a header so it never appears in URLs or error messages
          endpoint = `https://generativelanguage.googleapis.com/v1/models/${this.config.model}:generateContent`;
          headers['x-goog-api-key'] = this.config.apiKey;
          requestBody = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: maxTokens
            }
          };
          break;
        
        default:
          throw new Error(`Unsupported LLM provider: ${this.config.provider}`);
      }
      
      // Make the API request
      try {
        let response;
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody)
          });
        } catch (error) {
          // Network failures are usually transient
          throw new RetryableAPIError((error as Error).message);
        }

        if (!response.ok) {
          const errorText = await response.text();
          // Rate limits (429) and server or overload errors (5xx) are worth retrying
          const retryable = response.status === 429 || response.status >= 500;
          throw new RetryableAPIError(
            `LLM API request failed: ${response.status} ${response.statusText} - ${errorText}`,
            retryable
          );
        }
        
        // Parse the response JSON with appropriate type
        let responseText: string;
        let cutOff: boolean;

        switch (this.config.provider) {
          case 'OPEN_AI': {
            const data = await response.json() as OpenAIResponse;
            responseText = data.choices[0].message.content;
            cutOff = data.choices[0].finish_reason === 'length';
            break;
          }

          case 'ANTHROPIC': {
            const data = await response.json() as AnthropicResponse;
            responseText = data.content[0].text;
            cutOff = data.stop_reason === 'max_tokens';
            break;
          }

          case 'GEMINI': {
            const data = await response.json() as GeminiResponse;
            responseText = data.candidates[0].content.parts[0].text;
            cutOff = data.candidates[0].finishReason === 'MAX_TOKENS';
            break;
          }

          default:
            throw new Error(`Unsupported LLM provider: ${this.config.provider}`);
        }

        if (cutOff) {
          throw new Error(
            `The review was cut off at the ${maxTokens}-token output limit. ` +
            `Set LLM_MAX_TOKENS higher, use detailLevel "basic", or review fewer files.`
          );
        }

        // Parse the result
        return this.parseReviewResponse(responseText);
      } catch (error) {
        console.error('Fetch error:', error);
        throw withContext(error, 'API request failed');
      }
    } catch (error) {
      console.error('LLM request failed:', error);
      throw withContext(error, 'Failed to generate review');
    }
  }
  
  /**
   * Parses the LLM response into a structured format
   * @param responseText LLM response text
   * @returns Parsed review result
   */
  private parseReviewResponse(responseText: string): CodeReviewResult {
    try {
      // Clean the response text - remove markdown code blocks if present
      let cleanedResponse = responseText.trim();
      
      // Handle responses wrapped in markdown code blocks
      const jsonPattern = /```(?:json)?\s*([\s\S]*?)```/;
      const match = cleanedResponse.match(jsonPattern);
      
      if (match && match[1]) {
        cleanedResponse = match[1].trim();
      }
      
      // Parse the JSON response
      const parsedResponse = JSON.parse(cleanedResponse) as CodeReviewResult;
      
      // Validate the response structure
      if (!parsedResponse.summary || 
          !Array.isArray(parsedResponse.issues) || 
          !Array.isArray(parsedResponse.strengths) || 
          !Array.isArray(parsedResponse.recommendations)) {
        throw new Error('Invalid response structure from LLM');
      }
      
      return parsedResponse;
    } catch (error) {
      console.error('Failed to parse LLM response:', error);
      console.error('Response text:', responseText);
      throw new Error(`Failed to parse LLM response: ${(error as Error).message}`);
    }
  }
} 