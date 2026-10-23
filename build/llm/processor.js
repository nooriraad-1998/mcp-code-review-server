/**
 * @file Code Processor
 * @version 0.1.0
 *
 * Processes code for review
 */
import * as fs from 'fs';
/**
 * Processes code for LLM review
 */
export class CodeProcessor {
    /**
     * Maximum characters per chunk to send to LLM
     */
    MAX_CHARS_PER_CHUNK = 100000;
    /**
     * Processes Repomix output for review
     * @param repomixOutput Repomix output or path to output file
     * @returns Processed code, split into parts small enough to send to the LLM
     */
    async processRepomixOutput(repomixOutput) {
        try {
            let content = repomixOutput;
            // If the output is a file path, read it
            if (repomixOutput.trim().endsWith('.txt') && fs.existsSync(repomixOutput.trim())) {
                console.error(`Reading Repomix output from file: ${repomixOutput}`);
                content = fs.readFileSync(repomixOutput.trim(), 'utf-8');
            }
            else {
                console.error('Processing Repomix output from string');
            }
            // Process the output
            const processedOutput = this.formatRepomixOutput(content);
            // Split the content into parts if it is too large for one request
            const chunks = this.chunkLargeCodebase(processedOutput);
            if (chunks.length > 1) {
                console.error(`Repomix output exceeds ${this.MAX_CHARS_PER_CHUNK} chars. Split into ${chunks.length} parts.`);
            }
            return chunks;
        }
        catch (error) {
            console.error('Error processing Repomix output:', error);
            throw new Error(`Failed to process Repomix output: ${error.message}`);
        }
    }
    /**
     * Splits large codebases into manageable chunks
     * @param code Code to chunk
     * @returns Array of code chunks
     */
    chunkLargeCodebase(code) {
        if (!code || code.length <= this.MAX_CHARS_PER_CHUNK) {
            return [code];
        }
        const chunks = [];
        let currentIndex = 0;
        while (currentIndex < code.length) {
            // Find a good break point (end of a file or section)
            let endIndex = currentIndex + this.MAX_CHARS_PER_CHUNK;
            if (endIndex >= code.length) {
                endIndex = code.length;
            }
            else {
                // Try to find a file boundary to split at
                const nextFileBoundary = code.indexOf('================', endIndex);
                if (nextFileBoundary !== -1 && nextFileBoundary - endIndex < this.MAX_CHARS_PER_CHUNK * 0.2) {
                    // If the next file boundary is within 20% of the max chunk size, use it
                    endIndex = nextFileBoundary;
                }
                else {
                    // Otherwise, find the last newline before the max size
                    const lastNewline = code.lastIndexOf('\n', endIndex);
                    if (lastNewline !== -1 && lastNewline > currentIndex) {
                        endIndex = lastNewline;
                    }
                }
            }
            // Add the chunk
            chunks.push(code.substring(currentIndex, endIndex));
            currentIndex = endIndex;
        }
        return chunks;
    }
    /**
     * Formats Repomix output for LLM consumption
     * @param repomixOutput Repomix output to format
     * @returns Formatted output
     */
    formatRepomixOutput(repomixOutput) {
        // Extract the most relevant parts of the Repomix output
        let formatted = repomixOutput;
        // Remove any ASCII art or unnecessarily long headers
        formatted = formatted.replace(/^\s*[-=*]{10,}\s*$/gm, '================');
        // Ensure file headers are prominent
        formatted = formatted.replace(/^File: (.+)$/gm, '================\nFile: $1\n================');
        // Add line numbers to help with references
        const lines = formatted.split('\n');
        let currentFile = '';
        let lineCounter = 0;
        let result = [];
        for (const line of lines) {
            // Check if this is a file header
            if (line.startsWith('File: ')) {
                currentFile = line.replace('File: ', '').trim();
                lineCounter = 0;
                result.push(line);
            }
            // Check if this is a file boundary
            else if (line === '================') {
                lineCounter = 0;
                result.push(line);
            }
            // Normal code line
            else {
                if (currentFile && !line.startsWith('================')) {
                    lineCounter++;
                }
                result.push(line);
            }
        }
        return result.join('\n');
    }
}
