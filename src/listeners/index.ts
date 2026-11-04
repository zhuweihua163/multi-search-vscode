import * as vscode from 'vscode';
import * as path from 'path';
import { SearchHighlight } from '../types';
import { shouldSearchInFile } from '../search';

/**
 * Interface for event listener dependencies.
 * All handlers are passed in from extension.ts to maintain current functionality.
 */
export interface ListenerDependencies {
    searchHighlights: Map<string, SearchHighlight>;
    searchMatchIndices: Map<string, number>;
    webviewProvider: any;  // MultipleFindViewProvider instance
    updateAllDecorations: (skipWebviewUpdate?: boolean) => Promise<void>;
    updateFileSearchForDocument: (document: vscode.TextDocument, highlight: SearchHighlight, useDocumentText?: boolean) => Promise<void>;
}

/**
 * Registers all event listeners for the MultiSearch extension.
 * Uses dependency injection to receive handlers from the main extension.
 *
 * @param context - VSCode extension context for subscriptions
 * @param deps - Object containing all dependencies needed by event listeners
 */
export function registerEventListeners(
    context: vscode.ExtensionContext,
    deps: ListenerDependencies
): void {
    const pendingDocumentUpdates = new Map<string, ReturnType<typeof setTimeout>>();

    context.subscriptions.push({
        dispose: () => {
            pendingDocumentUpdates.forEach(timer => clearTimeout(timer));
            pendingDocumentUpdates.clear();
        }
    });

    // Update decorations when active editor changes
    vscode.window.onDidChangeActiveTextEditor(async editor => {
        if (editor) {
            // Update decorations - this will also update currentFileName for local searches
            // Don't skip webview update here, we need the updated currentFileName to be reflected
            await deps.updateAllDecorations(false);

            // Update current match index for all searches when changing files
            const currentFilePath = editor.document.uri.fsPath;
            const currentLine = editor.selection.active.line + 1;

            deps.searchHighlights.forEach((highlight, searchId) => {
                // For file searches, update to the first match in the current file
                if (highlight.filePath && highlight.fileMatchDetails) {
                    const allMatches: {filePath: string, line: number}[] = [];
                    highlight.fileMatchDetails.forEach(fileDetail => {
                        fileDetail.lines.forEach(lineMatch => {
                            allMatches.push({
                                filePath: fileDetail.filePath,
                                line: lineMatch.line
                            });
                        });
                    });

                    // Reset to 0 if no matches at all
                    if (allMatches.length === 0) {
                        highlight.currentMatchIndex = 0;
                    } else {
                        // Find the first match in the current file
                        let foundMatch = false;
                        for (let i = 0; i < allMatches.length; i++) {
                            const match = allMatches[i];
                            // Check if the file path matches (normalize paths for comparison)
                            const normalizedCurrentPath = path.normalize(currentFilePath);
                            const normalizedMatchPath = path.normalize(match.filePath);
                            const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
                            const relativeCurrentPath = workspaceFolder ? path.relative(workspaceFolder.uri.fsPath, normalizedCurrentPath) : normalizedCurrentPath;

                            if (normalizedMatchPath === relativeCurrentPath || normalizedMatchPath === normalizedCurrentPath) {
                                deps.searchMatchIndices.set(searchId, i);
                                highlight.currentMatchIndex = i + 1;
                                foundMatch = true;
                                break;
                            }
                        }
                        // If no match in current file but matches exist elsewhere, show first match
                        if (!foundMatch) {
                            deps.searchMatchIndices.set(searchId, 0);
                            highlight.currentMatchIndex = 1;
                        }
                    }
                }
                // For current file searches, find closest match to cursor position
                else if (highlight.currentFileMatches && highlight.currentFileMatches.length > 0) {
                    let closestIndex = 0;
                    for (let i = 0; i < highlight.currentFileMatches.length; i++) {
                        const match = highlight.currentFileMatches[i];
                        if (match.line >= currentLine) {
                            closestIndex = i;
                            break;
                        }
                        closestIndex = i;
                    }
                    deps.searchMatchIndices.set(searchId, closestIndex);
                    highlight.currentMatchIndex = closestIndex + 1;
                }
                // If no matches at all, reset to 0
                else {
                    highlight.currentMatchIndex = 0;
                }
            });

            // Update webview to show updated match indices
            deps.webviewProvider.updateWebview();
        }
    }, null, context.subscriptions);

    // Debounce document updates so typing does not trigger a search for every character
    vscode.workspace.onDidChangeTextDocument(event => {
        const document = event.document;
        if (!vscode.workspace.getWorkspaceFolder(document.uri)) return;

        const documentKey = document.uri.toString();
        const pendingTimer = pendingDocumentUpdates.get(documentKey);
        if (pendingTimer) clearTimeout(pendingTimer);

        const timer = setTimeout(async () => {
            pendingDocumentUpdates.delete(documentKey);

            try {
                if (vscode.window.activeTextEditor?.document === document) {
                    await deps.updateAllDecorations();
                }

                const docUri = document.uri.toString();
                const updates = Array.from(deps.searchHighlights.values())
                    .filter(highlight => highlight.filePath &&
                        ((highlight.fileMatches && highlight.fileMatches.has(docUri)) ||
                            shouldSearchInFile(document.uri, highlight.filePath)))
                    .map(highlight => deps.updateFileSearchForDocument(document, highlight, true));

                await Promise.all(updates);
            } catch (error) {
                console.error(`Failed to refresh search results after editing ${document.uri}: ${error}`);
                vscode.window.showErrorMessage(`Failed to refresh search results: ${error}`);
            }
        }, 500);

        pendingDocumentUpdates.set(documentKey, timer);
    }, null, context.subscriptions);

    // Update search results when a file is saved
    vscode.workspace.onDidSaveTextDocument(async document => {
        const documentKey = document.uri.toString();
        const pendingTimer = pendingDocumentUpdates.get(documentKey);
        if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingDocumentUpdates.delete(documentKey);
        }

        if (vscode.window.activeTextEditor?.document === document) {
            await deps.updateAllDecorations();
        }

        // Update file search results if the saved document matches any file search patterns
        const updates: Promise<void>[] = [];
        deps.searchHighlights.forEach(highlight => {
            if (highlight.filePath) {
                // Check if this document is part of the search results or should be searched
                const docUri = document.uri.toString();
                if ((highlight.fileMatches && highlight.fileMatches.has(docUri)) || shouldSearchInFile(document.uri, highlight.filePath)) {
                    // Re-search this specific file
                    updates.push(deps.updateFileSearchForDocument(document, highlight));
                }
            }
        });
        await Promise.all(updates);
    }, null, context.subscriptions);

    // Update file search results when new files are created (from VSCode)
    vscode.workspace.onDidCreateFiles(async event => {
        for (const fileUri of event.files) {
            deps.searchHighlights.forEach(async (highlight) => {
                if (highlight.filePath && shouldSearchInFile(fileUri, highlight.filePath)) {
                    // Open the document and search it
                    try {
                        const document = await vscode.workspace.openTextDocument(fileUri);
                        await deps.updateFileSearchForDocument(document, highlight);
                    } catch (error) {
                        console.error(`Error searching new file ${fileUri}: ${error}`);
                    }
                }
            });
        }
    }, null, context.subscriptions);

    // Watch for external file changes (files created/modified outside VSCode)
    if (vscode.workspace.workspaceFolders) {
        vscode.workspace.workspaceFolders.forEach(folder => {
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(folder, '**/*')
            );

            // Handle file creation (from terminal, file manager, etc)
            watcher.onDidCreate(async (uri) => {
                deps.searchHighlights.forEach(async (highlight) => {
                    if (highlight.filePath && shouldSearchInFile(uri, highlight.filePath)) {
                        try {
                            const document = await vscode.workspace.openTextDocument(uri);
                            await deps.updateFileSearchForDocument(document, highlight);
                        } catch (error) {
                            console.error(`Error searching created file ${uri}: ${error}`);
                        }
                    }
                });
            });

            // Handle file changes (when content is written from terminal)
            watcher.onDidChange(async (uri) => {
                deps.searchHighlights.forEach(async (highlight) => {
                    if (highlight.filePath && shouldSearchInFile(uri, highlight.filePath)) {
                        try {
                            const document = await vscode.workspace.openTextDocument(uri);
                            await deps.updateFileSearchForDocument(document, highlight);
                        } catch (error) {
                            console.error(`Error searching changed file ${uri}: ${error}`);
                        }
                    }
                });
            });

            // Handle file deletion
            watcher.onDidDelete(async (uri) => {
                deps.searchHighlights.forEach((highlight) => {
                    if (highlight.filePath) {
                        const docUri = uri.toString();
                        // Remove from results
                        highlight.fileMatches?.delete(docUri);
                        if (highlight.fileMatchDetails) {
                            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                            if (workspaceFolder) {
                                const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
                                highlight.fileMatchDetails = highlight.fileMatchDetails.filter(f => f.filePath !== relativePath);
                            }
                        }
                    }
                });
                deps.webviewProvider.updateWebview();
            });

            context.subscriptions.push(watcher);
        });
    }
}
