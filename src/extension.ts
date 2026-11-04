import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

// Import types and utilities from new module structure
import { LineMatch, SearchHighlight } from './types';
import { COLORS, openFileFromPath, byteOffsetToCharOffset } from './utils';
import { createRegex, getRipgrepExcludeGlobs, initSearchOperations, updateDecorations, updateAllDecorations, searchInFiles, updateFileSearchForDocument, updateDecorationsInMemory, isExcludedByWorkspaceSettings, shouldExcludeFile } from './search';
import { createSearchDecorations } from './core';
import { getHighlightedLine, MultipleFindViewProvider, WebviewProviderDependencies, createPreviewDecorationType, createNavigationButtons, updateQuickPickButtons, isButtonClick } from './ui';
import { registerCommands, CommandHandlers } from './commands';
import { registerEventListeners, ListenerDependencies } from './listeners';
import { RG_PATH } from './utils/constants';


let searchHighlights: Map<string, SearchHighlight> = new Map();
let nextHighlightId = 0;
let webviewProvider: MultipleFindViewProvider;
let previewDecorationType: vscode.TextEditorDecorationType | undefined;

// QuickPick navigation state for F3/Shift+F3 support
let activeQuickPickNavigator: (() => void) | undefined;
let activeQuickPickNavigatorPrev: (() => void) | undefined;
let activeQuickPickAcceptor: (() => void) | undefined;

// Verify ripgrep is available
async function verifyRipgrep(): Promise<boolean> {
    return new Promise((resolve) => {
        // Spawn with explicit environment to ensure PATH is available
        const testProcess = cp.spawn(RG_PATH, ['--version'], {
            env: process.env,
            shell: false
        });

        testProcess.on('close', (code) => {
            if (code === 0) {
                
                resolve(true);
            } else {
                console.warn(`MultiSearch: ripgrep verification failed with exit code ${code}`);
                resolve(false);
            }
        });

        testProcess.on('error', (err: any) => {
            console.warn(`MultiSearch: ripgrep verification error: ${err.message}`);
            resolve(false);
        });
    });
}

export function activate(context: vscode.ExtensionContext) {
    

    // Verify ripgrep is available
    verifyRipgrep().then((isAvailable) => {
        if (!isAvailable) {
            vscode.window.showWarningMessage(
                'MultiSearch: ripgrep (rg) not found. Please install ripgrep for file search functionality. ' +
                'Install via: apt install ripgrep (Linux), brew install ripgrep (macOS), choco install ripgrep (Windows) or winget install BurntSushi.ripgrep.MSVC',
                'Learn More'
            ).then(selection => {
                if (selection === 'Learn More') {
                    vscode.env.openExternal(vscode.Uri.parse('https://github.com/BurntSushi/ripgrep#installation'));
                }
            });
        }
    });

    // Create and register the webview view provider
    // Create dependencies object for the webview provider
    const webviewDependencies: WebviewProviderDependencies = {
        searchHighlights,
        addSearchFromWebview,
        removeHighlight,
        togglePauseHighlight,
        clearAllHighlights,
        saveSearchesToFile,
        loadSearchesFromFile,
        resetAllFilters,
        toggleSearchFilter,
        updateSearchText,
        updateFilePath,
        updateExcludePath,
        replaceAllMatches,
        updatePreviewHighlight,
        clearPreviewHighlight,
        openFileFromPath,
        showPeekPreview,
        sendCodePreview,
        sendCodePreviewCurrentFile,
        goToLineInCurrentFile,
        navigateToSearchMatch,
        reorderSearch,
        mergeSearches,
        changeSearchColor
    };

    webviewProvider = new MultipleFindViewProvider(context.extensionUri, webviewDependencies);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('multiSearchPanel', webviewProvider)
    );

    // Initialize search operations module with dependencies
    initSearchOperations({
        searchHighlights,
        searchMatchIndices,
        webviewProvider
    });

    // Register all commands
    const commandHandlers: CommandHandlers = {
        addSearchHighlight,
        addSelectionToFind,
        addGlobalSearch,
        addSelectionToGlobalSearch,
        findInFolder,
        clearAllHighlights,
        removeHighlight,
        goToNextMatch,
        goToPreviousMatch
    };
    registerCommands(context, commandHandlers);

    // Register all event listeners
    const listenerDependencies: ListenerDependencies = {
        searchHighlights,
        searchMatchIndices,
        webviewProvider,
        updateAllDecorations,
        updateFileSearchForDocument
    };
    registerEventListeners(context, listenerDependencies);

    // Register QuickPick navigation commands for F3/Shift+F3
    context.subscriptions.push(
        vscode.commands.registerCommand('multi-search.quickPickGoToNextMatch', () => {
            quickPickGoToNextMatch();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('multi-search.quickPickGoToPreviousMatch', () => {
            quickPickGoToPreviousMatch();
        })
    );

    // Register QuickPick accept command for Shift+Enter when enterNavigatesMatches is enabled
    context.subscriptions.push(
        vscode.commands.registerCommand('multi-search.quickPickAccept', () => {
            quickPickAccept();
        })
    );
}

async function addSearchHighlight() {
    // Instead of just opening the panel, open a QuickPick for current file search
    // This provides the same experience as Ctrl+F with selection, but starts with empty input
    await addSelectionToFind();
}

async function addGlobalSearch() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    // Just call addSelectionToGlobalSearch with no selection
    await addSelectionToGlobalSearch();
}

