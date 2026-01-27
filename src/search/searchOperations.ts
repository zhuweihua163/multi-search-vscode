import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { LineMatch, SearchHighlight } from '../types';
import { RG_PATH, byteOffsetToCharOffset, buildRegexWithEscapeSequences, buildRegexPatternWithEscapeSequences, hasEscapeSequences } from '../utils';
import { updateFileMatchesFromMap } from '../core';
import { shouldExcludeFile } from './searchUtils';


/**
 * Dependencies required for search operations.
 * These are injected to avoid circular dependencies with extension.ts.
 */
export interface SearchOperationsDependencies {
    searchHighlights: Map<string, SearchHighlight>;
    searchMatchIndices: Map<string, number>;
    webviewProvider: {
        updateWebview: () => void;
    };
}

let deps: SearchOperationsDependencies;

/**
 * Initializes the search operations module with required dependencies.
 * Must be called before using any search operation functions.
 *
 * @param dependencies - The dependencies required for search operations
 */
export function initSearchOperations(dependencies: SearchOperationsDependencies): void {
    deps = dependencies;
}

/**
 * Updates decorations for a search highlight using in-memory search.
 * Used for unsaved files that don't exist on disk yet.
 *
 * @param editor - The VSCode text editor
 * @param highlight - The search highlight configuration
 * @param decorations - Array to populate with decoration options
 * @param currentFileMatches - Array to populate with match details
 */
export async function updateDecorationsInMemory(
    editor: vscode.TextEditor,
    highlight: SearchHighlight,
    decorations: vscode.DecorationOptions[],
    currentFileMatches: LineMatch[]
): Promise<void> {
    const text = editor.document.getText();
    const lines = text.split('\n');

    let searchRegex: RegExp;

    if (highlight.isRegex) {
        const flags = highlight.isCaseSensitive ? 'gm' : 'gim';
        searchRegex = new RegExp(highlight.searchTerm, flags);
    } else if (hasEscapeSequences(highlight.searchTerm)) {
        // Handle escape sequences like \n, \t, etc.
        searchRegex = buildRegexWithEscapeSequences(
            highlight.searchTerm,
            highlight.isCaseSensitive,
            highlight.isWholeWord
        );
    } else {
        // Fixed string search
        let escapedPattern = highlight.searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (highlight.isWholeWord) {
            escapedPattern = `\\b${escapedPattern}\\b`;
        }
        const flags = highlight.isCaseSensitive ? 'gm' : 'gim';
        searchRegex = new RegExp(escapedPattern, flags);
    }

    // 

    // Search through the entire text
    let match;
    while ((match = searchRegex.exec(text)) !== null) {
        const matchStart = match.index;
        const matchEnd = matchStart + match[0].length;

        // Find which line this match is on
        let currentPos = 0;
        let lineNum = 0;
        let lineStart = 0;

        for (let i = 0; i < lines.length; i++) {
            const lineLength = lines[i].length + 1; // +1 for newline
            if (currentPos + lineLength > matchStart) {
                lineNum = i;
                lineStart = currentPos;
                break;
            }
            currentPos += lineLength;
        }

        const matchStartCol = matchStart - lineStart;
        const matchText = text.substring(matchStart, matchEnd);

        // Calculate end position (may span multiple lines)
        const newlineCount = (matchText.match(/\n/g) || []).length;
        let endPos: vscode.Position;

        if (newlineCount > 0) {
            const matchLines = matchText.split('\n');
            const lastLineLength = matchLines[matchLines.length - 1].length;
            endPos = new vscode.Position(lineNum + newlineCount, lastLineLength);
        } else {
            endPos = new vscode.Position(lineNum, matchStartCol + matchText.length);
        }

        const startPos = new vscode.Position(lineNum, matchStartCol);

        decorations.push({
            range: new vscode.Range(startPos, endPos)
        });

        currentFileMatches.push({
            line: lineNum + 1,
            column: matchStartCol,
            lineText: lines[lineNum],
            matchStart: matchStartCol,
            matchEnd: matchStartCol + matchText.length
        });
    }

    // 
}

/**
 * Updates decorations for a search highlight in the current editor.
 * Uses ripgrep for saved files, falls back to in-memory search for unsaved files.
 *
 * @param highlight - The search highlight to update decorations for
 * @param skipWebviewUpdate - If true, skip updating the webview (for batch updates)
 */
