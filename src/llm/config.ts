/**
 * @file LLM Configuration
 * @version 0.1.0
 * 
 * Configuration for LLM providers
 */

import * as dotenv from 'dotenv';
import { LLMConfig, LLMProvider } from './types.js';

// Load environment variables
dotenv.config();

/**
 * API key environment variable names for each provider
 */
const apiKeyEnvVars: Record<LLMProvider, string> = {
  OPEN_AI: 'OPENAI_API_KEY',
  ANTHROPIC: 'ANTHROPIC_API_KEY',
  GEMINI: 'GEMINI_API_KEY'
};

/**
 * Default models for each provider
 */
const defaultModels: Record<LLMProvider, string> = {
  OPEN_AI: 'gpt-4o',
  ANTHROPIC: 'claude-3-opus-20240307',
  GEMINI: 'gemini-1.5-pro'
};

/**
 * Model environment variable names for each provider
 */
const modelEnvVars: Record<LLMProvider, string> = {
  OPEN_AI: 'OPENAI_MODEL',
  ANTHROPIC: 'ANTHROPIC_MODEL',
  GEMINI: 'GEMINI_MODEL'
};

/**
 * Loads LLM configuration from environment variables
 * @returns LLM configuration
 */
export function loadLLMConfig(): LLMConfig {
  // Get the provider
  const provider = process.env.LLM_PROVIDER as LLMProvider;
  if (!provider) {
    throw new Error('LLM_PROVIDER environment variable is not set. Set it to OPEN_AI, ANTHROPIC, or GEMINI');
  }
  
  // Validate the provider
  if (!Object.keys(apiKeyEnvVars).includes(provider)) {
    throw new Error(`Unsupported LLM provider: ${provider}. Must be one of: OPEN_AI, ANTHROPIC, GEMINI`);
  }
  
  // Get the API key
  const apiKeyEnvVar = apiKeyEnvVars[provider as LLMProvider];
  const apiKey = process.env[apiKeyEnvVar];
  if (!apiKey) {
    throw new Error(`${apiKeyEnvVar} environment variable is not set. This is required for the ${provider} provider.`);
  }
  
  // Get the model
  const modelEnvVar = modelEnvVars[provider as LLMProvider];
  const model = process.env[modelEnvVar] || defaultModels[provider as LLMProvider];
  console.error(`Using LLM provider: ${provider}, model: ${model}`);

  // Get the output token limit
  let maxTokens: number | undefined;
  if (process.env.LLM_MAX_TOKENS) {
    maxTokens = Number(process.env.LLM_MAX_TOKENS);
    if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
      throw new Error(`LLM_MAX_TOKENS must be a positive whole number, got "${process.env.LLM_MAX_TOKENS}"`);
    }
  }

  return {
    provider: provider as LLMProvider,
    model,
    apiKey,
    maxTokens
  };
} 