async function addSelectionToGlobalSearch() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    // Get workspace root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showWarningMessage('No workspace folder open');
        return;
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);

    // Check if text contains newlines
    const hasNewlines = selectedText.includes('\n');
    const lineCount = hasNewlines ? selectedText.split('\n').length : 0;

    // Store the original selected text (with newlines) since QuickPick.value strips them
    const originalMultilineText = hasNewlines ? selectedText : null;

    // Create quick pick with live preview and navigation (works with or without selection)
    const quickPick = vscode.window.createQuickPick();
    quickPick.title = hasNewlines ? `Add Global Search Term (${lineCount} lines selected - Press Enter to use)` : 'Add Global Search Term';
    quickPick.placeholder = hasNewlines ? 'Press Enter to search with original multiline selection...' : 'Enter search term...';
    quickPick.value = selectedText;

    let currentMatchIndex = 0;
    let matches: {line: number, column: number, matchEnd: number, text: string, file: string}[] = [];
    let previewDecorationType = createPreviewDecorationType();
    let cachedMatchData: LineMatch[] = []; // Store ripgrep results to reuse when adding search
    let currentSearchProcess: cp.ChildProcess | undefined; // Track current ripgrep process
    let lastSearchText = ''; // Track last search to avoid duplicates

    // Navigation buttons
    const buttons = createNavigationButtons();

    // Function to update navigation buttons with current match info
    const updateButtons = () => {
        updateQuickPickButtons(quickPick, 'Add Global Search Term', currentMatchIndex, matches.length, buttons);
    };

    // Function to find and highlight matches using ripgrep
    const updateMatches = async (searchText: string) => {
        if (!editor || !searchText) {
            if (previewDecorationType) {
                editor.setDecorations(previewDecorationType, []);
            }
            matches = [];
            cachedMatchData = [];
            lastSearchText = '';
            quickPick.items = [{ label: 'No matches found' }];
            return;
        }

        // Skip if same search is already running or completed
        if (searchText === lastSearchText) {
            return;
        }

        // Kill any existing search process
        if (currentSearchProcess) {
            currentSearchProcess.kill();
            currentSearchProcess = undefined;
        }

        lastSearchText = searchText;
        matches = [];
        cachedMatchData = [];
        const decorations: vscode.DecorationOptions[] = [];

        try {
            // Build ripgrep arguments for global search - optimized for performance
            const args: string[] = [
                '--json',
                '--line-number',
                '--column',
                '--no-heading',
                '--no-ignore',               // Search in files ignored by .gitignore
                '--color', 'never',
                '--mmap',                    // Use memory-mapped I/O for faster file access
                '--block-buffered',          // Block buffering for better throughput
                '--fixed-strings',
                '--ignore-case', // Always case insensitive for quick pick
                '--glob', '!**/node_modules/**',
                '--glob', '!**/.git/**'
            ];
            for (const excludeGlob of getRipgrepExcludeGlobs(vscode.Uri.file(workspaceRoot))) {
                args.push('--glob', excludeGlob);
            }
            args.push('-e', searchText, '.'); // Search in current directory (workspace root)

            // Add threads configuration
            const maxThreads = vscode.workspace.getConfiguration('multiSearch').get<number>('maxThreads', 0);
            if (maxThreads > 0) {
                args.push('--threads', maxThreads.toString());
            }

            // Spawn ripgrep process
            const rgProcess = cp.spawn(RG_PATH, args, { cwd: workspaceRoot });
            currentSearchProcess = rgProcess;
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
                            const filePath = data.path.text;
                            const lineNum = data.line_number;
                            const lineText = data.lines.text.trimEnd();

                            // Process all submatches on this line
                            for (const submatch of data.submatches) {
                                // Convert byte offsets to character offsets for proper handling of multi-byte chars
                                const matchStartChar = byteOffsetToCharOffset(lineText, submatch.start);
                                const matchEndChar = byteOffsetToCharOffset(lineText, submatch.end);

                                // Add to matches for navigation
                                matches.push({
                                    line: lineNum,
                                    column: matchStartChar,
                                    matchEnd: matchEndChar,
                                    text: lineText,
                                    file: filePath
                                });

                                // Cache match data for reuse when adding search
                                cachedMatchData.push({
                                    line: lineNum,
                                    column: matchStartChar,
                                    lineText: lineText,
                                    matchStart: matchStartChar,
                                    matchEnd: matchEndChar
                                });

                                // Only create decorations for current file
                                if (filePath === editor.document.uri.fsPath ||
                                    path.join(workspaceRoot, filePath) === editor.document.uri.fsPath) {
                                    const startPos = new vscode.Position(lineNum - 1, matchStartChar);
                                    const endPos = new vscode.Position(lineNum - 1, matchEndChar);
                                    decorations.push({ range: new vscode.Range(startPos, endPos) });
                                }
                            }
                        }
                    } catch (parseError) {
                        // Ignore parse errors
                    }
                }
            });

            // Wait for process to complete
            await new Promise<void>((resolve) => {
                rgProcess.on('close', async () => {
                    // Clear process reference
                    if (currentSearchProcess === rgProcess) {
                        currentSearchProcess = undefined;
                    }

                    const samePath = (left: string, right: string) => {
                        const normalizedLeft = path.normalize(path.resolve(left));
                        const normalizedRight = path.normalize(path.resolve(right));
                        return process.platform === 'win32'
                            ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
                            : normalizedLeft === normalizedRight;
                    };

                    for (const document of vscode.workspace.textDocuments) {
                        if (!document.isDirty) continue;

                        const documentWorkspace = vscode.workspace.getWorkspaceFolder(document.uri);
                        if (!documentWorkspace || !samePath(documentWorkspace.uri.fsPath, workspaceRoot)) continue;

                        const documentPath = document.uri.fsPath;
                        matches = matches.filter(match => !samePath(path.resolve(workspaceRoot, match.file), documentPath));

                        if (isExcludedByWorkspaceSettings(document.uri) ||
                            shouldExcludeFile(document.uri, '**/node_modules/**,**/.git/**')) {
                            continue;
                        }

                        const documentMatches: LineMatch[] = [];
                        await updateDecorationsInMemory(document, {
                            id: '',
                            searchTerm: searchText,
                            decorationType: previewDecorationType,
                            color: '',
                            isRegex: false,
                            isCaseSensitive: false,
                            isWholeWord: false
                        }, [], documentMatches);

                        const relativePath = path.relative(workspaceRoot, documentPath);
                        for (const match of documentMatches) {
                            matches.push({
                                line: match.line,
                                column: match.column,
                                matchEnd: match.matchEnd,
                                text: match.lineText,
                                file: relativePath
                            });
                        }
                    }

                    decorations.length = 0;
                    for (const match of matches) {
                        if (!samePath(path.resolve(workspaceRoot, match.file), editor.document.uri.fsPath)) continue;
                        const start = new vscode.Position(match.line - 1, match.column);
                        const end = new vscode.Position(match.line - 1, match.matchEnd);
                        decorations.push({ range: new vscode.Range(start, end) });
                    }

                    editor.setDecorations(previewDecorationType, decorations);

                    // Update quick pick items
                    if (matches.length > 0) {
                        quickPick.items = [
                            {
                                label: `$(search) ${matches.length} matches found in workspace`,
                                description: 'Press Enter to add search, use ↑/↓ to navigate'
                            }
                        ];
                        // Update buttons with new match count
                        currentMatchIndex = 0;
                        updateButtons();
                    } else {
                        quickPick.items = [{ label: 'No matches found' }];
                        updateButtons();
                    }
                    resolve();
                });

                rgProcess.on('error', (error) => {
                    // Clear process reference
                    if (currentSearchProcess === rgProcess) {
                        currentSearchProcess = undefined;
                    }
                    console.error(`ripgrep error: ${error}`);
                    quickPick.items = [{ label: 'Search error' }];
                    resolve();
                });
            });
        } catch (error) {
            quickPick.items = [{ label: 'Invalid search pattern' }];
        }
    };

    // Function to find the nearest match to current cursor position and file
    const findNearestMatch = () => {
        if (matches.length === 0) return -1;

        const currentFile = editor.document.uri.fsPath;
        const cursorPosition = editor.selection.active;
        const cursorLine = cursorPosition.line + 1; // matches use 1-based line numbers
        const cursorColumn = cursorPosition.character;

        let nearestIndex = 0;
        let minDistance = Infinity;

        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            const matchFile = path.join(workspaceRoot, match.file);

            // Prefer matches in the current file
            const fileDistance = (matchFile === currentFile) ? 0 : 1000000;
            const lineDiff = Math.abs(match.line - cursorLine);
            const columnDiff = match.line === cursorLine ? Math.abs(match.column - cursorColumn) : 0;
            const distance = fileDistance + lineDiff * 10000 + columnDiff;

            if (distance < minDistance) {
                minDistance = distance;
                nearestIndex = i;
            }
        }

        return nearestIndex;
    };

    // Function to navigate to a specific match
    const navigateToMatch = async (index: number) => {
        if (matches.length === 0) return;

        currentMatchIndex = ((index % matches.length) + matches.length) % matches.length;
        const match = matches[currentMatchIndex];

        // Open the file if it's not the current file
        const matchFilePath = path.join(workspaceRoot, match.file);
        if (matchFilePath !== editor.document.uri.fsPath) {
            try {
                const document = await vscode.workspace.openTextDocument(matchFilePath);
                await vscode.window.showTextDocument(document, { preview: true, preserveFocus: true });
            } catch (error) {
                console.error(`Failed to open file: ${error}`);
                return;
            }
        }

        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const position = new vscode.Position(match.line - 1, match.column);
            activeEditor.selection = new vscode.Selection(position, position);
            activeEditor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }

        // Update buttons to show current position
        updateButtons();
    };

    // Initialize navigation buttons
    updateButtons();
    // Set up F3/Shift+F3 navigation for global search
    activeQuickPickNavigator = () => navigateToMatch(currentMatchIndex + 1);
    activeQuickPickNavigatorPrev = () => navigateToMatch(currentMatchIndex - 1);

    // Function to accept/save the search
    const acceptSearch = async () => {
        // Use the original multiline text if available (QuickPick strips newlines)
        const searchText = originalMultilineText || quickPick.value;
        if (searchText) {
            // Open the MultiSearch panel first
            await vscode.commands.executeCommand('multiSearchPanel.focus');

            // Add the search with global path "."
            await addSearchFromWebview(searchText, false, false, false, '.', undefined, workspaceRoot, cachedMatchData);
            webviewProvider.updateWebview();
        }
        quickPick.hide();
    };

    // Set up acceptor for Shift+Enter when enterNavigatesMatches is enabled
    activeQuickPickAcceptor = acceptSearch;

    // Initial update
    updateMatches(selectedText);

    // Debounce timer for auto-navigation
    let navigationTimeout: NodeJS.Timeout | undefined;

    // Handle value changes
    quickPick.onDidChangeValue(value => {
        updateMatches(value);
        currentMatchIndex = 0;

        // Clear existing timer
        if (navigationTimeout) {
            clearTimeout(navigationTimeout);
        }

        // Only navigate if there's text and matches
        if (value && matches.length > 0) {
            // Navigate to nearest match after 0.5 seconds of no typing
            navigationTimeout = setTimeout(() => {
                const nearestIndex = findNearestMatch();
                if (nearestIndex !== -1) {
                    navigateToMatch(nearestIndex);
                }
            }, 500);
        }
    });

    // Handle button clicks
    quickPick.onDidTriggerButton(button => {
        // Check button by icon ID since we recreate buttons on each update
        const iconId = (button.iconPath as vscode.ThemeIcon)?.id;
        if (iconId === 'arrow-up') {
            navigateToMatch(currentMatchIndex - 1);
        } else if (iconId === 'arrow-down') {
            navigateToMatch(currentMatchIndex + 1);
        }
    });

    // Handle selection (Enter key)
    quickPick.onDidAccept(async () => {
        const enterNavigatesMatches = vscode.workspace.getConfiguration('multiSearch').get<boolean>('enterNavigatesMatches', false);
        if (enterNavigatesMatches) {
            // Enter navigates to next match when this setting is enabled
            navigateToMatch(currentMatchIndex + 1);
        } else {
            // Default behavior: Enter saves the search
            await acceptSearch();
        }
    });

    // Cleanup on hide
    quickPick.onDidHide(() => {
        // Clear F3/Shift+F3 navigation functions and acceptor
        activeQuickPickNavigator = undefined;
        activeQuickPickNavigatorPrev = undefined;
        activeQuickPickAcceptor = undefined;
        // Clear navigation timeout
        if (navigationTimeout) {
            clearTimeout(navigationTimeout);
        }
        if (previewDecorationType) {
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                activeEditor.setDecorations(previewDecorationType, []);
            }
            previewDecorationType.dispose();
        }
        quickPick.dispose();
    });

    quickPick.show();
}