export async function updateDecorations(highlight: SearchHighlight, skipWebviewUpdate: boolean = false): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // If search is paused, clear decorations and return
    if (highlight.isPaused) {
        editor.setDecorations(highlight.decorationType, []);
        return;
    }

    if (!highlight.searchTerm) {
        editor.setDecorations(highlight.decorationType, []);
        highlight.currentFileMatches = [];
        highlight.currentMatchIndex = 0;
        // Don't clear currentFileName here - keep it undefined when no search term
        highlight.currentFileName = undefined;
        return;
    }

    // Check if the current file should be excluded
    if (highlight.excludePath && shouldExcludeFile(editor.document.uri, highlight.excludePath)) {
        editor.setDecorations(highlight.decorationType, []);
        highlight.currentFileMatches = [];
        highlight.currentMatchIndex = 0;

        // Still set the current file name so user knows which file they're viewing
        if (!highlight.filePath) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (workspaceFolder) {
                highlight.currentFileName = path.relative(workspaceFolder.uri.fsPath, editor.document.uri.fsPath);
            } else {
                highlight.currentFileName = path.basename(editor.document.uri.fsPath);
            }
        }

        if (!skipWebviewUpdate) {
            deps.webviewProvider.updateWebview();
        }
        return;
    }

    const decorations: vscode.DecorationOptions[] = [];
    const currentFileMatches: LineMatch[] = [];

    try {
        const filePath = editor.document.uri.fsPath;

        // Check if this is an unsaved file (no fsPath or untitled scheme)
        const fs = require('fs');
        const isUnsavedFile = !filePath || editor.document.uri.scheme === 'untitled' || !fs.existsSync(filePath);

        if (isUnsavedFile) {
            // Use in-memory search for unsaved files
            await updateDecorationsInMemory(editor, highlight, decorations, currentFileMatches);
            editor.setDecorations(highlight.decorationType, decorations);
            highlight.currentFileMatches = currentFileMatches;

            // Store the current file name for display
            if (!highlight.filePath) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
                if (workspaceFolder) {
                    const relativePath = path.relative(workspaceFolder.uri.fsPath, editor.document.uri.fsPath);
                    highlight.currentFileName = relativePath;
                } else {
                    highlight.currentFileName = path.basename(editor.document.uri.fsPath);
                }
            }

            // Update currentMatchIndex based on matches
            if (currentFileMatches.length > 0) {
                highlight.currentMatchIndex = 1;
                deps.searchMatchIndices.set(highlight.id, 0);
            } else {
                highlight.currentMatchIndex = 0;
            }

            highlight.isSearching = false;
            if (!skipWebviewUpdate) {
                deps.webviewProvider.updateWebview();
            }
            return;
        }

        // Build ripgrep arguments for single file
        const args: string[] = [
            '--json',
            '--line-number',
            '--column',
            '--no-heading',
            '--no-ignore',           // Search in files ignored by .gitignore
            '--color', 'never',
        ];

        // Prepare search term - handle escape sequences to match both literal and actual characters
        let searchTerm = highlight.searchTerm;
        const escapeSequences = ['\\n', '\\t', '\\r', '\\b', '\\f', '\\a', '\\v'];
        const actualCharacters = ['\n', '\t', '\r', '\b', '\f', '\x07', '\v'];
        const hasEscapeSequence = escapeSequences.some(seq => searchTerm.includes(seq));
        const hasActualCharacter = actualCharacters.some(char => searchTerm.includes(char));
        let useRegexMode = highlight.isRegex;

        // If the search contains escape sequences or actual special characters in non-regex mode, convert to regex
        // to match BOTH literal escape sequences and their actual characters
        if ((hasEscapeSequence || hasActualCharacter) && !highlight.isRegex) {
            // First, replace escape sequences AND actual characters with placeholders BEFORE escaping
            const placeholders = new Map();
            let processedTerm = searchTerm;

            // Replace each escape sequence and actual character with a unique placeholder
            const charsToReplace = [
                { seq: '\\n', actual: '\n', placeholder: '\u0001NEWLINE\u0001', pattern: '(\\\\n|\\n)' },
                { seq: '\\t', actual: '\t', placeholder: '\u0001TAB\u0001', pattern: '(\\\\t|\\t)' },
                { seq: '\\r', actual: '\r', placeholder: '\u0001CR\u0001', pattern: '(\\\\r|\\r)' },
                { seq: '\\b', actual: '\b', placeholder: '\u0001BS\u0001', pattern: '(\\\\b|\\x08)' },
                { seq: '\\f', actual: '\f', placeholder: '\u0001FF\u0001', pattern: '(\\\\f|\\f)' },
                { seq: '\\a', actual: '\x07', placeholder: '\u0001BELL\u0001', pattern: '(\\\\a|\\x07)' },
                { seq: '\\v', actual: '\v', placeholder: '\u0001VT\u0001', pattern: '(\\\\v|\\v)' }
            ];

            for (const { seq, actual, placeholder, pattern } of charsToReplace) {
                // Replace literal escape sequences (e.g., '\\n')
                if (processedTerm.includes(seq)) {
                    processedTerm = processedTerm.split(seq).join(placeholder);
                    placeholders.set(placeholder, pattern);
                }
                // Replace actual characters (e.g., newline character)
                else if (processedTerm.includes(actual)) {
                    processedTerm = processedTerm.split(actual).join(placeholder);
                    placeholders.set(placeholder, pattern);
                }
            }

            // Now escape regex special chars (won't affect our placeholders)
            processedTerm = processedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // Replace placeholders with the actual patterns
            for (const [placeholder, pattern] of placeholders) {
                processedTerm = processedTerm.split(placeholder).join(pattern);
            }

            // 
            searchTerm = processedTerm;
            useRegexMode = true;
            args.push('--multiline');
        } else if (hasEscapeSequence && highlight.isRegex) {
            // In regex mode, enable multiline for escape sequences
            args.push('--multiline');
        }

        if (!highlight.isCaseSensitive) {
            args.push('--ignore-case');
        }

        if (highlight.isWholeWord) {
            args.push('--word-regexp');
        }

        if (useRegexMode) {
            args.push('-e', searchTerm);
        } else {
            args.push('--fixed-strings', '-e', searchTerm);
        }

        args.push(filePath);

        // Debug logging (only in development)
        // 

        // Set searching flag
        highlight.isSearching = true;
        deps.webviewProvider.updateWebview();

        // Spawn ripgrep process (no cwd needed for single file search)
        const rgProcess = cp.spawn(RG_PATH, args);

        // Store process for cancellation
        highlight.searchProcess = rgProcess;

        let stdoutBuffer = '';

        // Process stdout data
        rgProcess.stdout.on('data', (data: Buffer) => {
            stdoutBuffer += data.toString();
            const lines = stdoutBuffer.split('\n');
            stdoutBuffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const result = JSON.parse(line);

                    if (result.type === 'match') {
                        const data = result.data;
                        const lineNum = data.line_number;
                        const lineText = data.lines.text.trimEnd();

                        // If this is a merged search, filter to only lines containing ALL terms
                        if (highlight.mergedTerms && highlight.mergedTerms.length > 0) {
                            const flags = highlight.isCaseSensitive ? 'g' : 'gi';
                            let hasAllTerms = true;
                            for (const term of highlight.mergedTerms) {
                                const termRegex = new RegExp(term, flags);
                                if (!termRegex.test(lineText)) {
                                    hasAllTerms = false;
                                    break;
                                }
                            }
                            // Skip this line if it doesn't contain all terms
                            if (!hasAllTerms) {
                                continue;
                            }
                        }

                        // Process all submatches on this line
                        for (const submatch of data.submatches) {
                            // Convert byte offsets to character offsets for proper handling of multi-byte chars
                            const matchStartChar = byteOffsetToCharOffset(lineText, submatch.start);
                            const matchEndChar = byteOffsetToCharOffset(lineText, submatch.end);
                            const matchText = lineText.substring(matchStartChar, matchEndChar);

                            // Calculate the actual end position (may span multiple lines)
                            const startPos = new vscode.Position(lineNum - 1, matchStartChar);
                            let endPos: vscode.Position;

                            // Count newlines in the matched text
                            const newlineCount = (matchText.match(/\n/g) || []).length;
                            if (newlineCount > 0) {
                                // Match spans multiple lines
                                const lines = matchText.split('\n');
                                const lastLineLength = lines[lines.length - 1].length;
                                endPos = new vscode.Position(lineNum - 1 + newlineCount, lastLineLength);
                            } else {
                                // Single line match
                                endPos = new vscode.Position(lineNum - 1, matchEndChar);
                            }

                            decorations.push({ range: new vscode.Range(startPos, endPos) });

                            // Collect match details for expandable list
                            currentFileMatches.push({
                                line: lineNum,
                                column: matchStartChar,
                                lineText: lineText,
                                matchStart: matchStartChar,
                                matchEnd: matchEndChar
                            });
                        }
                    }
                } catch (parseError) {
                    // Ignore parse errors
                }
            }
        });

        // Wait for process to complete
        await new Promise<void>((resolve) => {
            rgProcess.on('close', () => {
                // Clear searching flag and process reference
                highlight.isSearching = false;
                highlight.searchProcess = undefined;

                highlight.currentFileMatches = currentFileMatches;

                // Store the current file name for display
                if (!highlight.filePath) {
                    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
                    if (workspaceFolder) {
                        const relativePath = path.relative(workspaceFolder.uri.fsPath, editor.document.uri.fsPath);
                        highlight.currentFileName = relativePath;
                    } else {
                        highlight.currentFileName = path.basename(editor.document.uri.fsPath);
                    }
                }

                // Update currentMatchIndex based on matches (only for current file searches without filePath)
                if (!highlight.filePath) {
                    if (currentFileMatches.length > 0) {
                        // Set to first match
                        highlight.currentMatchIndex = 1;
                        deps.searchMatchIndices.set(highlight.id, 0);
                    } else {
                        highlight.currentMatchIndex = 0;
                    }
                }

                editor.setDecorations(highlight.decorationType, decorations);
                if (!skipWebviewUpdate) {
                    deps.webviewProvider.updateWebview();
                }
                resolve();
            });

            rgProcess.on('error', (error) => {
                console.error(`ripgrep error: ${error}`);

                // Clear searching flag on error
                highlight.isSearching = false;
                highlight.searchProcess = undefined;

                // Fallback to empty decorations but still show the file name
                highlight.currentFileMatches = [];
                highlight.currentMatchIndex = 0;

                // Store the current file name for display
                if (!highlight.filePath) {
                    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
                    if (workspaceFolder) {
                        highlight.currentFileName = path.relative(workspaceFolder.uri.fsPath, editor.document.uri.fsPath);
                    } else {
                        highlight.currentFileName = path.basename(editor.document.uri.fsPath);
                    }
                }

                editor.setDecorations(highlight.decorationType, []);
                if (!skipWebviewUpdate) {
                    deps.webviewProvider.updateWebview();
                }
                resolve();
            });
        });

    } catch (error) {
        console.error(`Invalid pattern: ${highlight.searchTerm}`, error);

        // Clear searching flag on exception
        highlight.isSearching = false;
        highlight.searchProcess = undefined;

        highlight.currentFileMatches = [];
        highlight.currentMatchIndex = 0;

        // Store the current file name for display
        if (!highlight.filePath) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (workspaceFolder) {
                highlight.currentFileName = path.relative(workspaceFolder.uri.fsPath, editor.document.uri.fsPath);
            } else {
                highlight.currentFileName = path.basename(editor.document.uri.fsPath);
            }
        }

        editor.setDecorations(highlight.decorationType, []);
        if (!skipWebviewUpdate) {
            deps.webviewProvider.updateWebview();
        }
    }
}

