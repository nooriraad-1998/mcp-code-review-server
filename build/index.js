/**
 * @file Code Review MCP Server Entry Point
 * @version 0.1.0
 * @status STABLE - DO NOT MODIFY WITHOUT TESTS
 * @lastModified 2024-03-24
 *
 * Main entry point for the Code Review MCP Server
 *
 * IMPORTANT:
 * - All changes must be accompanied by tests
 * - Maintain type safety
 *
 * Functionality:
 * - Server initialization
 * - Tool registration
 * - Request handling
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { executeRepomix } from './repomix.js';
import { createCodeReviewService } from './llm/index.js';
import { z } from 'zod';
// Create and configure the server
const server = new McpServer({
    name: 'code-review-server',
    version: '0.1.0',
    description: 'A custom MCP server to perform code reviews'
});
// Define analyze_repo parameter schema
const analyzeRepoParams = {
    repoPath: z.string().describe('Path to the repository to analyze'),
    specificFiles: z.array(z.string()).optional().describe('Specific files to analyze'),
    fileTypes: z.array(z.string()).optional().describe('File types to include in the analysis')
};
// Register the analyze_repo tool with description
server.tool('analyze_repo', 'Use this tool when you need to analyze a code repository structure without performing a detailed review. This tool flattens the repository into a textual representation and is ideal for getting a high-level overview of code organization, directory structure, and file contents. Use it before code_review when you need to understand the codebase structure first, or when a full code review is not needed.', analyzeRepoParams, async (params) => {
    const options = {
        includePaths: params.specificFiles,
        fileTypes: params.fileTypes,
        outputFormat: 'plain'
    };
    const result = await executeRepomix(options);
    return { content: [{ type: 'text', text: `Analyzing repository: ${result}` }] };
});
// Define code_review parameter schema
const codeReviewParams = {
    repoPath: z.string().describe('Path to the repository to analyze'),
    specificFiles: z.array(z.string()).optional().describe('Specific files to review'),
    fileTypes: z.array(z.string()).optional().describe('File types to include in the review'),
    detailLevel: z.enum(['basic', 'detailed']).optional().describe('Level of detail for the code review'),
    focusAreas: z.array(z.enum(['security', 'performance', 'quality', 'maintainability'])).optional().describe('Areas to focus on during the code review')
};
// Register the code_review tool with description
server.tool('code_review', 'Use this tool when you need a comprehensive code review with specific feedback on code quality, security issues, performance problems, and maintainability concerns. This tool performs in-depth analysis on a repository or specific files and returns structured results including issues found, their severity, recommendations for fixes, and overall strengths of the codebase. Use it when you need actionable insights to improve code quality or when evaluating a codebase for potential problems.', codeReviewParams, async (params) => {
    try {
        // Execute Repomix to get the flattened codebase
        const repomixOptions = {
            includePaths: params.specificFiles || [params.repoPath],
            fileTypes: params.fileTypes,
            outputFormat: 'plain',
        };
        const repomixOutput = await executeRepomix(repomixOptions);
        // Set up review options
        const reviewOptions = {
            detailLevel: params.detailLevel || 'detailed',
            focusAreas: params.focusAreas || ['security', 'performance', 'quality', 'maintainability'],
        };
        // Create the code review service
        try {
            const codeReviewService = createCodeReviewService();
            // Perform the code review
            const reviewResult = await codeReviewService.reviewCodeFromRepomix(repomixOutput, reviewOptions);
            // Format the response
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(reviewResult, null, 2)
                    }
                ]
            };
        }
        catch (error) {
            console.error('Error initializing code review service:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error initializing code review service: ${error.message}. Make sure you have set the necessary environment variables (LLM_PROVIDER and the corresponding API key).`
                    }
                ],
                isError: true
            };
        }
    }
    catch (error) {
        console.error('Error in code review:', error);
        return {
            content: [
                {
                    type: 'text',
                    text: `Error performing code review: ${error.message}`
                }
            ],
            isError: true
        };
    }
});
// Start the server
const transport = new StdioServerTransport();
// Connect to the transport and handle errors
server.connect(transport)
    .then(() => {
    console.error('Server started successfully!');
})
    .catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
// Add a global error handler to prevent crashes
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    // Don't exit the process to keep the server running
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    // Don't exit the process to keep the server running
});