async function findInFolder(uri: vscode.Uri) {
    if (!uri) {
        vscode.window.showWarningMessage('No folder selected');
        return;
    }

    // Open the MultiSearch panel
    await vscode.commands.executeCommand('multiSearchPanel.focus');

    // Get relative path from workspace
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    let relativePath = uri.fsPath;
    let workspaceRoot = '';

    if (workspaceFolder) {
        relativePath = uri.fsPath.substring(workspaceFolder.uri.fsPath.length + 1);
        workspaceRoot = workspaceFolder.uri.fsPath;
    }

    // Set the path pattern to search in this folder
    // Use just /** (not /**/*) for proper ripgrep glob matching
    const globPattern = `${relativePath}/**`;

    // Send message to webview to set the path and workspace root, and expand file filters
    webviewProvider.setFilePath(globPattern, workspaceRoot, true);

    // Focus the search input
    setTimeout(() => {
        webviewProvider.focusInput();
    }, 100);
}

async function addSelectionToFind() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);

    // Check if text contains newlines
    const hasNewlines = selectedText.includes('\n');
    const lineCount = hasNewlines ? selectedText.split('\n').length : 0;

    // Store the original selected text (with newlines) since QuickPick.value strips them
    const originalMultilineText = hasNewlines ? selectedText : null;

    // Create quick pick with live preview and navigation (works with or without selection)
    const quickPick = vscode.window.createQuickPick();
    quickPick.title = hasNewlines ? `Add Search Term (${lineCount} lines selected - Press Enter to use)` : 'Add Search Term';
    quickPick.placeholder = hasNewlines ? 'Press Enter to search with original multiline selection...' : 'Enter search term...';
    quickPick.value = selectedText;

    let currentMatchIndex = 0;
    let matches: {line: number, column: number, text: string}[] = [];
    let previewDecorationType = createPreviewDecorationType();
    let cachedMatchData: LineMatch[] = []; // Store ripgrep results to reuse when adding search
    let currentRgProcess: cp.ChildProcess | undefined; // Track current ripgrep process

    // Navigation buttons
    const buttons = createNavigationButtons();

    // Function to update navigation buttons with current match info
    const updateButtons = () => {
        updateQuickPickButtons(quickPick, 'Add Search Term', currentMatchIndex, matches.length, buttons);
    };

    // Function to find and highlight matches using ripgrep
    const updateMatches = async (searchText: string) => {
        // Kill any existing ripgrep process to prevent duplicate results
        if (currentRgProcess) {
            currentRgProcess.kill();
            currentRgProcess = undefined;
        }

        if (!editor || !searchText) {
            if (previewDecorationType) {
                editor.setDecorations(previewDecorationType, []);
            }
            matches = [];
            cachedMatchData = [];
            quickPick.items = [{ label: 'No matches found' }];
            return;
        }

        matches = [];
        cachedMatchData = [];
        const decorations: vscode.DecorationOptions[] = [];

        try {
            const filePath = editor.document.uri.fsPath;

            // Build ripgrep arguments - optimized for performance
            const args: string[] = [
                '--json',
                '--line-number',
                '--column',
                '--no-heading',
                '--no-ignore',               // Search in files ignored by .gitignore
                '--color', 'never',
                '--mmap',                    // Use memory-mapped I/O for faster file access
                '--fixed-strings',
                '--ignore-case', // Always case insensitive for quick pick
                '-e', searchText,
                filePath
            ];

            // Add threads configuration
            const maxThreads = vscode.workspace.getConfiguration('multiSearch').get<number>('maxThreads', 0);
            if (maxThreads > 0) {
                args.push('--threads', maxThreads.toString());
            }

            // Spawn ripgrep process
            const rgProcess = cp.spawn(RG_PATH, args);
            currentRgProcess = rgProcess;
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

                            // Process all submatches on this line
                            for (const submatch of data.submatches) {
                                // Convert byte offsets to character offsets for proper handling of multi-byte chars
                                const matchStartChar = byteOffsetToCharOffset(lineText, submatch.start);
                                const matchEndChar = byteOffsetToCharOffset(lineText, submatch.end);

                                // Add to matches for navigation
                                matches.push({
                                    line: lineNum,
                                    column: matchStartChar,
                                    text: lineText
                                });

                                // Cache match data for reuse when adding search
                                cachedMatchData.push({
                                    line: lineNum,
                                    column: matchStartChar,
                                    lineText: lineText,
                                    matchStart: matchStartChar,
                                    matchEnd: matchEndChar
                                });

                                // Create decoration
                                const startPos = new vscode.Position(lineNum - 1, matchStartChar);
                                const endPos = new vscode.Position(lineNum - 1, matchEndChar);
                                decorations.push({ range: new vscode.Range(startPos, endPos) });
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
                    // Clear the process reference
                    if (currentRgProcess === rgProcess) {
                        currentRgProcess = undefined;
                    }

                    editor.setDecorations(previewDecorationType, decorations);

                    // Update quick pick items
                    if (matches.length > 0) {
                        quickPick.items = [
                            {
                                label: `$(search) ${matches.length} matches found`,
                                description: 'Press Enter to add search, use ↑/↓ to navigate'
                            }
                        ];
                        // Update buttons with new match count
                        currentMatchIndex = 0;
                        updateButtons();
                    } else {
                        quickPick.items = [{ label: 'No matches found' }];
                        updateButtons();
                    }
                    resolve();
                });

                rgProcess.on('error', (error) => {
                    console.error(`ripgrep error: ${error}`);
                    quickPick.items = [{ label: 'Search error' }];
                    resolve();
                });
            });
        } catch (error) {
            quickPick.items = [{ label: 'Invalid search pattern' }];
        }
    };

    // Function to find the nearest match to current cursor position
    const findNearestMatch = () => {
        if (matches.length === 0) return -1;

        const cursorPosition = editor.selection.active;
        const cursorLine = cursorPosition.line + 1; // matches use 1-based line numbers
        const cursorColumn = cursorPosition.character;

        let nearestIndex = 0;
        let minDistance = Infinity;

        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            // Calculate distance (prioritize line distance, then column)
            const lineDiff = Math.abs(match.line - cursorLine);
            const columnDiff = match.line === cursorLine ? Math.abs(match.column - cursorColumn) : 0;
            const distance = lineDiff * 10000 + columnDiff; // Weight lines heavily

            if (distance < minDistance) {
                minDistance = distance;
                nearestIndex = i;
            }
        }

        return nearestIndex;
    };

    // Function to navigate to a specific match
    const navigateToMatch = (index: number) => {
        if (matches.length === 0) return;

        currentMatchIndex = ((index % matches.length) + matches.length) % matches.length;
        const match = matches[currentMatchIndex];

        const position = new vscode.Position(match.line - 1, match.column);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);

        // Update buttons to show current position
        updateButtons();
    };

    // Initialize navigation buttons
    // Set up F3/Shift+F3 navigation for selection search
    activeQuickPickNavigator = () => navigateToMatch(currentMatchIndex + 1);
    activeQuickPickNavigatorPrev = () => navigateToMatch(currentMatchIndex - 1);

    // Function to accept/save the search
    const acceptSearch = async () => {
        // Use the original multiline text if available (QuickPick strips newlines)
        const searchText = originalMultilineText || quickPick.value;
        if (searchText) {
            // Open the MultiSearch panel first
            await vscode.commands.executeCommand('multiSearchPanel.focus');

            // Add the search
            await addSearchFromWebview(searchText, false, false, false, undefined, undefined, undefined, cachedMatchData);
            webviewProvider.updateWebview();
        }
        quickPick.hide();
    };

    // Set up acceptor for Shift+Enter when enterNavigatesMatches is enabled
    activeQuickPickAcceptor = acceptSearch;

    updateButtons();

    // Initial update
    updateMatches(selectedText);

    // Debounce timer for auto-navigation
    let navigationTimeout: NodeJS.Timeout | undefined;

    // Handle value changes
    quickPick.onDidChangeValue(value => {
        updateMatches(value);
        currentMatchIndex = 0;

        // Clear existing timer
        if (navigationTimeout) {
            clearTimeout(navigationTimeout);
        }

        // Only navigate if there's text and matches
        if (value && matches.length > 0) {
            // Navigate to nearest match after 0.5 seconds of no typing
            navigationTimeout = setTimeout(() => {
                const nearestIndex = findNearestMatch();
                if (nearestIndex !== -1) {
                    navigateToMatch(nearestIndex);
                }
            }, 500);
        }
    });

    // Handle button clicks
    quickPick.onDidTriggerButton(button => {
        // Check button by icon ID since we recreate buttons on each update
        const iconId = (button.iconPath as vscode.ThemeIcon)?.id;
        if (iconId === 'arrow-up') {
            navigateToMatch(currentMatchIndex - 1);
        } else if (iconId === 'arrow-down') {
            navigateToMatch(currentMatchIndex + 1);
        }
    });

    // Handle selection (Enter key)
    quickPick.onDidAccept(async () => {
        const enterNavigatesMatches = vscode.workspace.getConfiguration('multiSearch').get<boolean>('enterNavigatesMatches', false);
        if (enterNavigatesMatches) {
            // Enter navigates to next match when this setting is enabled
            navigateToMatch(currentMatchIndex + 1);
        } else {
            // Default behavior: Enter saves the search
            await acceptSearch();
        }
    });

    // Cleanup on hide
    quickPick.onDidHide(() => {
        // Clear F3/Shift+F3 navigation functions and acceptor
        activeQuickPickNavigator = undefined;
        activeQuickPickNavigatorPrev = undefined;
        activeQuickPickAcceptor = undefined;
        // Clear navigation timeout
        if (navigationTimeout) {
            clearTimeout(navigationTimeout);
        }
        if (previewDecorationType) {
            editor.setDecorations(previewDecorationType, []);
            previewDecorationType.dispose();
        }
        quickPick.dispose();
    });

    quickPick.show();
}