/**
 * Updates decorations for all search highlights.
 *
 * @param skipWebviewUpdate - If true, skip updating the webview after each highlight
 */
export async function updateAllDecorations(skipWebviewUpdate: boolean = false): Promise<void> {
    const promises: Promise<void>[] = [];
    deps.searchHighlights.forEach(highlight => {
        promises.push(updateDecorations(highlight, skipWebviewUpdate));
    });
    await Promise.all(promises);
    if (!skipWebviewUpdate) {
        deps.webviewProvider.updateWebview();
    }
}

/**
 * Searches for matches across multiple files using ripgrep.
 * Updates the highlight with file match details and displays progress.
 *
 * @param highlight - The search highlight configuration with filePath pattern
 */
export async function searchInFiles(highlight: SearchHighlight): Promise<void> {
    if (!highlight.filePath) return;

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showWarningMessage('No workspace folder open');
        return;
    }

    // Initialize fileMatches map and details array
    highlight.fileMatches = new Map();
    highlight.fileMatchDetails = [];

    try {
        // Use stored workspace root if available, otherwise try to get from active editor
        let workspaceRoot: string = highlight.workspaceRoot || '';

        if (!workspaceRoot) {
            // Try to get workspace from active editor
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
                if (workspaceFolder) {
                    workspaceRoot = workspaceFolder.uri.fsPath;
                }
            }
        }

        // Fallback to first workspace folder (guaranteed to exist due to check above)
        if (!workspaceRoot) {
            workspaceRoot = workspaceFolders[0].uri.fsPath;
        }

        // Parse multiple file path patterns (comma-separated)
        const filePathPatterns = highlight.filePath.split(',').map(p => p.trim()).filter(p => p);
        const globPatterns: string[] = [];
        let isSpecificFile = false;
        let specificFilePath = '';

        for (const pattern of filePathPatterns) {
            let searchPath = pattern;

            if (searchPath.includes('*')) {
                // Already a glob pattern, normalize path separators
                // Convert backslashes to forward slashes for cross-platform compatibility
                globPatterns.push(searchPath.replace(/\\/g, '/'));
            } else {
                // Check if this is a specific file (has an extension) or a directory
                const hasExtension = /\.[^\/\\]+$/.test(searchPath);

                if (hasExtension) {
                    // Specific file - use it directly
                    isSpecificFile = true;
                    specificFilePath = searchPath.replace(/\\/g, '/');
                    // For specific files, we'll use the file path directly instead of a glob
                } else {
                    // Convert directory path to glob pattern
                    // Normalize path separators first
                    searchPath = searchPath.replace(/\\/g, '/');
                    // Ensure trailing slash
                    searchPath = searchPath.endsWith('/') ? searchPath : `${searchPath}/`;
                    globPatterns.push(searchPath + '**');
                }
            }
        }

        // Build ripgrep arguments - optimized for performance
        const args: string[] = [
            '--json',                    // JSON output format
            '--line-number',             // Include line numbers
            '--column',                  // Include column numbers (needed for highlighting)
            '--no-heading',              // Don't group by file
            '--no-ignore',               // Search in files ignored by .gitignore
            '--color', 'never',          // No color codes
            '--max-columns', '500',      // Limit line length
            '--mmap',                    // Use memory-mapped I/O for faster file access
            '--block-buffered',          // Block buffering for better throughput
        ];

        // Add threads configuration
        const maxThreads = vscode.workspace.getConfiguration('multiSearch').get<number>('maxThreads', 0);
        if (maxThreads > 0) {
            args.push('--threads', maxThreads.toString());
        }

        // Prepare search term - handle escape sequences to match both literal and actual characters
        let searchTerm = highlight.searchTerm;
        const escapeSequences = ['\\n', '\\t', '\\r', '\\b', '\\f', '\\a', '\\v'];
        const actualCharacters = ['\n', '\t', '\r', '\b', '\f', '\x07', '\v'];
        const hasEscapeSequence = escapeSequences.some(seq => searchTerm.includes(seq));
        const hasActualCharacter = actualCharacters.some(char => searchTerm.includes(char));
        let useRegexMode = highlight.isRegex;

        // If the search contains escape sequences or actual special characters in non-regex mode, convert to regex
        // to match BOTH literal escape sequences and their actual characters
        if ((hasEscapeSequence || hasActualCharacter) && !highlight.isRegex) {
            // First, replace escape sequences AND actual characters with placeholders BEFORE escaping
            const placeholders = new Map();
            let processedTerm = searchTerm;

            // Replace each escape sequence and actual character with a unique placeholder
            const charsToReplace = [
                { seq: '\\n', actual: '\n', placeholder: '\u0001NEWLINE\u0001', pattern: '(\\\\n|\\n)' },
                { seq: '\\t', actual: '\t', placeholder: '\u0001TAB\u0001', pattern: '(\\\\t|\\t)' },
                { seq: '\\r', actual: '\r', placeholder: '\u0001CR\u0001', pattern: '(\\\\r|\\r)' },
                { seq: '\\b', actual: '\b', placeholder: '\u0001BS\u0001', pattern: '(\\\\b|\\x08)' },
                { seq: '\\f', actual: '\f', placeholder: '\u0001FF\u0001', pattern: '(\\\\f|\\f)' },
                { seq: '\\a', actual: '\x07', placeholder: '\u0001BELL\u0001', pattern: '(\\\\a|\\x07)' },
                { seq: '\\v', actual: '\v', placeholder: '\u0001VT\u0001', pattern: '(\\\\v|\\v)' }
            ];

            for (const { seq, actual, placeholder, pattern } of charsToReplace) {
                // Replace literal escape sequences (e.g., '\\n')
                if (processedTerm.includes(seq)) {
                    processedTerm = processedTerm.split(seq).join(placeholder);
                    placeholders.set(placeholder, pattern);
                }
                // Replace actual characters (e.g., newline character)
                else if (processedTerm.includes(actual)) {
                    processedTerm = processedTerm.split(actual).join(placeholder);
                    placeholders.set(placeholder, pattern);
                }
            }

            // Now escape regex special chars (won't affect our placeholders)
            processedTerm = processedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // Replace placeholders with the actual patterns
            for (const [placeholder, pattern] of placeholders) {
                processedTerm = processedTerm.split(placeholder).join(pattern);
            }

            // 
            searchTerm = processedTerm;
            useRegexMode = true;
            args.push('--multiline');
        } else if (hasEscapeSequence && highlight.isRegex) {
            // In regex mode, enable multiline for escape sequences
            args.push('--multiline');
        }

        // Add case sensitivity flag
        if (!highlight.isCaseSensitive) {
            args.push('--ignore-case');
        }

        // Add word boundary flag
        if (highlight.isWholeWord) {
            args.push('--word-regexp');
        }

        // Add regex or fixed string search
        if (useRegexMode) {
            args.push('-e', searchTerm);
        } else {
            args.push('--fixed-strings', '-e', searchTerm);
        }

        // Add file path or glob patterns
        if (isSpecificFile) {
            // For specific files, don't use globs, just pass the file directly
            // Convert to absolute path if it's not already
            const absolutePath = path.isAbsolute(specificFilePath) ? specificFilePath : path.join(workspaceRoot, specificFilePath);
            args.push(absolutePath);
        } else {
            // For directories or glob patterns, use glob filtering
            // Add all include patterns
            for (const pattern of globPatterns) {
                if (pattern && pattern !== './' && pattern !== './**') {
                    args.push('--glob', pattern);
                }
            }

            // Exclude common directories
            args.push('--glob', '!**/node_modules/**');
            args.push('--glob', '!**/.git/**');

            // Add user-specified exclude patterns
            if (highlight.excludePath) {
                // Support multiple patterns separated by comma
                const excludePatterns = highlight.excludePath.split(',').map(p => p.trim()).filter(p => p);
                for (const pattern of excludePatterns) {
                    // Add ! prefix if not already present
                    const excludeGlob = pattern.startsWith('!') ? pattern : `!${pattern}`;
                    args.push('--glob', excludeGlob);
                }
            }

            // Add the search path - use '.' since cwd is already set to workspaceRoot
            // This works correctly on both Windows and Unix-like systems
            args.push('.');
        }

        // Debug logging (only in development)
        // 

        // Set searching flag and update UI
        highlight.isSearching = true;
        deps.webviewProvider.updateWebview();

        // Spawn ripgrep process with workspace as working directory
        // This is crucial for glob patterns to work correctly
        // Normalize workspace root for macOS compatibility
        const normalizedCwd = path.normalize(workspaceRoot);
        const rgProcess = cp.spawn(RG_PATH, args, {
            cwd: normalizedCwd,
            // Ensure the process has access to the system PATH on macOS
            env: { ...process.env }
        });

        // Store process for cancellation
        highlight.searchProcess = rgProcess;

        let stdoutBuffer = '';
        let stderrBuffer = '';
        let fileMatchMap = new Map<string, { count: number; lines: LineMatch[] }>();
        let matchesFound = 0;
        const updateInterval = 2000; // Update UI every N matches (high to avoid performance impact)
        let lastUpdateTime = Date.now();

        // Capture stderr for debugging
        rgProcess.stderr.on('data', (data: Buffer) => {
            stderrBuffer += data.toString();
        });

        // Process stdout data
        rgProcess.stdout.on('data', (data: Buffer) => {
            stdoutBuffer += data.toString();
            const lines = stdoutBuffer.split('\n');
            stdoutBuffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const result = JSON.parse(line);

                    if (result.type === 'match') {
                        const data = result.data;
                        // Normalize paths for cross-platform compatibility
                        let filePath = data.path.text;

                        // If the path is already relative (starts with ./ or is just a filename), use it as-is
                        // Otherwise, convert absolute path to relative
                        if (path.isAbsolute(filePath)) {
                            const absolutePath = path.normalize(filePath);
                            const normalizedWorkspaceRoot = path.normalize(workspaceRoot);
                            filePath = path.relative(normalizedWorkspaceRoot, absolutePath);
                        } else {
                            // Remove leading ./ if present
                            filePath = filePath.replace(/^\.[\\/]/, '');
                        }
                        const lineNum = data.line_number;
                        const lineText = data.lines.text.trimEnd();

                        // If this is a merged search, filter to only lines containing ALL terms
                        if (highlight.mergedTerms && highlight.mergedTerms.length > 0) {
                            const flags = highlight.isCaseSensitive ? 'g' : 'gi';
                            let hasAllTerms = true;
                            for (const term of highlight.mergedTerms) {
                                const termRegex = new RegExp(term, flags);
                                if (!termRegex.test(lineText)) {
                                    hasAllTerms = false;
                                    break;
                                }
                            }
                            // Skip this line if it doesn't contain all terms
                            if (!hasAllTerms) {
                                continue;
                            }
                        }

                        // Process all submatches on this line
                        for (const submatch of data.submatches) {
                            // Convert byte offsets to character offsets for proper handling of multi-byte chars
                            const matchStartChar = byteOffsetToCharOffset(lineText, submatch.start);
                            const matchEndChar = byteOffsetToCharOffset(lineText, submatch.end);

                            // Create context snippet (trim if too long)
                            const maxLength = 150;
                            let snippet = lineText;
                            let snippetMatchStart = matchStartChar;
                            let snippetMatchEnd = matchEndChar;
                            if (snippet.length > maxLength) {
                                const start = Math.max(0, matchStartChar - 50);
                                const end = Math.min(snippet.length, matchEndChar + 50);
                                const prefix = start > 0 ? '...' : '';
                                snippet = prefix + snippet.substring(start, end) + (end < lineText.length ? '...' : '');
                                // Adjust match positions relative to the snippet
                                snippetMatchStart = matchStartChar - start + prefix.length;
                                snippetMatchEnd = matchEndChar - start + prefix.length;
                            }

                            // Add to file match map
                            if (!fileMatchMap.has(filePath)) {
                                fileMatchMap.set(filePath, { count: 0, lines: [] });
                            }

                            const fileMatch = fileMatchMap.get(filePath)!;
                            fileMatch.count++;
                            fileMatch.lines.push({
                                line: lineNum,
                                column: matchStartChar,
                                lineText: snippet,
                                matchStart: snippetMatchStart,
                                matchEnd: snippetMatchEnd
                            });
                        }

                        matchesFound++;

                        // Progressive update - time-based to avoid too frequent updates
                        const now = Date.now();
                        if (matchesFound % updateInterval === 0 && now - lastUpdateTime > 500) {
                            lastUpdateTime = now;
                            updateFileMatchesFromMap(highlight, fileMatchMap, workspaceRoot);
                            deps.webviewProvider.updateWebview();
                        }
                    }
                } catch {
                    // Ignore parse errors for non-JSON lines
                }
            }
        });

        // Handle process completion
        await new Promise<void>((resolve, reject) => {
            rgProcess.on('close', (code) => {

                // Clear searching flag and process reference
                highlight.isSearching = false;
                highlight.searchProcess = undefined;

                // Log stderr if there were errors
                if (stderrBuffer) {
                    console.error(`ripgrep stderr: ${stderrBuffer}`);
                }

                // Update with final results
                updateFileMatchesFromMap(highlight, fileMatchMap, workspaceRoot);
                deps.webviewProvider.updateWebview();


                // Code 0 = matches found, Code 1 = no matches, Code 2 = error
                if (code === 0 || code === 1) {
                    // Calculate total matches by summing line counts (each line entry is a match)
                    // This matches the webview calculation: file.lines.length
                    const totalMatches = Array.from(fileMatchMap.values()).reduce((sum, fileData) => sum + fileData.lines.length, 0);
                    const fileCount = fileMatchMap.size;

                    if (fileCount > 0) {
                        vscode.window.showInformationMessage(`Found ${totalMatches} matches in ${fileCount} files`);
                    } else {
                        vscode.window.showInformationMessage(`No matches found`);
                    }
                    resolve();
                } else {
                    console.error(`ripgrep exited with code ${code}`);
                    if (stderrBuffer) {
                        vscode.window.showErrorMessage(`Search error: ${stderrBuffer.substring(0, 200)}`);
                    }
                    resolve(); // Still resolve, just with no results
                }
            });

            rgProcess.on('error', (error: any) => {
                console.error(`ripgrep error: ${error}`);

                // Clear searching flag on error
                highlight.isSearching = false;
                highlight.searchProcess = undefined;
                deps.webviewProvider.updateWebview();

                // More helpful error message for macOS users
                if (error.code === 'ENOENT') {
                    vscode.window.showErrorMessage(
                        'MultiSearch: ripgrep not found. On macOS, install with: brew install ripgrep',
                        'Learn More'
                    ).then(selection => {
                        if (selection === 'Learn More') {
                            vscode.env.openExternal(vscode.Uri.parse('https://github.com/BurntSushi/ripgrep#installation'));
                        }
                    });
                }
                reject(error);
            });
        });

    } catch (error) {
        // Clear searching flag on exception
        highlight.isSearching = false;
        highlight.searchProcess = undefined;
        deps.webviewProvider.updateWebview();

        vscode.window.showErrorMessage(`Error searching files: ${error}`);
    }
}

