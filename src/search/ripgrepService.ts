/**
 * RipgrepService - Centralizes all ripgrep interactions
 *
 * This service wraps ripgrep process spawning and JSON output parsing,
 * eliminating duplication across the codebase. All ripgrep searches
 * (file search, in-memory search, etc.) go through this service.
 */

import * as cp from 'child_process';
import * as path from 'path';
import { RG_PATH } from '../utils';

export interface RipgrepMatch {
    lineNumber: number;
    lineText: string;
    matchStart: number;
    matchEnd: number;
    file?: string;
}

export interface RipgrepSearchOptions {
    pattern: string;
    isCaseSensitive: boolean;
    isWholeWord: boolean;
    isRegex: boolean;
    hasEscapeSequences: boolean;
    maxThreads?: number;
}

/**
 * Service for executing ripgrep searches with standardized argument building
 * and JSON output parsing
 */
export class RipgrepService {
    /**
     * Build ripgrep command line arguments from search options
     */
    static buildArgs(
        pattern: string,
        options: RipgrepSearchOptions,
        filePath?: string
    ): string[] {
        const args: string[] = ['--json', '--multiline', '--no-ignore'];

        // Add threads configuration
        if (options.maxThreads && options.maxThreads > 0) {
            args.push('--threads', options.maxThreads.toString());
        }

        // Case sensitivity
        if (!options.isCaseSensitive) {
            args.push('--ignore-case');
        }

        // Whole word matching
        if (options.isWholeWord) {
            args.push('--word-regexp');
        }

        // Pattern and mode
        if (options.isRegex) {
            args.push('-e', pattern);
        } else {
            args.push('--fixed-strings', '-e', pattern);
        }

        // File path (required for searches)
        if (filePath) {
            args.push(filePath);
        }

        return args;
    }

    /**
     * Parse a single line of ripgrep JSON output
     * Returns null if the line is not a match or cannot be parsed
     */
    static parseJsonLine(line: string): any | null {
        if (!line.trim()) {
            return null;
        }

        try {
            return JSON.parse(line);
        } catch (error) {
            return null;
        }
    }

    /**
     * Execute a ripgrep search and collect all results via callback
     */
    static async executeSearch(
        args: string[],
        onMatch: (match: RipgrepMatch) => void,
        onError?: (error: Error) => void
    ): Promise<{ count: number; error?: Error }> {
        return new Promise((resolve) => {
            let count = 0;
            let stdoutBuffer = '';
            let hasError = false;
            let error: Error | undefined;

            const rgProcess = cp.spawn(RG_PATH, args, {
                env: { ...process.env }
            });

            rgProcess.stdout.on('data', (data: Buffer) => {
                stdoutBuffer += data.toString();
                const lines = stdoutBuffer.split('\n');
                stdoutBuffer = lines.pop() || '';

                for (const line of lines) {
                    const result = this.parseJsonLine(line);
                    if (!result || result.type !== 'match') continue;

                    count++;
                    const data = result.data;
                    const lineNum = data.line_number;
                    const lineText = data.lines.text.trimEnd();
                    const matchStart = data.submatches[0]?.start || 0;
                    const matchEnd = data.submatches[0]?.end || lineText.length;

                    onMatch({
                        lineNumber: lineNum,
                        lineText,
                        matchStart,
                        matchEnd,
                        file: data.path?.text
                    });
                }
            });

            rgProcess.stderr.on('data', (data: Buffer) => {
                const errorMsg = data.toString().trim();
                if (errorMsg) {
                    hasError = true;
                    error = new Error(`Ripgrep error: ${errorMsg}`);
                    if (onError) {
                        onError(error);
                    }
                }
            });

            rgProcess.on('close', (code) => {
                resolve({
                    count,
                    error: hasError ? error : undefined
                });
            });

            rgProcess.on('error', (err) => {
                hasError = true;
                error = err;
                resolve({
                    count,
                    error
                });
            });
        });
    }
}