async function showPeekPreview(filePath: string, line: number, workspaceRoot?: string) {
    let fullPath: vscode.Uri;

    // Construct full path
    if (workspaceRoot && workspaceRoot.trim() !== '') {
        fullPath = vscode.Uri.file(path.join(workspaceRoot, filePath));
    } else {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }
        fullPath = vscode.Uri.file(path.join(workspaceFolders[0].uri.fsPath, filePath));
    }

    try {
        const document = await vscode.workspace.openTextDocument(fullPath);
        const position = new vscode.Position(line - 1, 0); // Convert to 0-based
        const location = new vscode.Location(fullPath, position);

        // Show peek preview using the references command
        await vscode.commands.executeCommand('editor.action.peekLocations',
            fullPath,
            position,
            [location],
            'peek'
        );
    } catch (error) {
        console.error(`[MultiSearch] Failed to show peek preview: ${error}`);
    }
}

// Helper function to get syntax-highlighted HTML for a line using VSCode's tokenization
// Code preview with syntax highlighting
async function sendCodePreview(filePath: string, line: number, workspaceRoot: string | undefined, webview: vscode.WebviewView | undefined, mouseX?: number, mouseY?: number) {
    if (!webview) return;

    let fullPath: vscode.Uri;

    // Construct full path
    if (workspaceRoot && workspaceRoot.trim() !== '') {
        fullPath = vscode.Uri.file(path.join(workspaceRoot, filePath));
    } else {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }
        fullPath = vscode.Uri.file(path.join(workspaceFolders[0].uri.fsPath, filePath));
    }

    try {
        // Read the file
        const document = await vscode.workspace.openTextDocument(fullPath);
        const totalLines = document.lineCount;
        const languageId = document.languageId;

        // Load 20 lines before and after the target (40 lines total)
        const contextLines = 20;
        const startLine = Math.max(0, line - 1 - contextLines);
        const endLine = Math.min(totalLines - 1, line - 1 + contextLines);

        const codeLines = [];
        for (let i = startLine; i <= endLine; i++) {
            const lineText = document.lineAt(i).text;
            const highlightedText = await getHighlightedLine(document, i);
            codeLines.push({
                lineNum: i + 1,
                text: lineText,
                highlightedText: highlightedText,
                isTarget: i === line - 1
            });
        }

        // Send the code preview to the webview
        webview.webview.postMessage({
            command: 'showCodePreview',
            filePath: filePath,
            line: line,
            codeLines: codeLines,
            languageId: languageId,
            mouseX: mouseX || 0,
            mouseY: mouseY || 0
        });

    } catch (error) {
        console.error(`[MultiSearch] Failed to get code preview: ${error}`);
    }
}