/**
 * Updates file search results for a specific document using ripgrep.
 * Called when a document is saved to update search results for that file.
 *
 * @param document - The VSCode text document to update search results for
 * @param highlight - The search highlight to update
 */
export async function updateFileSearchForDocument(document: vscode.TextDocument, highlight: SearchHighlight): Promise<void> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) return;

    // Normalize paths for cross-platform compatibility
    const filePath = path.normalize(document.uri.fsPath);
    const normalizedWorkspacePath = path.normalize(workspaceFolder.uri.fsPath);
    const relativePath = path.relative(normalizedWorkspacePath, filePath);

    // Build ripgrep arguments for single file - optimized for performance
    const args: string[] = [
        '--json',
        '--line-number',
        '--column',
        '--no-heading',
        '--no-ignore',               // Search in files ignored by .gitignore
        '--color', 'never',
        '--mmap',                    // Use memory-mapped I/O for faster file access
    ];

    // Add threads configuration
    const maxThreads = vscode.workspace.getConfiguration('multiSearch').get<number>('maxThreads', 0);
    if (maxThreads > 0) {
        args.push('--threads', maxThreads.toString());
    }

    // Prepare search term - handle escape sequences
    let searchTerm = highlight.searchTerm;
    let useRegexMode = highlight.isRegex;

    // If the search contains escape sequences in non-regex mode, convert to regex
    if (hasEscapeSequences(searchTerm) && !highlight.isRegex) {
        // Use escape sequence handler
        searchTerm = buildRegexPatternWithEscapeSequences(searchTerm, highlight.isWholeWord);
        useRegexMode = true;
        args.push('--multiline');
    } else if (hasEscapeSequences(searchTerm) && highlight.isRegex) {
        // In regex mode, enable multiline for escape sequences
        args.push('--multiline');
    }

    if (!highlight.isCaseSensitive) {
        args.push('--ignore-case');
    }

    if (highlight.isWholeWord) {
        args.push('--word-regexp');
    }

    if (useRegexMode) {
        args.push('-e', searchTerm);
    } else {
        args.push('--fixed-strings', '-e', searchTerm);
    }

    args.push(filePath);

    // Debug logging (only in development)
    // 

    // Spawn ripgrep process with environment variables for macOS compatibility
    const rgProcess = cp.spawn(RG_PATH, args, {
        env: { ...process.env }
    });

    let stdoutBuffer = '';
    const lineMatches: LineMatch[] = [];
    let count = 0;

    // Process stdout data
    rgProcess.stdout.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.trim()) continue;

            try {
                const result = JSON.parse(line);

                if (result.type === 'match') {
                    const data = result.data;
                    const lineNum = data.line_number;
                    const lineText = data.lines.text.trimEnd();

                    // Process all submatches on this line
                    for (const submatch of data.submatches) {
                        // Convert byte offsets to character offsets for proper handling of multi-byte chars
                        const matchStartChar = byteOffsetToCharOffset(lineText, submatch.start);
                        const matchEndChar = byteOffsetToCharOffset(lineText, submatch.end);

                        count++;

                        // Create context snippet
                        const maxLength = 150;
                        let snippet = lineText;
                        let snippetMatchStart = matchStartChar;
                        let snippetMatchEnd = matchEndChar;
                        if (snippet.length > maxLength) {
                            const start = Math.max(0, matchStartChar - 50);
                            const end = Math.min(snippet.length, matchEndChar + 50);
                            const prefix = start > 0 ? '...' : '';
                            snippet = prefix + snippet.substring(start, end) + (end < lineText.length ? '...' : '');
                            // Adjust match positions relative to the snippet
                            snippetMatchStart = matchStartChar - start + prefix.length;
                            snippetMatchEnd = matchEndChar - start + prefix.length;
                        }

                        lineMatches.push({
                            line: lineNum,
                            column: matchStartChar,
                            lineText: snippet,
                            matchStart: snippetMatchStart,
                            matchEnd: snippetMatchEnd
                        });
                    }
                }
            } catch (parseError) {
                // Ignore parse errors
            }
        }
    });

    // Wait for process to complete
    await new Promise<void>((resolve) => {
        rgProcess.on('close', () => {
            const docUri = document.uri.toString();

            if (count > 0) {
                // Update or add the file match
                highlight.fileMatches?.set(docUri, count);

                // Update file match details
                if (highlight.fileMatchDetails) {
                    const existingIndex = highlight.fileMatchDetails.findIndex(f => f.filePath === relativePath);
                    if (existingIndex >= 0) {
                        // Update existing entry
                        highlight.fileMatchDetails[existingIndex] = {
                            filePath: relativePath,
                            matchCount: count,
                            lines: lineMatches
                        };
                    } else {
                        // Add new entry
                        highlight.fileMatchDetails.push({
                            filePath: relativePath,
                            matchCount: count,
                            lines: lineMatches
                        });
                    }
                }
            } else {
                // No matches - remove from results
                highlight.fileMatches?.delete(docUri);
                if (highlight.fileMatchDetails) {
                    highlight.fileMatchDetails = highlight.fileMatchDetails.filter(f => f.filePath !== relativePath);
                }
            }

            // Update webview
            deps.webviewProvider.updateWebview();
            resolve();
        });

        rgProcess.on('error', (error) => {
            console.error(`Ripgrep error updating file ${filePath}: ${error}`);
            resolve();
        });
    });
}