async function sendCodePreviewCurrentFile(line: number, webview: vscode.WebviewView | undefined, mouseX?: number, mouseY?: number) {
    if (!webview) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        console.error('[MultiSearch] No active editor for preview');
        return;
    }

    try {
        const document = editor.document;
        const totalLines = document.lineCount;
        const filePath = document.uri.fsPath;
        const languageId = document.languageId;

        // Load 20 lines before and after the target (40 lines total)
        const contextLines = 20;
        const startLine = Math.max(0, line - 1 - contextLines);
        const endLine = Math.min(totalLines - 1, line - 1 + contextLines);

        const codeLines = [];
        for (let i = startLine; i <= endLine; i++) {
            const lineText = document.lineAt(i).text;
            const highlightedText = await getHighlightedLine(document, i);
            codeLines.push({
                lineNum: i + 1,
                text: lineText,
                highlightedText: highlightedText,
                isTarget: i === line - 1
            });
        }

        // Send the code preview to the webview
        webview.webview.postMessage({
            command: 'showCodePreview',
            filePath: path.basename(filePath),
            line: line,
            codeLines: codeLines,
            languageId: languageId,
            mouseX: mouseX || 0,
            mouseY: mouseY || 0
        });

    } catch (error) {
        console.error(`[MultiSearch] Failed to get code preview for current file: ${error}`);
    }
}

function goToLineInCurrentFile(line: number) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    if (line > 0) {
        const position = new vscode.Position(line - 1, 0); // Convert to 0-based
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }
}

// Track current match index for each search
const searchMatchIndices = new Map<string, number>();

function navigateToSearchMatch(searchId: string, direction: 'prev' | 'next') {
    const highlight = searchHighlights.get(searchId);
    if (!highlight) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const currentFilePath = editor.document.uri.fsPath;
    const currentLine = editor.selection.active.line + 1; // Convert to 1-based

    // For file searches
    if (highlight.filePath && highlight.fileMatchDetails) {
        const allMatches: {filePath: string, line: number, index: number}[] = [];
        highlight.fileMatchDetails.forEach(fileDetail => {
            fileDetail.lines.forEach(lineMatch => {
                allMatches.push({
                    filePath: fileDetail.filePath,
                    line: lineMatch.line,
                    index: allMatches.length
                });
            });
        });

        if (allMatches.length === 0) return;

        // Find closest match based on current file and position
        let currentIndex = searchMatchIndices.get(searchId);

        if (currentIndex === undefined) {
            // Find the closest match to current position
            let closestIndex = 0;
            let foundInCurrentFile = false;

            for (let i = 0; i < allMatches.length; i++) {
                const match = allMatches[i];
                if (match.filePath === currentFilePath) {
                    foundInCurrentFile = true;
                    if (direction === 'next' && match.line > currentLine) {
                        closestIndex = i;
                        break;
                    } else if (direction === 'prev' && match.line < currentLine) {
                        closestIndex = i;
                    }
                }
            }

            if (!foundInCurrentFile) {
                closestIndex = 0; // Start from beginning if not in current file
            }

            currentIndex = closestIndex;
        } else {
            // Navigate from stored index
            if (direction === 'next') {
                currentIndex = (currentIndex + 1) % allMatches.length;
            } else {
                currentIndex = (currentIndex - 1 + allMatches.length) % allMatches.length;
            }
        }

        searchMatchIndices.set(searchId, currentIndex);
        highlight.currentMatchIndex = currentIndex + 1; // Store 1-based index
        webviewProvider.updateWebview(); // Refresh to show updated counter

        const match = allMatches[currentIndex];
        // Pass the workspace root so files can be opened from different windows
        openFileFromPath(match.filePath, match.line, highlight.workspaceRoot);
    }
    // For current file searches
    else if (highlight.currentFileMatches && highlight.currentFileMatches.length > 0) {
        // Find the closest match based on current cursor position
        let currentIndex = searchMatchIndices.get(searchId);

        if (currentIndex === undefined) {
            // Find closest match to current line
            currentIndex = 0;
            for (let i = 0; i < highlight.currentFileMatches.length; i++) {
                const match = highlight.currentFileMatches[i];
                if (direction === 'next' && match.line > currentLine) {
                    currentIndex = i;
                    break;
                } else if (direction === 'prev' && match.line < currentLine) {
                    currentIndex = i;
                }
            }
        } else {
            // Navigate from stored index
            if (direction === 'next') {
                currentIndex = (currentIndex + 1) % highlight.currentFileMatches.length;
            } else {
                currentIndex = (currentIndex - 1 + highlight.currentFileMatches.length) % highlight.currentFileMatches.length;
            }
        }

        searchMatchIndices.set(searchId, currentIndex);
        highlight.currentMatchIndex = currentIndex + 1; // Store 1-based index
        webviewProvider.updateWebview(); // Refresh to show updated counter

        const match = highlight.currentFileMatches[currentIndex];
        const position = new vscode.Position(match.line - 1, match.column);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }
}

async function addSearchFromWebview(searchTerm: string, isRegex: boolean, isCaseSensitive: boolean, isWholeWord: boolean, filePath?: string, excludePath?: string, workspaceRoot?: string, cachedMatches?: LineMatch[], savedColor?: string, savedIsPaused?: boolean) {
    if (!searchTerm) return;

    // Clear preview before adding
    clearPreviewHighlight();

    // Check if this search term already exists with the same options
    for (const [_, highlight] of searchHighlights) {
        if (highlight.searchTerm === searchTerm &&
            highlight.isRegex === isRegex &&
            highlight.isCaseSensitive === isCaseSensitive &&
            highlight.isWholeWord === isWholeWord &&
            highlight.filePath === filePath &&
            highlight.excludePath === excludePath) {
            // Duplicate found - show a message and return
            vscode.window.showInformationMessage('This search term already exists');
            return;
        }
    }

    const highlightId = `highlight-${nextHighlightId++}`;
    const color = savedColor || COLORS[searchHighlights.size % COLORS.length];

    const decorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: color + '40',
        border: `1px solid ${color}`,
        borderRadius: '2px',
        overviewRulerColor: color,
        overviewRulerLane: vscode.OverviewRulerLane.Center
    });

    // Get default display mode from settings for global searches
    const defaultDisplayMode = filePath
        ? vscode.workspace.getConfiguration('multiSearch').get<'tree' | 'flat'>('defaultDisplayMode', 'tree')
        : undefined;

    const highlight: SearchHighlight = {
        id: highlightId,
        searchTerm,
        decorationType,
        color,
        isRegex,
        isCaseSensitive,
        isWholeWord,
        filePath,
        excludePath,
        workspaceRoot,
        displayMode: defaultDisplayMode,
        isPaused: savedIsPaused || false
    };

    searchHighlights.set(highlightId, highlight);

    // If filePath is provided, search across files
    if (filePath) {
        await searchInFiles(highlight);
        // Also update decorations in the current file
        await updateDecorations(highlight);
    } else {
        // If cached matches provided, use them instead of running ripgrep again
        if (cachedMatches) {
            highlight.currentFileMatches = cachedMatches;

            // Initialize currentMatchIndex
            if (cachedMatches.length > 0) {
                highlight.currentMatchIndex = 1;
                searchMatchIndices.set(highlightId, 0);
            } else {
                highlight.currentMatchIndex = 0;
            }

            // Still need to apply decorations
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                // Set the current file name
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
                if (workspaceFolder) {
                    highlight.currentFileName = path.relative(workspaceFolder.uri.fsPath, editor.document.uri.fsPath);
                } else {
                    highlight.currentFileName = path.basename(editor.document.uri.fsPath);
                }

                const decorations: vscode.DecorationOptions[] = cachedMatches.map(match => {
                    const startPos = new vscode.Position(match.line - 1, match.matchStart);
                    const endPos = new vscode.Position(match.line - 1, match.matchEnd);
                    return { range: new vscode.Range(startPos, endPos) };
                });
                editor.setDecorations(highlight.decorationType, decorations);
            }
        } else {
            // Update decorations in current editor
            await updateDecorations(highlight);
        }
    }

    // Auto-save searches if enabled
    await autoSaveSearches();
}

async function replaceAllMatches(highlightId: string, replaceText: string) {
    const highlight = searchHighlights.get(highlightId);
    if (!highlight) return;

    if (highlight.filePath) {
        // Replace in files
        await replaceInFiles(highlight, replaceText);
    } else {
        // Replace in current editor
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor');
            return;
        }

        const document = editor.document;
        const text = document.getText();
        const regex = createRegex(highlight);

        await editor.edit(editBuilder => {
            let match;
            while ((match = regex.exec(text)) !== null) {
                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + match[0].length);
                editBuilder.replace(new vscode.Range(startPos, endPos), replaceText);
            }
        });

        vscode.window.showInformationMessage('Replaced all matches in current file');
    }

    // Re-run the search to update match counts (should now show 0 matches since we replaced them all)
    // Keep the original search term - don't change it to the replacement text
    if (highlight.filePath) {
        await searchInFiles(highlight);
    } else {
        await updateDecorations(highlight);
    }

    webviewProvider.updateWebview();
}

async function replaceInFiles(highlight: SearchHighlight, replaceText: string) {
    if (!highlight.filePath || !highlight.fileMatches) {
        return;
    }

    let totalReplacements = 0;

    for (const [fileUri, _] of highlight.fileMatches) {
        const uri = vscode.Uri.parse(fileUri);
        const document = await vscode.workspace.openTextDocument(uri);
        const text = document.getText();
        const regex = createRegex(highlight);

        const edit = new vscode.WorkspaceEdit();
        let match;
        while ((match = regex.exec(text)) !== null) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            edit.replace(uri, new vscode.Range(startPos, endPos), replaceText);
            totalReplacements++;
        }

        await vscode.workspace.applyEdit(edit);
    }

    vscode.window.showInformationMessage(`Replaced ${totalReplacements} matches across ${highlight.fileMatches.size} files`);
}

async function updateSearchText(highlightId: string, newText: string) {
    const highlight = searchHighlights.get(highlightId);
    if (!highlight) return;

    // Check if this search term already exists with the same options (excluding the current one)
    for (const [id, existingHighlight] of searchHighlights) {
        if (id !== highlightId &&
            existingHighlight.searchTerm === newText &&
            existingHighlight.isRegex === highlight.isRegex &&
            existingHighlight.isCaseSensitive === highlight.isCaseSensitive &&
            existingHighlight.isWholeWord === highlight.isWholeWord) {
            // Duplicate found - show a message and return without updating
            vscode.window.showInformationMessage('This search term already exists');
            return;
        }
    }

    // Update the search term
    highlight.searchTerm = newText;

    // If there's a file path, re-run the file search with the new term
    if (highlight.filePath) {
        await searchInFiles(highlight);
    }

    // Update the decorations with the new search text
    await updateDecorations(highlight);
    await updateAllDecorations();
}

async function updateFilePath(highlightId: string, newPath: string | undefined) {
    const highlight = searchHighlights.get(highlightId);
    if (!highlight) return;

    

    // Update the file path
    highlight.filePath = newPath;

    // If there's a new path, perform the file search
    if (newPath) {
        await searchInFiles(highlight);
    } else {
        // Clear file search data if path is removed
        highlight.fileMatches = undefined;
        highlight.fileMatchDetails = undefined;
        highlight.workspaceRoot = undefined;

        // Search in the current file instead
        
        await updateDecorations(highlight);
        
    }

    await updateAllDecorations();
}

async function updateExcludePath(highlightId: string, newPath: string | undefined) {
    const highlight = searchHighlights.get(highlightId);
    if (!highlight) return;

    

    // Update the exclude path
    highlight.excludePath = newPath;

    // If there's a file path, re-run the search with the new exclude patterns
    if (highlight.filePath) {
        await searchInFiles(highlight);
    }

    await updateAllDecorations();
}

async function resetAllFilters() {
    const promises: Promise<void>[] = [];
    searchHighlights.forEach(highlight => {
        highlight.isCaseSensitive = false;
        highlight.isWholeWord = false;
        highlight.isRegex = false;
        promises.push(updateDecorations(highlight));
    });
    await Promise.all(promises);
    await updateAllDecorations();
}

async function toggleSearchFilter(highlightId: string, filterType: string) {
    const highlight = searchHighlights.get(highlightId);
    if (!highlight) return;

    switch (filterType) {
        case 'case':
            highlight.isCaseSensitive = !highlight.isCaseSensitive;
            break;
        case 'word':
            highlight.isWholeWord = !highlight.isWholeWord;
            break;
        case 'regex':
            highlight.isRegex = !highlight.isRegex;
            break;
    }

    // If there's a file path, re-run the file search with the new filter settings
    if (highlight.filePath) {
        await searchInFiles(highlight);
    }

    // Update the decorations with the new filter settings
    await updateDecorations(highlight);
    await updateAllDecorations();
}

async function reorderSearch(fromId: string, toId: string) {
    // Convert Map to Array to reorder
    const searchArray = Array.from(searchHighlights.entries());

    // Find indices
    const fromIndex = searchArray.findIndex(([id]) => id === fromId);
    const toIndex = searchArray.findIndex(([id]) => id === toId);

    if (fromIndex === -1 || toIndex === -1) return;

    // Remove the item from the fromIndex
    const [movedItem] = searchArray.splice(fromIndex, 1);

    // Insert at the toIndex
    searchArray.splice(toIndex, 0, movedItem);

    // Rebuild the Map with the new order
    searchHighlights.clear();
    searchArray.forEach(([id, highlight]) => {
        searchHighlights.set(id, highlight);
    });
}

async function mergeSearches(fromId: string, toId: string) {
    const fromHighlight = searchHighlights.get(fromId);
    const toHighlight = searchHighlights.get(toId);

    if (!fromHighlight || !toHighlight) return;

    // Create combined search pattern
    // Ripgrep doesn't support lookaheads, so we combine with OR (|)
    // and will filter to lines with both terms in post-processing
    const fromTerm = fromHighlight.isRegex ? fromHighlight.searchTerm : fromHighlight.searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const toTerm = toHighlight.isRegex ? toHighlight.searchTerm : toHighlight.searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Store both terms for post-processing
    toHighlight.mergedTerms = [fromTerm, toTerm];

    // Use simple OR pattern for ripgrep, we'll filter in post-processing
    const combinedPattern = `${fromTerm}|${toTerm}`;

    // Update the target search with merged pattern
    toHighlight.searchTerm = combinedPattern;
    toHighlight.isRegex = true; // Must use regex for this pattern

    // Remove the source search
    fromHighlight.decorationType.dispose();
    searchHighlights.delete(fromId);

    // Re-run search to update matches with merged pattern
    if (toHighlight.filePath) {
        // Re-run file search with merged pattern
        await searchInFiles(toHighlight);
    } else {
        // Update decorations in current editor
        await updateDecorations(toHighlight);
    }

    await updateAllDecorations();

    // Update the webview to refresh the UI and show matches
    webviewProvider.updateWebview();

    // Auto-save searches if enabled
    await autoSaveSearches();

    vscode.window.showInformationMessage(`Searches merged: now searching for lines containing both terms`);
}

async function removeHighlight(highlightId: string) {
    const highlight = searchHighlights.get(highlightId);
    if (highlight) {
        // Cancel active search process if any
        if (highlight.searchProcess) {
            highlight.searchProcess.kill();
            highlight.searchProcess = undefined;
            highlight.isSearching = false;
        }

        highlight.decorationType.dispose();
        searchHighlights.delete(highlightId);
        await updateAllDecorations();

        // Update webview immediately to reflect removal
        webviewProvider.updateWebview();

        // Auto-save searches if enabled
        await autoSaveSearches();
    }
}

async function togglePauseHighlight(highlightId: string) {
    const highlight = searchHighlights.get(highlightId);
    if (highlight) {
        highlight.isPaused = !highlight.isPaused;
        await updateAllDecorations();
        webviewProvider.updateWebview();

        // Auto-save searches if enabled
        await autoSaveSearches();
    }
}

async function changeSearchColor(highlightId: string, newColor: string) {
    const highlight = searchHighlights.get(highlightId);
    if (highlight) {
        // Update the color
        highlight.color = newColor;

        // Dispose old decoration type
        highlight.decorationType.dispose();

        // Create new decoration type with new color
        highlight.decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: newColor + '40',
            border: `1px solid ${newColor}`,
            borderRadius: '2px',
        });

        // Reapply decorations with new color
        await updateAllDecorations();

        // Auto-save searches if enabled
        await autoSaveSearches();
    }
}

async function clearAllHighlights() {
    searchHighlights.forEach(highlight => {
        // Cancel active search process if any
        if (highlight.searchProcess) {
            highlight.searchProcess.kill();
        }
        highlight.decorationType.dispose();
    });
    searchHighlights.clear();
    await updateAllDecorations();

    // Auto-save searches if enabled
    await autoSaveSearches();
}

async function autoSaveSearches() {
    const config = vscode.workspace.getConfiguration('multiSearch');
    const autoSaveEnabled = config.get<boolean>('autoSave', false);

    if (!autoSaveEnabled) {
        return;
    }

    const fileName = config.get<string>('autoSaveFileName', 'search-filters.json');
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
    }

    const searchesData: any[] = [];

    searchHighlights.forEach((highlight) => {
        searchesData.push({
            searchTerm: highlight.searchTerm,
            isRegex: highlight.isRegex,
            isCaseSensitive: highlight.isCaseSensitive,
            isWholeWord: highlight.isWholeWord,
            filePath: highlight.filePath,
            color: highlight.color,
            isPaused: highlight.isPaused || false
        });
    });

    const jsonContent = JSON.stringify(searchesData, null, 2);
    const filePath = vscode.Uri.joinPath(workspaceFolders[0].uri, fileName);

    try {
        await vscode.workspace.fs.writeFile(filePath, Buffer.from(jsonContent, 'utf8'));
    } catch (error) {
        console.error('Auto-save failed:', error);
    }
}

async function saveSearchesToFile() {
    const searchesData: any[] = [];

    searchHighlights.forEach((highlight) => {
        searchesData.push({
            searchTerm: highlight.searchTerm,
            isRegex: highlight.isRegex,
            isCaseSensitive: highlight.isCaseSensitive,
            isWholeWord: highlight.isWholeWord,
            filePath: highlight.filePath,
            color: highlight.color,
            isPaused: highlight.isPaused || false
        });
    });

    const jsonContent = JSON.stringify(searchesData, null, 2);

    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('search-filters.json'),
        filters: {
            'JSON': ['json']
        }
    });

    if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(jsonContent, 'utf8'));
        vscode.window.showInformationMessage(`Searches saved to ${uri.fsPath}`);
    }
}

async function loadSearchesFromFile() {
    const uri = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: {
            'JSON': ['json']
        },
        openLabel: 'Load Searches'
    });

    if (!uri || uri.length === 0) {
        return;
    }

    try {
        const fileContent = await vscode.workspace.fs.readFile(uri[0]);
        const jsonContent = Buffer.from(fileContent).toString('utf8');
        const searchesData = JSON.parse(jsonContent);

        // Clear existing searches
        clearAllHighlights();

        // Load each search
        for (const searchData of searchesData) {
            await addSearchFromWebview(
                searchData.searchTerm,
                searchData.isRegex || false,
                searchData.isCaseSensitive || false,
                searchData.isWholeWord || false,
                searchData.filePath,
                undefined, // excludePath
                undefined, // workspaceRoot
                undefined, // cachedMatches
                searchData.color,
                searchData.isPaused || false
            );
        }

        vscode.window.showInformationMessage(`Loaded ${searchesData.length} searches from ${uri[0].fsPath}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to load searches: ${error}`);
    }
}

// Helper function to update highlight from file match map
function updatePreviewHighlight(searchTerm: string, isRegex: boolean, isCaseSensitive: boolean, isWholeWord: boolean) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !searchTerm) {
        clearPreviewHighlight();
        return;
    }

    // Clear previous preview decoration
    if (previewDecorationType) {
        previewDecorationType.dispose();
    }

    // Create a preview decoration with a gray color
    previewDecorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: '#808080' + '40',
        border: `1px solid #808080`,
        borderRadius: '2px'
    });

    // Use utility function to create decorations
    const decorations = createSearchDecorations(editor, searchTerm, isRegex, isCaseSensitive, isWholeWord);
    editor.setDecorations(previewDecorationType, decorations);
}

function clearPreviewHighlight() {
    const editor = vscode.window.activeTextEditor;
    if (editor && previewDecorationType) {
        editor.setDecorations(previewDecorationType, []);
        previewDecorationType.dispose();
        previewDecorationType = undefined;
    }
}

function goToNextMatch() {
    // Find the most recent search term (highest ID)
    let latestSearch: SearchHighlight | undefined;
    let latestId = -1;

    searchHighlights.forEach((highlight, id) => {
        const numericId = parseInt(id.replace('highlight-', ''));
        if (numericId > latestId) {
            latestId = numericId;
            latestSearch = highlight;
        }
    });

    if (!latestSearch) {
        vscode.window.showInformationMessage('No active search terms');
        return;
    }

    // Navigate to next match
    navigateToSearchMatch(latestSearch.id, 'next');
}

function goToPreviousMatch() {
    // Find the most recent search term (highest ID)
    let latestSearch: SearchHighlight | undefined;
    let latestId = -1;

    searchHighlights.forEach((highlight, id) => {
        const numericId = parseInt(id.replace('highlight-', ''));
        if (numericId > latestId) {
            latestId = numericId;
            latestSearch = highlight;
        }
    });

    if (!latestSearch) {
        vscode.window.showInformationMessage('No active search terms');
        return;
    }

    // Navigate to previous match
    navigateToSearchMatch(latestSearch.id, 'prev');
}

// QuickPick navigation commands for F3/Shift+F3
function quickPickGoToNextMatch() {
    if (activeQuickPickNavigator) {
        activeQuickPickNavigator();
    }
}

function quickPickGoToPreviousMatch() {
    if (activeQuickPickNavigatorPrev) {
        activeQuickPickNavigatorPrev();
    }
}

function quickPickAccept() {
    if (activeQuickPickAcceptor) {
        activeQuickPickAcceptor();
    }
}

export function deactivate() {
    searchHighlights.forEach(highlight => {
        highlight.decorationType.dispose();
    });
    if (previewDecorationType) {
        previewDecorationType.dispose();
    }
}
