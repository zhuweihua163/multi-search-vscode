import * as vscode from 'vscode';
import { SearchHighlight } from '../types';

/**
 * Interface for the dependencies that MultipleFindViewProvider needs.
 * This enables dependency injection and makes the class testable.
 */
export interface WebviewProviderDependencies {
    searchHighlights: Map<string, SearchHighlight>;
    addSearchFromWebview: (searchTerm: string, isRegex: boolean, isCaseSensitive: boolean, isWholeWord: boolean, filePath?: string, excludePath?: string, workspaceRoot?: string, cachedMatches?: any[]) => Promise<void>;
    removeHighlight: (highlightId: string) => Promise<void>;
    togglePauseHighlight: (highlightId: string) => Promise<void>;
    clearAllHighlights: () => Promise<void>;
    saveSearchesToFile: () => Promise<void>;
    loadSearchesFromFile: () => Promise<void>;
    resetAllFilters: () => void;
    toggleSearchFilter: (highlightId: string, filterType: string) => Promise<void>;
    updateSearchText: (highlightId: string, newText: string) => Promise<void>;
    updateFilePath: (highlightId: string, newPath: string | undefined) => Promise<void>;
    updateExcludePath: (highlightId: string, newPath: string | undefined) => Promise<void>;
    replaceAllMatches: (highlightId: string, replaceText: string) => Promise<void>;
    updatePreviewHighlight: (searchTerm: string, isRegex: boolean, isCaseSensitive: boolean, isWholeWord: boolean) => void;
    clearPreviewHighlight: () => void;
    openFileFromPath: (filePath: string, line: number, workspaceRoot?: string) => Promise<void>;
    showPeekPreview: (filePath: string, line: number, workspaceRoot?: string) => Promise<void>;
    sendCodePreview: (filePath: string, line: number, workspaceRoot: string | undefined, webview: vscode.WebviewView | undefined, mouseX?: number, mouseY?: number) => Promise<void>;
    sendCodePreviewCurrentFile: (line: number, webview: vscode.WebviewView | undefined, mouseX?: number, mouseY?: number) => Promise<void>;
    goToLineInCurrentFile: (line: number) => void;
    navigateToSearchMatch: (searchId: string, direction: 'prev' | 'next') => void;
    reorderSearch: (fromId: string, toId: string) => void;
    mergeSearches: (fromId: string, toId: string) => void;
    changeSearchColor: (highlightId: string, color: string) => void;
}

/**
 * Webview View Provider for the MultiSearch panel.
 * Handles all UI rendering and user interactions in the sidebar webview.
 */
export class MultipleFindViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _knownSearchIds: Set<string> = new Set();
    private _pendingAutoExpand: Set<string> = new Set(); // Searches waiting to auto-expand when finished
    private _pendingFilePath?: { filePath: string; workspaceRoot?: string; expandFilters?: boolean }; // Pending setFilePath call

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly deps: WebviewProviderDependencies
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.command) {
                case 'addSearch':
                    await this.deps.addSearchFromWebview(data.pattern, data.isRegex, data.isCaseSensitive, data.isWholeWord, data.filePath, data.excludePath, data.workspaceRoot);
                    this.updateWebview();
                    break;
                case 'removeSearch':
                    await this.deps.removeHighlight(data.id);
                    break;
                case 'togglePause':
                    await this.deps.togglePauseHighlight(data.id);
                    this.updateWebview();
                    break;
                case 'toggleDisplayMode':
                    this.toggleDisplayMode(data.id);
                    this.updateWebview();
                    break;
                case 'clearAll':
                    await this.deps.clearAllHighlights();
                    this.updateWebview();
                    break;
                case 'saveSearches':
                    await this.deps.saveSearchesToFile();
                    break;
                case 'loadSearches':
                    await this.deps.loadSearchesFromFile();
                    this.updateWebview();
                    break;
                case 'resetAllFilters':
                    this.deps.resetAllFilters();
                    this.updateWebview();
                    break;
                case 'toggleFilter':
                    await this.deps.toggleSearchFilter(data.id, data.filterType);
                    this.updateWebview();
                    break;
                case 'updateSearchText':
                    await this.deps.updateSearchText(data.id, data.newText);
                    this.updateWebview();
                    break;
                case 'updateFilePath':
                    await this.deps.updateFilePath(data.id, data.newPath);
                    this.updateWebview();
                    break;
                case 'updateExcludePath':
                    await this.deps.updateExcludePath(data.id, data.newPath);
                    this.updateWebview();
                    break;
                case 'replaceAll':
                    await this.deps.replaceAllMatches(data.id, data.replaceText);
                    this.updateWebview();
                    break;
                case 'previewSearch':
                    this.deps.updatePreviewHighlight(data.pattern, data.isRegex, data.isCaseSensitive, data.isWholeWord);
                    break;
                case 'clearPreview':
                    this.deps.clearPreviewHighlight();
                    break;
                case 'openFile':
                    await this.deps.openFileFromPath(data.filePath, data.line, data.workspaceRoot);
                    break;
                case 'peekDefinition':
                    
                    await this.deps.showPeekPreview(data.filePath, data.line, data.workspaceRoot);
                    break;
                case 'getCodePreview':
                    await this.deps.sendCodePreview(data.filePath, data.line, data.workspaceRoot, this._view, data.mouseX, data.mouseY);
                    break;
                case 'getCodePreviewCurrentFile':
                    await this.deps.sendCodePreviewCurrentFile(data.line, this._view, data.mouseX, data.mouseY);
                    break;
                case 'goToLine':
                    this.deps.goToLineInCurrentFile(data.line);
                    break;
                case 'navigateMatch':
                    this.deps.navigateToSearchMatch(data.searchId, data.direction);
                    break;
                case 'reorderSearch':
                    this.deps.reorderSearch(data.fromId, data.toId);
                    this.updateWebview();
                    break;
                case 'mergeSearches':
                    this.deps.mergeSearches(data.fromId, data.toId);
                    this.updateWebview();
                    break;
                case 'requestUpdate':
                    this.updateWebview();
                    break;
                case 'changeColor':
                    this.deps.changeSearchColor(data.id, data.color);
                    // Don't refresh the entire webview - the color is already updated in the DOM
                    // this.updateWebview();
                    break;
                case 'showError':
                    vscode.window.showErrorMessage(data.message);
                    break;
            }
        });

        // Send any pending data that was queued before the webview was ready
        setTimeout(() => {
            if (this._pendingFilePath) {
                this.setFilePath(
                    this._pendingFilePath.filePath,
                    this._pendingFilePath.workspaceRoot,
                    this._pendingFilePath.expandFilters
                );
            }
        }, 100);
    }

    public updateWebview() {
        if (this._view) {
            const searches: any[] = [];
            const newSearchIds: string[] = [];
            const autoExpandIds: string[] = []; // Searches that should auto-expand now

            // Track which searches are new (not seen before)
            const currentSearchIds = new Set<string>();

            this.deps.searchHighlights.forEach((highlight) => {
                currentSearchIds.add(highlight.id);
                const isNew = !this._knownSearchIds.has(highlight.id);
                if (isNew) {
                    newSearchIds.push(highlight.id);
                }

                // If this search is currently searching (new or modified global search), queue it for auto-expand when done
                // Only add if it doesn't already have file match details (to avoid re-expanding on file switch)
                if (highlight.isSearching && highlight.filePath && (!highlight.fileMatchDetails || highlight.fileMatchDetails.length === 0)) {
                    this._pendingAutoExpand.add(highlight.id);
                }

                // Check if this search just finished and was pending auto-expand
                if (!highlight.isSearching && this._pendingAutoExpand.has(highlight.id)) {
                    autoExpandIds.push(highlight.id);
                    this._pendingAutoExpand.delete(highlight.id);
                }

                let matchCount = 0;
                let fileMatches: Array<{path: string, count: number}> = [];

                if (highlight.filePath) {
                    // Count total matches across all files (already filtered)
                    if (highlight.fileMatchDetails) {
                        matchCount = highlight.fileMatchDetails.reduce((sum, file) => sum + file.lines.length, 0);
                        
                    }
                    // Also populate fileMatches array for display
                    if (highlight.fileMatches) {
                        highlight.fileMatches.forEach((count, uri) => {
                            // Extract filename from URI
                            const filePath = vscode.Uri.parse(uri).fsPath;
                            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                            let displayPath = filePath;
                            if (workspaceFolder) {
                                displayPath = filePath.substring(workspaceFolder.uri.fsPath.length + 1);
                            }
                            fileMatches.push({ path: displayPath, count });
                        });
                    }
                } else {
                    // Count matches in current editor (use filtered results from currentFileMatches)
                    matchCount = highlight.currentFileMatches?.length || 0;
                    
                }

                const currentIdx = highlight.currentMatchIndex || 0;
                
                searches.push({
                    id: highlight.id,
                    searchTerm: highlight.searchTerm,
                    color: highlight.color,
                    isRegex: highlight.isRegex,
                    isCaseSensitive: highlight.isCaseSensitive,
                    isWholeWord: highlight.isWholeWord,
                    filePath: highlight.filePath,
                    excludePath: highlight.excludePath,
                    workspaceRoot: highlight.workspaceRoot,
                    matchCount: matchCount,
                    fileMatches: fileMatches,
                    fileMatchDetails: highlight.fileMatchDetails || [],
                    currentFileMatches: highlight.currentFileMatches || [],
                    currentFileName: highlight.currentFileName,
                    currentMatchIndex: currentIdx,
                    isSearching: highlight.isSearching || false,
                    isPaused: highlight.isPaused || false,
                    displayMode: highlight.displayMode || 'tree'
                });
            });

            
            searches.forEach(s => {
                if (s.fileMatchDetails && s.fileMatchDetails.length > 0) {
                    
                }
            });

            // Update known search IDs for next time
            this._knownSearchIds = currentSearchIds;

            // Clean up pending auto-expand for removed searches
            for (const id of this._pendingAutoExpand) {
                if (!currentSearchIds.has(id)) {
                    this._pendingAutoExpand.delete(id);
                }
            }

            // Get settings
            const autoExpandResults = vscode.workspace.getConfiguration('multiSearch').get<boolean>('autoExpandResults', true);
            const markVisitedMatches = vscode.workspace.getConfiguration('multiSearch').get<boolean>('markVisitedMatches', true);

            this._view.webview.postMessage({
                command: 'updateSearches',
                searches: searches,
                newSearchIds: newSearchIds,
                autoExpandIds: autoExpandIds, // IDs of searches that should show their file list
                autoExpandResults: autoExpandResults, // Whether to auto-expand folders/files in the list
                markVisitedMatches: markVisitedMatches // Whether to mark clicked matches as visited
            });
        }
    }

    public focusInput() {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'focusInput'
            });
        }
    }

    private toggleDisplayMode(id: string) {
        const highlight = this.deps.searchHighlights.get(id);
        if (highlight) {
            highlight.displayMode = highlight.displayMode === 'flat' ? 'tree' : 'flat';
        }
    }

    public setFilePath(filePath: string, workspaceRoot?: string, expandFilters?: boolean) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'setFilePath',
                filePath: filePath,
                workspaceRoot: workspaceRoot,
                expandFilters: expandFilters
            });
            this._pendingFilePath = undefined;
        } else {
            // Store for later when webview is ready
            this._pendingFilePath = { filePath, workspaceRoot, expandFilters };
        }
    }

    public setSearchText(searchText: string) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'setSearchText',
                searchText: searchText
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MultiSearch</title>
    <link href="${codiconsUri}" rel="stylesheet" />
    <style>
    <style>
        * {
            box-sizing: border-box;
        }
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
            padding: 8px;
            margin: 0;
            font-size: var(--vscode-font-size);
        }
        .add-section {
            position: sticky;
            top: 0;
            background-color: var(--vscode-sideBar-background);
            z-index: 200;
            padding-bottom: 8px;
            margin-bottom: 4px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .search-input-wrapper {
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            margin-bottom: 8px;
        }
        .search-input-wrapper:focus-within {
            border-color: var(--vscode-focusBorder);
        }
        .input-box {
            display: flex;
            align-items: center;
            padding: 2px 4px;
            min-height: 22px;
        }
        input[type="text"], textarea {
            flex: 1;
            min-width: 0;
            background: transparent;
            border: none;
            color: var(--vscode-input-foreground);
            outline: none;
            padding: 2px;
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            line-height: 18px;
        }
        input[type="text"] {
            height: 18px;
        }
        textarea {
            resize: vertical;
            overflow-y: auto;
            min-height: 18px;
            max-height: 200px;
        }
        .input-icon {
            padding: 2px 4px;
            cursor: pointer;
            opacity: 0.6;
            font-size: 14px;
            user-select: none;
            flex-shrink: 0;
            white-space: nowrap;
        }
        .input-icon:hover {
            opacity: 1;
        }
        .input-icon.active {
            opacity: 1;
            color: var(--vscode-inputOption-activeForeground);
            background-color: var(--vscode-inputOption-activeBackground);
            border: 1px solid var(--vscode-inputOption-activeBorder);
            border-radius: 2px;
        }
        .add-button {
            width: 100%;
            padding: 6px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 12px;
        }
        .add-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .search-list {
            margin-top: 8px;
            padding-bottom: 60px;
        }
        .search-item {
            display: flex;
            flex-direction: column;
            margin-bottom: 4px;
            background-color: var(--vscode-list-inactiveSelectionBackground);
            border-radius: 2px;
            border-left: 3px solid;
            position: relative;
        }
        .search-item-header {
            display: flex;
            align-items: stretch;
            background: var(--vscode-sideBar-background);
            cursor: move;
            transition: background-color 0.2s;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .search-item.dragging .search-item-header {
            opacity: 0.5;
            transform: scale(0.95);
            transition: opacity 0.2s, transform 0.2s;
        }
        .search-item-header:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .search-item-body {
            padding: 0 0px 2px 0px;
            position: relative;
        }
        .search-item.dragging {
            opacity: 0.5;
            transform: scale(0.95);
        }
        .search-item.drag-over {
            border-top: 2px solid var(--vscode-focusBorder);
            margin-top: 2px;
        }
        .search-item-content {
            flex: 1;
            padding: 0px 2px 1px 8px;
            min-width: 0;
        }
        .search-pattern {
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            word-break: break-all;
            margin-bottom: 2px;
            cursor: pointer;
            white-space: pre-wrap;
        }
        .search-pattern:hover {
            opacity: 0.8;
        }
        .search-pattern-input {
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            width: 100%;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-focusBorder);
            color: var(--vscode-input-foreground);
            padding: 2px 4px;
            margin-bottom: 2px;
            resize: vertical;
            overflow-y: auto;
            min-height: 18px;
        }
        .search-pattern-input:focus {
            outline: none;
        }
        .search-info {
            font-size: 11px;
            opacity: 0.7;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .search-filters {
            display: flex;
            gap: 4px;
        }
        .filter-icon {
            padding: 1px 3px;
            cursor: pointer;
            opacity: 0.4;
            font-size: 11px;
            user-select: none;
            border-radius: 2px;
        }
        .filter-icon:hover {
            opacity: 0.7;
        }
        .filter-icon.active {
            opacity: 1;
            background-color: var(--vscode-inputOption-activeBackground);
            border: 1px solid var(--vscode-inputOption-activeBorder);
        }
        .nav-icon {
            display: inline-block;
            min-width: 14px;
            height: 14px;
            line-height: 14px;
            text-align: center;
            cursor: pointer;
            opacity: 0.6;
            margin-left: 4px;
            font-size: 10px;
            padding: 2px;
            border-radius: 2px;
        }
        .nav-icon:hover {
            opacity: 1;
            background-color: var(--vscode-toolbar-hoverBackground);
        }
        .action-btn {
            background: transparent;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 4px;
            opacity: 0.6;
            font-size: 14px;
            width: 24px;
            min-width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .action-btn:hover {
            opacity: 1;
            background-color: var(--vscode-toolbar-hoverBackground);
        }
        .remove-btn {
            font-size: 18px;
        }
        .merge-btn {
            font-size: 14px;
        }
        .merge-btn.active {
            opacity: 1;
            background-color: white;
            color: black;
        }
        .search-item.merge-source {
            outline: 2px solid var(--vscode-button-background);
            outline-offset: 2px;
        }
        .search-item.merge-target {
            cursor: pointer;
            background-color: var(--vscode-list-hoverBackground);
        }
        .search-item.paused {
            opacity: 0.5;
            border-left-color: #808080 !important;
        }
        .search-item.paused .search-pattern {
            color: #808080;
        }
        .pause-btn {
            width: 24px;
            min-width: 24px;
            text-align: center;
        }
        .pause-btn .pause-icon {
            font-size: 8px;
            letter-spacing: -2px;
        }
        .pause-btn .play-icon {
            font-size: 12px;
        }
        .replace-box {
            display: none;
            margin-top: 4px;
            padding: 4px;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
        }
        .replace-box.visible {
            display: flex;
            gap: 4px;
            align-items: center;
        }
        .replace-input {
            flex: 1;
            background: transparent;
            border: none;
            color: var(--vscode-input-foreground);
            outline: none;
            padding: 2px 4px;
            font-size: 12px;
        }
        .replace-actions {
            display: flex;
            gap: 2px;
        }
        .replace-action-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 2px 6px;
            cursor: pointer;
            font-size: 10px;
            border-radius: 2px;
        }
        .replace-action-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .file-matches-list {
            display: none;
            margin-top: 4px;
            margin-left: 8px;
            padding-left: 0px;
            max-height: 400px;
            overflow-y: auto;
            overflow-x: visible;
            scroll-padding-top: 0px;
        }
        .file-matches-list.visible {
            display: block;
        }
        .file-matches-resize-handle {
            display: none;
            position: absolute;
            bottom: 3px;
            right: 5px;
            width: 20px;
            height: 18px;
            cursor: ns-resize;
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-sideBarSectionHeader-border);
            border-radius: 2px;
            z-index: 10;
        }
        .file-matches-resize-handle::before {
            content: '';
            position: absolute;
            top: 2px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-style: solid;
            border-width: 0 3px 3px 3px;
            border-color: transparent transparent var(--vscode-foreground) transparent;
            opacity: 0.6;
        }
        .file-matches-resize-handle::after {
            content: '';
            position: absolute;
            bottom: 2px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            border-style: solid;
            border-width: 3px 3px 0 3px;
            border-color: var(--vscode-foreground) transparent transparent transparent;
            opacity: 0.6;
        }
        .file-matches-resize-handle.visible {
            display: block;
        }
        .current-file-matches {
            display: none;
            margin-top: 4px;
            margin-left: 8px;
            max-height: 400px;
            overflow-y: auto;
            scroll-padding-top: 0px;
        }
        .current-file-matches.visible {
            display: block;
        }
        .file-match-file {
            padding: 4px 8px;
            margin-bottom: 2px;
            background-color: var(--vscode-sideBar-background);
            border-left: 3px solid var(--vscode-panel-border);
        }
        .file-match-header {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            font-size: 12px;
        }
        .file-match-header:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .file-expand-icon {
            font-size: 10px;
            min-width: 12px;
        }
        .file-path-text {
            flex: 1;
            font-family: var(--vscode-editor-font-family);
        }
        .file-match-count {
            opacity: 0.6;
            font-size: 10px;
        }
        .line-matches {
            display: none;
            margin-top: 4px;
            margin-left: 20px;
        }
        .line-matches.visible {
            display: block;
        }
        .line-match {
            padding-top: 2px;
            padding-right: 3px;
            padding-bottom: 2px;
            padding-left: 0px;
            margin: 1px 0;
            cursor: pointer;
            font-size: 11px;
            font-family: var(--vscode-editor-font-family);
            border-radius: 3px;
            transition: background-color 0.1s ease;
            display: flex;
            align-items: flex-start;
        }
        .line-match:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .line-match.visited {
            opacity: 0.5;
        }
        .line-match.visited .match-highlight {
            opacity: 0.7;
        }
        .file-path-inline {
            opacity: 0.5;
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            margin-right: 4px;
            font-style: italic;
            overflow-wrap: anywhere;
            word-break: break-all;
            max-width: 30%;
        }
        .line-number {
            min-width: 0px;
            opacity: 0.6;
            font-size: 10px;
            color: var(--vscode-editorLineNumber-foreground);
            font-weight: 400;
            flex-shrink: 0;
        }
        .line-text {
            margin-left: 0px;
            font-size: 11px;
            color: var(--vscode-editor-foreground);
            opacity: 0.85;
            line-height: 1.4;
            letter-spacing: 0.01em;
            overflow-wrap: anywhere;
            white-space: pre-wrap;
            flex: 1;
            min-width: 0;
        }
        .match-highlight {
            background-color: var(--vscode-editor-findMatchHighlightBackground);
            color: var(--vscode-editor-foreground);
            font-weight: 600;
            border-radius: 2px;
            padding: 1px 3px;
            box-shadow: 0 0 0 1px var(--vscode-editor-findMatchBorder, transparent);
        }
        .folder-item {
            margin: 2px 0;
        }
        .folder-header {
            display: flex;
            align-items: center;
            padding: 3px 4px;
            cursor: pointer;
            border-radius: 3px;
            font-size: 12px;
            transition: background-color 0.1s ease;
        }
        .folder-header:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .folder-expand-icon {
            font-size: 10px;
            width: 12px;
            display: inline-block;
            transition: transform 0.1s ease;
            cursor: pointer;
        }
        .folder-expand-all-icon {
            cursor: pointer;
            opacity: 0.7;
            transition: opacity 0.2s ease;
            margin-left: -16px;
            margin-right: 4px;
            width: 12px;
            display: inline-block;
        }
        .folder-expand-all-icon:hover {
            opacity: 1;
        }
        .folder-name {
            font-weight: bold;
            color: var(--vscode-foreground);
        }
        .folder-match-count {
            margin-left: 6px;
            opacity: 0.6;
            font-size: 10px;
        }
        .folder-contents {
            margin-left: 0;
        }
        .file-item {
            margin: 2px 0;
        }
        .file-header {
            display: flex;
            align-items: center;
            padding: 3px 4px;
            cursor: pointer;
            border-radius: 3px;
            font-size: 11px;
            transition: background-color 0.1s ease;
        }
        .file-header:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .file-name {
            color: var(--vscode-foreground);
            font-weight: bold;
        }
        .file-lines {
            margin-left: 0;
            margin-top: 2px;
        }
        /* Flat view styles (like VSCode native search) */
        .flat-file-item {
            margin: 2px 0;
        }
        .flat-file-header {
            display: flex;
            align-items: center;
            padding: 3px 4px;
            cursor: pointer;
            border-radius: 3px;
            font-size: 11px;
            transition: background-color 0.1s ease;
        }
        .flat-file-header:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .flat-file-path {
            color: var(--vscode-foreground);
            opacity: 0.8;
            margin-left: 4px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-weight: bold;
        }
        .expand-icon {
            cursor: pointer;
            font-size: 10px;
            margin-left: 4px;
            opacity: 0.6;
        }
        .expand-icon:hover {
            opacity: 1;
        }
        .nav-controls {
            display: flex;
            gap: 8px;
            align-items: center;
            padding: 8px;
            border-top: 1px solid var(--vscode-panel-border);
            margin-top: 8px;
        }
        .nav-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 11px;
            border-radius: 2px;
        }
        .nav-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .nav-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .nav-info {
            font-size: 11px;
            opacity: 0.7;
        }
        .collapse-all-btn {
            background: #17a2b8;
            color: white;
            border: none;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 11px;
            border-radius: 2px;
        }
        .collapse-all-btn:hover {
            background-color: #138496;
        }
        .footer-btn {
            border: none;
            padding: 8px 12px;
            cursor: pointer;
            font-size: 12px;
            border-radius: 2px;
            width: 100%;
            font-weight: 500;
        }
        .footer-btn:hover {
            opacity: 0.9;
            filter: brightness(1.1);
        }
        .empty-state {
            text-align: center;
            padding: 20px;
            opacity: 0.5;
            font-size: 12px;
        }
        .code-preview-popup {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
            max-width: 80%;
            max-height: 40%;
            min-width: 250px;
            min-height: 150px;
            z-index: 1000;
            display: flex;
            flex-direction: column;
            font-size: 10px;
            resize: both;
            overflow: hidden;
        }
        .preview-header {
            padding: 6px 10px;
            background: var(--vscode-editorGroupHeader-tabsBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 10px;
            cursor: grab;
            user-select: none;
        }
        .preview-header:active {
            cursor: grabbing;
        }
        .preview-file {
            font-family: var(--vscode-editor-font-family);
            color: var(--vscode-foreground);
        }
        .preview-close {
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 3px;
            opacity: 0.7;
        }
        .preview-close:hover {
            background: var(--vscode-toolbar-hoverBackground);
            opacity: 1;
        }
        .preview-code {
            overflow: auto;
            padding: 6px;
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
        }
        .preview-line {
            display: flex;
            line-height: 1.3;
            padding: 1px 0;
        }
        .preview-line.target-line {
            background: var(--vscode-editor-findMatchHighlightBackground);
        }
        .preview-line-num {
            color: var(--vscode-editorLineNumber-foreground);
            padding-right: 8px;
            text-align: right;
            min-width: 35px;
            user-select: none;
            font-size: 9px;
        }
        .preview-line-text {
            white-space: pre;
            flex: 1;
        }
        /* Pinned state */
        .code-preview-popup.pinned {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        }
        /* Basic syntax highlighting colors (fallback tokenization) */
        .preview-line-text .token-keyword {
            color: var(--vscode-symbolIcon-keywordForeground, #569cd6);
        }
        .preview-line-text .token-string {
            color: var(--vscode-symbolIcon-stringForeground, #ce9178);
        }
        .preview-line-text .token-comment {
            color: var(--vscode-descriptionForeground, #6a9955);
            font-style: italic;
        }
        .preview-line-text .token-number {
            color: var(--vscode-symbolIcon-numberForeground, #b5cea8);
        }
        .preview-line-text .token-function {
            color: var(--vscode-symbolIcon-functionForeground, #dcdcaa);
        }
        .preview-line-text .token-class {
            color: var(--vscode-symbolIcon-classForeground, #4ec9b0);
        }
        /* VSCode semantic token types */
        .preview-line-text .stok-class,
        .preview-line-text .stok-type {
            color: var(--vscode-symbolIcon-classForeground, #4ec9b0);
        }
        .preview-line-text .stok-function,
        .preview-line-text .stok-method {
            color: var(--vscode-symbolIcon-functionForeground, #dcdcaa);
        }
        .preview-line-text .stok-variable,
        .preview-line-text .stok-property {
            color: var(--vscode-symbolIcon-variableForeground, #9cdcfe);
        }
        .preview-line-text .stok-parameter {
            color: var(--vscode-symbolIcon-variableForeground, #9cdcfe);
        }
        .preview-line-text .stok-keyword {
            color: var(--vscode-symbolIcon-keywordForeground, #569cd6);
        }
        .preview-line-text .stok-string {
            color: var(--vscode-symbolIcon-stringForeground, #ce9178);
        }
        .preview-line-text .stok-number {
            color: var(--vscode-symbolIcon-numberForeground, #b5cea8);
        }
        .preview-line-text .stok-comment {
            color: var(--vscode-descriptionForeground, #6a9955);
            font-style: italic;
        }
        .preview-line-text .stok-operator {
            color: var(--vscode-symbolIcon-operatorForeground, #d4d4d4);
        }
        .preview-line-text .stok-namespace,
        .preview-line-text .stok-module {
            color: var(--vscode-symbolIcon-namespaceForeground, #4ec9b0);
        }
        .preview-line-text .stok-enum {
            color: var(--vscode-symbolIcon-enumForeground, #4ec9b0);
        }
        .preview-line-text .stok-enumMember {
            color: var(--vscode-symbolIcon-enumMemberForeground, #4fc1ff);
        }
        .preview-line-text .stok-interface {
            color: var(--vscode-symbolIcon-interfaceForeground, #4ec9b0);
        }
        .preview-line-text .stok-struct {
            color: var(--vscode-symbolIcon-structForeground, #4ec9b0);
        }
        .preview-line-text .stok-typeParameter {
            color: var(--vscode-symbolIcon-typeParameterForeground, #4ec9b0);
        }
        .preview-line-text .stok-macro {
            color: var(--vscode-symbolIcon-keywordForeground, #569cd6);
        }
    </style>
</head>
<body>
    <div class="add-section">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 4px; min-width: 0;">
            <div style="flex: 1; min-width: 0;">
                <div class="search-input-wrapper">
                    <div class="input-box">
                        <textarea id="searchInput" placeholder="Search..." rows="1"></textarea>
                        <span class="input-icon" id="caseSensitiveBtn" title="Match Case">Aa</span>
                        <span class="input-icon" id="wholeWordBtn" title="Match Whole Word" style="border: 1px solid currentColor; padding: 1px 3px;">ab</span>
                        <span class="input-icon" id="regexBtn" title="Use Regular Expression">.*</span>
                    </div>
                </div>
            </div>
            <div style="display: flex; gap: 4px; margin-left: 8px; flex-shrink: 0; align-items: center;">
                <span class="codicon codicon-collapse-all" id="collapseAllBtn" title="Collapse All" style="cursor: pointer; font-size: 16px; padding: 4px;"></span>
                <span class="codicon codicon-expand-all" id="expandAllBtn" title="Expand All" style="cursor: pointer; font-size: 16px; padding: 4px;"></span>
                <span class="input-icon" id="toggleFiltersBtn" title="Toggle file filters" style="cursor: pointer; font-weight: bold;">...</span>
            </div>
        </div>
        <div id="fileFiltersSection" style="display: ${vscode.workspace.getConfiguration('multiSearch').get('showFileFiltersByDefault', false) ? 'block' : 'none'};">
            <div class="search-input-wrapper" style="margin-bottom: 4px;">
                <div class="input-box">
                    <input type="text" id="pathInput" placeholder="File paths to include" />
                </div>
            </div>
            <div class="search-input-wrapper">
                <div class="input-box">
                    <input type="text" id="excludePathInput" placeholder="File paths to exclude" />
                </div>
            </div>
        </div>
    </div>

    <div class="search-list" id="searchList">
    </div>

    <div id="filterActions" style="position: fixed; bottom: 0; left: 0; right: 0; background-color: var(--vscode-sideBar-background); z-index: 10; padding: 8px; border-top: 1px solid var(--vscode-panel-border); box-shadow: 0 -2px 8px rgba(0,0,0,0.15);">
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">
            <button class="footer-btn" id="resetSearchesBtn" style="background-color: #f14c4c; color: white;">Reset</button>
            <button class="footer-btn" id="loadSearchesBtn" style="background-color: #fd7e14; color: white;">Load</button>
            <button class="footer-btn" id="saveSearchesBtn" style="background-color: #28a745; color: white;">Save</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const searchInput = document.getElementById('searchInput');
        const pathInput = document.getElementById('pathInput');
        const excludePathInput = document.getElementById('excludePathInput');
        const regexBtn = document.getElementById('regexBtn');
        const caseSensitiveBtn = document.getElementById('caseSensitiveBtn');
        const wholeWordBtn = document.getElementById('wholeWordBtn');
        const toggleFiltersBtn = document.getElementById('toggleFiltersBtn');
        const fileFiltersSection = document.getElementById('fileFiltersSection');
        const searchList = document.getElementById('searchList');
        const resetSearchesBtn = document.getElementById('resetSearchesBtn');
        const saveSearchesBtn = document.getElementById('saveSearchesBtn');
        const loadSearchesBtn = document.getElementById('loadSearchesBtn');
        const collapseAllBtn = document.getElementById('collapseAllBtn');
        const expandAllBtn = document.getElementById('expandAllBtn');
        const filterActions = document.getElementById('filterActions');
        let isRegex = false;
        let isCaseSensitive = false;
        let isWholeWord = false;
        let fileFiltersExpandedDefault = ${vscode.workspace.getConfiguration('multiSearch').get('showFileFiltersByDefault', false)};
        let fileFiltersExpanded = fileFiltersExpandedDefault;
        let workspaceRoot = ''; // Store workspace root for file searches
        let mergeModifierKey = '${vscode.workspace.getConfiguration('multiSearch').get('mergeModifierKey', 'ctrl')}';
        let markVisitedMatches = ${vscode.workspace.getConfiguration('multiSearch').get('markVisitedMatches', true)};

        // Update header height CSS variable dynamically
        function updateHeaderHeight() {
            const addSection = document.querySelector('.add-section');
            if (addSection) {
                const height = addSection.offsetHeight;
                document.documentElement.style.setProperty('--header-height', height + 'px');
            }
        }

        // Call on load and whenever filters are toggled
        updateHeaderHeight();
        const resizeObserver = new ResizeObserver(() => {
            updateHeaderHeight();
        });
        const addSection = document.querySelector('.add-section');
        if (addSection) {
            resizeObserver.observe(addSection);
        }

        // Save state function
        // Note: searchInput, pathInput, excludePathInput, and fileFiltersExpanded are intentionally NOT saved
        // They persist during session but reset when VSCode is reopened
        // fileFiltersExpanded is controlled by the showFileFiltersByDefault setting at session start
        function saveState() {
            const expandedState = saveExpandedState();
            vscode.setState({
                isRegex: isRegex,
                isCaseSensitive: isCaseSensitive,
                isWholeWord: isWholeWord,
                workspaceRoot: workspaceRoot,
                expandedState: expandedState
            });
        }

        // Toggle buttons
        regexBtn.addEventListener('click', () => {
            isRegex = !isRegex;
            regexBtn.classList.toggle('active', isRegex);
            updatePreview();
            saveState();
        });

        caseSensitiveBtn.addEventListener('click', () => {
            isCaseSensitive = !isCaseSensitive;
            caseSensitiveBtn.classList.toggle('active', isCaseSensitive);
            updatePreview();
            saveState();
        });

        wholeWordBtn.addEventListener('click', () => {
            isWholeWord = !isWholeWord;
            wholeWordBtn.classList.toggle('active', isWholeWord);
            updatePreview();
            saveState();
        });

        // Toggle file filters section
        toggleFiltersBtn.addEventListener('click', () => {
            fileFiltersExpanded = !fileFiltersExpanded;
            fileFiltersSection.style.display = fileFiltersExpanded ? 'block' : 'none';
            saveState();
        });

        // Real-time preview as user types
        searchInput.addEventListener('input', () => {
            updatePreview();
            saveState();
        });

        pathInput.addEventListener('input', saveState);
        excludePathInput.addEventListener('input', saveState);

        // Allow Enter key in filter inputs to trigger search
        pathInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                addSearch();
            }
        });

        excludePathInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                addSearch();
            }
        });

        // Clear preview when input is focused/blurred
        searchInput.addEventListener('blur', () => {
            // Small delay to allow click on "Add Search" button
            setTimeout(() => {
                if (document.activeElement !== searchInput) {
                    clearPreview();
                }
            }, 150);
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                addSearch();
            }
        });

        function updatePreview() {
            const pattern = searchInput.value;
            if (pattern) {
                vscode.postMessage({
                    command: 'previewSearch',
                    pattern: pattern,
                    isRegex: isRegex,
                    isCaseSensitive: isCaseSensitive,
                    isWholeWord: isWholeWord
                });
            } else {
                clearPreview();
            }
        }

        function clearPreview() {
            vscode.postMessage({
                command: 'clearPreview'
            });
        }

        function addSearch() {
            const pattern = searchInput.value.trim();
            const filePath = pathInput.value.trim();
            const excludePath = excludePathInput.value.trim();
            if (pattern) {
                vscode.postMessage({
                    command: 'addSearch',
                    pattern: pattern,
                    isRegex: isRegex,
                    isCaseSensitive: isCaseSensitive,
                    isWholeWord: isWholeWord,
                    filePath: filePath || undefined,
                    excludePath: excludePath || undefined,
                    workspaceRoot: workspaceRoot || undefined
                });
                searchInput.value = '';
                // DON'T clear pathInput/excludePathInput - keep them for next search
                isRegex = false;
                isCaseSensitive = false;
                isWholeWord = false;
                regexBtn.classList.remove('active');
                caseSensitiveBtn.classList.remove('active');
                wholeWordBtn.classList.remove('active');
                clearPreview();
            }
        }

        function removeSearch(id) {
            vscode.postMessage({
                command: 'removeSearch',
                id: id
            });
        }

        function togglePause(id) {
            vscode.postMessage({
                command: 'togglePause',
                id: id
            });
        }

        function clearAll() {
            vscode.postMessage({
                command: 'clearAll'
            });
        }

        function resetSearches() {
            vscode.postMessage({
                command: 'clearAll'
            });
        }

        resetSearchesBtn.addEventListener('click', resetSearches);

        function saveSearches() {
            vscode.postMessage({
                command: 'saveSearches'
            });
        }

        saveSearchesBtn.addEventListener('click', saveSearches);

        function loadSearches() {
            vscode.postMessage({
                command: 'loadSearches'
            });
        }

        loadSearchesBtn.addEventListener('click', loadSearches);

        function expandAll() {
            // Expand file filters section
            fileFiltersSection.style.display = 'block';
            fileFiltersExpanded = true;
            saveState();

            // Expand all file lists
            document.querySelectorAll('.file-matches-list:not(.visible)').forEach(el => {
                el.classList.add('visible');
            });
            // Expand all current file matches
            document.querySelectorAll('.current-file-matches:not(.visible)').forEach(el => {
                el.classList.add('visible');
            });
            // Expand all line matches within files
            document.querySelectorAll('.line-matches:not(.visible)').forEach(el => {
                el.classList.add('visible');
            });
            // Update all expand icons to show expanded state
            document.querySelectorAll('.expand-icon').forEach(icon => {
                icon.textContent = '▼';
            });
            // Update all file expand icons to show expanded state
            document.querySelectorAll('.file-expand-icon').forEach(icon => {
                icon.textContent = '▼';
            });
        }

        expandAllBtn.addEventListener('click', expandAll);

        function toggleFilter(id, filterType) {
            vscode.postMessage({
                command: 'toggleFilter',
                id: id,
                filterType: filterType
            });
        }

        function toggleReplace(id) {
            const replaceBox = document.getElementById('replace-' + id);
            if (replaceBox) {
                replaceBox.classList.toggle('visible');
                if (replaceBox.classList.contains('visible')) {
                    const input = replaceBox.querySelector('.replace-input');
                    if (input) {
                        input.focus();
                    }
                }
            }
        }

        function replaceAll(id) {
            const replaceBox = document.getElementById('replace-' + id);
            if (!replaceBox) return;

            const input = replaceBox.querySelector('.replace-input');
            if (!input) return;

            const replaceText = input.value;
            vscode.postMessage({
                command: 'replaceAll',
                id: id,
                replaceText: replaceText
            });

            // Close replace box after replacing
            replaceBox.classList.remove('visible');
            input.value = '';
        }

        let mergeSourceId = null;

        function startMerge(id) {
            if (mergeSourceId === id) {
                // Cancel merge mode
                cancelMerge();
                return;
            }

            if (mergeSourceId === null) {
                // Start merge mode - select source
                mergeSourceId = id;

                // Highlight the source item
                const sourceItem = document.querySelector(\`[data-search-id="\${id}"]\`);
                if (sourceItem) {
                    sourceItem.classList.add('merge-source');
                }

                // Update the source merge button to white and keep same title
                const sourceMergeBtn = document.getElementById(\`merge-btn-\${id}\`);
                if (sourceMergeBtn) {
                    sourceMergeBtn.classList.add('active');
                }

                // Make all other search items clickable targets and update their buttons
                const allItems = document.querySelectorAll('.search-item');
                allItems.forEach(item => {
                    const itemId = item.getAttribute('data-search-id');
                    if (itemId !== id) {
                        item.classList.add('merge-target');
                        item.onclick = () => completeMerge(itemId);

                        // Update other merge buttons to show "Merge with selected"
                        const targetMergeBtn = document.getElementById(\`merge-btn-\${itemId}\`);
                        if (targetMergeBtn) {
                            targetMergeBtn.title = 'Merge with selected';
                        }
                    }
                });
            } else {
                // Complete merge with this target
                completeMerge(id);
            }
        }

        function completeMerge(targetId) {
            if (mergeSourceId === null || mergeSourceId === targetId) {
                cancelMerge();
                return;
            }

            // Send merge command
            vscode.postMessage({
                command: 'mergeSearches',
                fromId: mergeSourceId,
                toId: targetId
            });

            // Cancel merge mode
            cancelMerge();
        }

        function cancelMerge() {
            // Remove highlights from source
            if (mergeSourceId) {
                const sourceItem = document.querySelector(\`[data-search-id="\${mergeSourceId}"]\`);
                if (sourceItem) {
                    sourceItem.classList.remove('merge-source');
                    const mergeBtn = sourceItem.querySelector('.merge-btn');
                    if (mergeBtn) {
                        mergeBtn.classList.remove('active');
                    }
                }
            }

            // Remove merge target highlights and onclick handlers, reset button titles
            const allItems = document.querySelectorAll('.search-item');
            allItems.forEach(item => {
                item.classList.remove('merge-target');
                item.onclick = null;

                // Reset all merge button titles to default
                const itemId = item.getAttribute('data-search-id');
                if (itemId) {
                    const mergeBtn = document.getElementById(\`merge-btn-\${itemId}\`);
                    if (mergeBtn) {
                        mergeBtn.title = 'Select for Merge';
                    }
                }
            });

            mergeSourceId = null;
        }

        function toggleDisplayMode(id) {
            vscode.postMessage({
                command: 'toggleDisplayMode',
                id: id
            });
        }

        function toggleFileList(id) {
            
            const fileList = document.getElementById('files-' + id);
            const expandIcon = event.target;
            if (fileList && expandIcon) {
                fileList.classList.toggle('visible');
                expandIcon.textContent = fileList.classList.contains('visible') ? '▼' : '▶';
                

                if (fileList.classList.contains('visible')) {
                    // Setup resize handle after expanding
                    
                    setTimeout(() => setupResizeHandle(id), 50);
                } else {
                    // Hide resize handle and remove padding when collapsing
                    const resizeHandle = document.getElementById('resize-handle-' + id);
                    if (resizeHandle) {
                        resizeHandle.classList.remove('visible');
                    }
                    const searchItem = fileList.closest('.search-item');
                    const searchItemBody = searchItem ? searchItem.querySelector('.search-item-body') : null;
                    // if (searchItemBody) {
                    //     searchItemBody.style.paddingBottom = '6px';
                    // }
                }
            }
        }

        function setupResizeHandle(id, retryCount = 0) {
            const fileList = document.getElementById('files-' + id);
            const resizeHandle = document.getElementById('resize-handle-' + id);

            if (!fileList || !resizeHandle) {
                
                return;
            }

            // Check if list is visible (has display: block)
            const isVisible = fileList.classList.contains('visible');
            

            if (!isVisible) {
                // List is hidden, can't check scrollbar
                resizeHandle.classList.remove('visible');
                
                return;
            }

            // Force reflow to ensure dimensions are calculated
            void fileList.offsetHeight;

            // Check if scrollbar is present
            const hasScrollbar = fileList.scrollHeight > fileList.clientHeight;

            // If content hasn't loaded yet (scrollHeight is suspiciously small on first check), retry once
            // Only retry if it's extremely small (< 50px) and this is the first or second check
            if (fileList.scrollHeight < 50 && retryCount < 2) {
                
                setTimeout(() => setupResizeHandle(id, retryCount + 1), 200);
                return;
            }

            // Get the search item body to manage padding
            const searchItem = fileList.closest('.search-item');
            const searchItemBody = searchItem ? searchItem.querySelector('.search-item-body') : null;

            if (hasScrollbar) {
                resizeHandle.classList.add('visible');
                // Add bottom padding when scrollbar is present
                // if (searchItemBody) {
                //     searchItemBody.style.paddingBottom = '20px';
                // }
                
            } else {
                resizeHandle.classList.remove('visible');
                // Remove bottom padding when no scrollbar
                // if (searchItemBody) {
                //     searchItemBody.style.paddingBottom = '6px';
                // }
                
                return;
            }

            // Remove existing listeners if any
            if (resizeHandle._resizeSetup) return;
            resizeHandle._resizeSetup = true;

            const defaultHeight = 400;
            let isResizing = false;
            let startY = 0;
            let startHeight = 0;

            resizeHandle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();

                isResizing = true;
                startY = e.clientY;
                startHeight = fileList.offsetHeight;

                document.addEventListener('mousemove', handleResize);
                document.addEventListener('mouseup', stopResize);
            });

            function handleResize(e) {
                if (!isResizing) return;

                const deltaY = e.clientY - startY;
                let newHeight = startHeight + deltaY;

                // Get footer position to calculate max height
                const footer = document.querySelector('.footer-actions');
                const footerTop = footer ? footer.getBoundingClientRect().top : window.innerHeight;
                const listTop = fileList.getBoundingClientRect().top;
                const maxHeight = footerTop - listTop - 20; // 20px padding

                // Clamp between default height and footer
                newHeight = Math.max(defaultHeight, Math.min(newHeight, maxHeight));

                fileList.style.maxHeight = newHeight + 'px';
                fileList.style.height = newHeight + 'px';

                // Check if we still need the scrollbar
                const hasScrollbar = fileList.scrollHeight > fileList.clientHeight;
                if (!hasScrollbar) {
                    resizeHandle.classList.remove('visible');
                    // Remove bottom padding when scrollbar disappears
                    if (searchItemBody) {
                        searchItemBody.style.paddingBottom = '6px';
                    }
                }
            }

            function stopResize() {
                isResizing = false;
                document.removeEventListener('mousemove', handleResize);
                document.removeEventListener('mouseup', stopResize);
            }
        }

        function toggleMatchList(id) {
            
            // Check if this is a file search or current file search
            const fileList = document.getElementById('files-' + id);
            const currentFileList = document.getElementById('current-matches-' + id);

            // Find the expand icon - it's a sibling element with class 'expand-icon'
            const matchCountElement = event.target.closest('.search-info');
            const expandIcon = matchCountElement ? matchCountElement.querySelector('.expand-icon') : null;

            if (fileList) {
                
                // File search - toggle file list
                fileList.classList.toggle('visible');
                if (expandIcon) {
                    expandIcon.textContent = fileList.classList.contains('visible') ? '▼' : '▶';
                }
                

                if (fileList.classList.contains('visible')) {
                    // Setup resize handle after expanding
                    
                    setTimeout(() => setupResizeHandle(id), 50);
                } else {
                    // Hide resize handle and remove padding when collapsing
                    const resizeHandle = document.getElementById('resize-handle-' + id);
                    if (resizeHandle) {
                        resizeHandle.classList.remove('visible');
                    }
                    const searchItem = fileList.closest('.search-item');
                    const searchItemBody = searchItem ? searchItem.querySelector('.search-item-body') : null;
                    // if (searchItemBody) {
                    //     searchItemBody.style.paddingBottom = '6px';
                    // }
                }
            } else if (currentFileList) {
                
                // Current file search - toggle current file matches
                currentFileList.classList.toggle('visible');
                if (expandIcon) {
                    expandIcon.textContent = currentFileList.classList.contains('visible') ? '▼' : '▶';
                }
            }
        }

        function goToLine(line, event) {
            if (event) {
                event.stopPropagation();

                // If Ctrl is pressed and there's a preview, just pin it instead of going to line
                if ((event.ctrlKey || event.metaKey) && currentPreview) {
                    if (!isPinned) {
                        isPinned = true;
                        currentPreview.classList.add('pinned');

                    }
                    return;
                }

                // Mark the clicked line as visited
                if (markVisitedMatches && event.target) {
                    const lineMatch = event.target.closest('.line-match');
                    if (lineMatch) {
                        lineMatch.classList.add('visited');
                    }
                }
            }

            // Only go to line if not Ctrl+clicking with preview
            vscode.postMessage({
                command: 'goToLine',
                line: line
            });
        }

        function navigateToPrevMatch(searchId) {
            vscode.postMessage({
                command: 'navigateMatch',
                searchId: searchId,
                direction: 'prev'
            });
        }

        function navigateToNextMatch(searchId) {
            vscode.postMessage({
                command: 'navigateMatch',
                searchId: searchId,
                direction: 'next'
            });
        }

        function openFile(filePath, workspaceRoot) {
            vscode.postMessage({
                command: 'openFile',
                filePath: filePath,
                workspaceRoot: workspaceRoot
            });
        }

        function openFileAtLine(filePath, line, workspaceRoot, event) {
            if (event) {
                event.stopPropagation();

                // If Ctrl is pressed and there's a preview, just pin it instead of opening file
                if ((event.ctrlKey || event.metaKey) && currentPreview) {
                    if (!isPinned) {
                        isPinned = true;
                        currentPreview.classList.add('pinned');

                    }
                    return;
                }

                // Mark the clicked line as visited
                if (markVisitedMatches && event.target) {
                    const lineMatch = event.target.closest('.line-match');
                    if (lineMatch) {
                        lineMatch.classList.add('visited');
                    }
                }
            }

            // Only open file if not Ctrl+clicking with preview
            vscode.postMessage({
                command: 'openFile',
                filePath: filePath,
                line: line,
                workspaceRoot: workspaceRoot
            });
        }

        function toggleFilePreview(searchId, filePath) {
            const sanitizedPath = filePath.replace(/[^a-zA-Z0-9]/g, '_');
            const lineMatches = document.getElementById(\`lines-\${searchId}-\${sanitizedPath}\`);
            const icon = document.getElementById(\`file-icon-\${searchId}-\${sanitizedPath}\`);

            if (lineMatches && icon) {
                lineMatches.classList.toggle('visible');
                icon.textContent = lineMatches.classList.contains('visible') ? '▼' : '▶';
            }
        }

        let currentPreview = null;
        let hoverTimeout = null;
        let isPinned = false;
        let lastMouseX = 0;
        let lastMouseY = 0;

        function handleLineHover(filePath, line, workspaceRoot, event) {
            // Only show preview if Ctrl (or Cmd on Mac) is pressed
            if (event.ctrlKey || event.metaKey) {
                // Store mouse coordinates
                lastMouseX = event.clientX;
                lastMouseY = event.clientY;

                // Clear any existing timeout
                if (hoverTimeout) {
                    clearTimeout(hoverTimeout);
                }

                // Show preview after a short delay
                hoverTimeout = setTimeout(() => {
                    
                    vscode.postMessage({
                        command: 'getCodePreview',
                        filePath: filePath,
                        line: line,
                        workspaceRoot: workspaceRoot,
                        mouseX: lastMouseX,
                        mouseY: lastMouseY
                    });
                }, 200);
            }
        }

        function handleCurrentFileLineHover(line, event) {
            // Only show preview if Ctrl (or Cmd on Mac) is pressed
            if (event.ctrlKey || event.metaKey) {
                // Store mouse coordinates
                lastMouseX = event.clientX;
                lastMouseY = event.clientY;

                // Clear any existing timeout
                if (hoverTimeout) {
                    clearTimeout(hoverTimeout);
                }

                // Show preview for current file after a short delay
                hoverTimeout = setTimeout(() => {
                    
                    vscode.postMessage({
                        command: 'getCodePreviewCurrentFile',
                        line: line,
                        mouseX: lastMouseX,
                        mouseY: lastMouseY
                    });
                }, 200);
            }
        }

        function handleLineOut(event) {
            // Clear hover timeout
            if (hoverTimeout) {
                clearTimeout(hoverTimeout);
                hoverTimeout = null;
            }

            // Only close preview if not pinned and mouse is not over the preview
            if (!isPinned && currentPreview && !currentPreview.contains(event.relatedTarget)) {
                closePreview();
            }
        }

        let pinnedPreviews = [];
        let previewIdCounter = 0;
        let lastPreviewWidth = null;
        let lastPreviewHeight = null;

        function showCodePreview(filePath, line, codeLines, languageId, mouseX, mouseY) {
            // Don't remove existing preview if it's pinned - allow multiple
            if (currentPreview && !isPinned) {
                currentPreview.remove();
            }

            // Reset pinned state for new preview
            isPinned = false;

            // Create preview popup
            const preview = document.createElement('div');
            preview.className = 'code-preview-popup';
            preview.dataset.previewId = previewIdCounter++;

            // Apply last used size if available
            if (lastPreviewWidth && lastPreviewHeight) {
                preview.style.width = lastPreviewWidth + 'px';
                preview.style.height = lastPreviewHeight + 'px';
                preview.style.maxWidth = 'none';
                preview.style.maxHeight = 'none';
            }

            // Build code HTML with syntax highlighting
            const codeHTML = codeLines.map((codeLine, idx) => {
                const lineTextHTML = codeLine.highlightedText || escapeHtml(codeLine.text);
                return \`
                    <div class="preview-line \${codeLine.isTarget ? 'target-line' : ''}">
                        <span class="preview-line-num">\${codeLine.lineNum}</span>
                        <span class="preview-line-text">\${lineTextHTML}</span>
                    </div>
                \`;
            }).join('');

            const headerId = 'preview-header-' + preview.dataset.previewId;
            preview.innerHTML = \`
                <div class="preview-header" id="\${headerId}">
                    <span class="preview-file">\${filePath}:\${line}</span>
                    <span class="preview-close">✕</span>
                </div>
                <div class="preview-code">
                    \${codeHTML}
                </div>
            \`;

            // Add mouseout handler for the preview itself
            preview.addEventListener('mouseout', function(e) {
                if (!preview.classList.contains('pinned') && !preview.contains(e.relatedTarget)) {
                    closeSpecificPreview(preview);
                }
            });

            // Append to DOM first so getElementById works
            document.body.appendChild(preview);
            currentPreview = preview;

            // Position the preview relative to mouse
            positionPreview(preview, mouseX, mouseY);

            // Add close button handler AFTER appending to DOM
            const closeBtn = preview.querySelector('.preview-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    closeSpecificPreview(preview);
                });
            }

            // Make it draggable AFTER appending to DOM
            makeDraggable(preview, headerId);

            // Watch for native CSS resize and save the size
            let resizeTimeout;
            const resizeObserver = new ResizeObserver((entries) => {
                // Debounce to only save when user finishes resizing
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    for (let entry of entries) {
                        const width = Math.round(entry.contentRect.width);
                        const height = Math.round(entry.contentRect.height);

                        // Only save if the size actually changed
                        if (width !== lastPreviewWidth || height !== lastPreviewHeight) {
                            lastPreviewWidth = width;
                            lastPreviewHeight = height;
                        }
                    }
                }, 300); // Wait 300ms after resize stops
            });
            resizeObserver.observe(preview);

            // Auto-scroll to target line
            const codeContainer = preview.querySelector('.preview-code');
            const targetLine = preview.querySelector('.preview-line.target-line');
            if (codeContainer && targetLine) {
                // Scroll to center the target line in the viewport
                const containerHeight = codeContainer.clientHeight;
                const lineTop = targetLine.offsetTop;
                const lineHeight = targetLine.clientHeight;
                codeContainer.scrollTop = lineTop - (containerHeight / 2) + (lineHeight / 2);

                // Make scrolling slower and less sensitive
                codeContainer.addEventListener('wheel', function(e) {
                    e.preventDefault();
                    // Reduce scroll speed by factor of 3 (adjust deltaY)
                    const scrollAmount = e.deltaY / 3;
                    codeContainer.scrollTop += scrollAmount;
                }, { passive: false });
            }
        }

        function makeDraggable(element, headerId) {
            const header = document.getElementById(headerId);
            if (!header) {
                return;
            }

            let isDragging = false;
            let dragStarted = false;
            let startX;
            let startY;
            let initialX;
            let initialY;
            let clickTimer;

            header.style.cursor = 'grab';

            header.addEventListener('mousedown', dragStart, false);

            // Add click handler to the body for pinning
            element.addEventListener('click', function(e) {
                // Only handle clicks on the code area (not header, not close button)
                if (!e.target.closest('.preview-header') && !e.target.classList.contains('preview-close')) {
                    if (!element.classList.contains('pinned')) {
                        element.classList.add('pinned');
                        pinnedPreviews.push(element);
                    }
                }
            });

            function dragStart(e) {
                // Don't drag if clicking close button
                if (e.target.classList.contains('preview-close')) {
                    return;
                }

                e.preventDefault();
                e.stopPropagation();

                // Get current position from computed style or offsetLeft/Top
                const rect = element.getBoundingClientRect();
                startX = e.clientX;
                startY = e.clientY;
                initialX = e.clientX - rect.left;
                initialY = e.clientY - rect.top;

                isDragging = true;
                dragStarted = false;

                header.style.cursor = 'grabbing';

                document.addEventListener('mousemove', drag);
                document.addEventListener('mouseup', dragEnd);

                // Set a small timer to detect if this is a drag or a click
                clickTimer = setTimeout(() => {
                    dragStarted = true;
                }, 100);
            }

            function drag(e) {
                if (isDragging) {
                    e.preventDefault();
                    e.stopPropagation();

                    const deltaX = Math.abs(e.clientX - startX);
                    const deltaY = Math.abs(e.clientY - startY);

                    // If moved more than 3px, consider it a drag
                    if (deltaX > 3 || deltaY > 3) {
                        dragStarted = true;
                        clearTimeout(clickTimer);

                        const currentX = e.clientX - initialX;
                        const currentY = e.clientY - initialY;

                        // Make sure we set position fixed explicitly
                        element.style.position = 'fixed';
                        element.style.left = currentX + 'px';
                        element.style.top = currentY + 'px';
                        element.style.transform = 'none';
                    }
                }
            }

            function dragEnd(e) {
                clearTimeout(clickTimer);
                isDragging = false;
                header.style.cursor = 'grab';

                document.removeEventListener('mousemove', drag);
                document.removeEventListener('mouseup', dragEnd);

                // If it was just a click on header (not a drag), handle pinning
                // Close button is handled separately via its own click handler
                if (!dragStarted && !e.target.classList.contains('preview-close')) {
                    if (!element.classList.contains('pinned')) {
                        element.classList.add('pinned');
                        pinnedPreviews.push(element);
                    }
                }
            }
        }

        function closeSpecificPreview(preview) {
            if (preview) {
                preview.remove();

                // Remove from pinned list if it was pinned
                const index = pinnedPreviews.indexOf(preview);
                if (index > -1) {
                    pinnedPreviews.splice(index, 1);
                }

                // Clear currentPreview if this was it
                if (currentPreview === preview) {
                    currentPreview = null;
                    isPinned = false;
                }
            }
        }

        function positionPreview(preview, mouseX, mouseY) {
            // Get viewport dimensions
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            // Get preview dimensions (need to render first to measure)
            const previewRect = preview.getBoundingClientRect();
            const previewWidth = previewRect.width;
            const previewHeight = previewRect.height;

            // Default offset from cursor
            const offset = 10;

            let left = mouseX + offset;
            let top = mouseY + offset;

            // Check if preview would go off the right edge
            if (left + previewWidth > viewportWidth) {
                left = mouseX - previewWidth - offset;
            }

            // Check if preview would go off the bottom edge
            if (top + previewHeight > viewportHeight) {
                // Position above the cursor
                top = mouseY - previewHeight - offset;
            }

            // Ensure preview stays within viewport bounds
            left = Math.max(0, Math.min(left, viewportWidth - previewWidth));
            top = Math.max(0, Math.min(top, viewportHeight - previewHeight));

            preview.style.left = left + 'px';
            preview.style.top = top + 'px';
            preview.style.transform = 'none'; // Remove center transform
        }

        function closePreview() {
            // Only close unpinned preview
            if (currentPreview && !currentPreview.classList.contains('pinned')) {
                currentPreview.remove();
                currentPreview = null;
                isPinned = false;
            }
        }

        function closeAllPreviews() {
            // Close all previews including pinned ones
            pinnedPreviews.forEach(p => p.remove());
            pinnedPreviews = [];
            if (currentPreview) {
                currentPreview.remove();
                currentPreview = null;
            }
            isPinned = false;
        }

        window.showCodePreview = showCodePreview;
        window.closePreview = closePreview;

        function collapseAll() {
            // Collapse line matches within files
            document.querySelectorAll('.line-matches.visible').forEach(el => {
                el.classList.remove('visible');
            });
            document.querySelectorAll('.file-expand-icon').forEach(icon => {
                icon.textContent = '▶';
            });
            // Collapse file lists
            document.querySelectorAll('.file-matches-list.visible').forEach(el => {
                el.classList.remove('visible');
            });
            // Collapse current file matches
            document.querySelectorAll('.current-file-matches.visible').forEach(el => {
                el.classList.remove('visible');
            });
            // Reset all expand icons
            document.querySelectorAll('.expand-icon').forEach(icon => {
                icon.textContent = '▶';
            });
        }

        collapseAllBtn.addEventListener('click', collapseAll);

        function editSearchText(id, currentText) {
            const searchItem = event.target.closest('.search-item-content');
            const patternDiv = searchItem.querySelector('.search-pattern');

            const textarea = document.createElement('textarea');
            textarea.className = 'search-pattern-input';
            textarea.value = currentText;
            textarea.rows = 1;

            patternDiv.replaceWith(textarea);
            textarea.focus();
            textarea.select();

            function finishEdit() {
                const newText = textarea.value;
                // Don't trim - preserve leading/trailing spaces for exact matching
                if (newText && newText !== currentText) {
                    vscode.postMessage({
                        command: 'updateSearchText',
                        id: id,
                        newText: newText
                    });
                } else {
                    // Restore original if empty or unchanged
                    vscode.postMessage({ command: 'requestUpdate' });
                }
            }

            textarea.addEventListener('blur', finishEdit);
            textarea.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    finishEdit();
                } else if (e.key === 'Escape') {
                    vscode.postMessage({ command: 'requestUpdate' });
                }
            });
        }

        // Delegated event listener for search pattern clicks
        searchList.addEventListener('click', (e) => {
            const target = e.target;
            if (target.classList.contains('search-pattern')) {
                const searchId = target.getAttribute('data-search-id');
                const currentText = target.textContent;
                if (searchId && currentText !== null) {
                    editSearchText(searchId, currentText);
                }
            }
        });

        function editFilePath(id, currentPath, e) {
            e.stopPropagation();
            const searchItem = e.target.closest('.search-item-content');
            const filePathDiv = searchItem.querySelector('.file-path-display');

            // Save original HTML to restore it later
            const originalHTML = filePathDiv.outerHTML;
            const parentElement = filePathDiv.parentElement;

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'file-path-input';
            input.value = currentPath;
            input.placeholder = 'e.g., src/**/*.ts';
            input.style.cssText = 'font-size: 10px; width: 100%; margin-top: 2px; padding: 2px 4px;';

            filePathDiv.replaceWith(input);
            input.focus();
            input.select();

            let isFinished = false;

            function finishEdit(cancel = false) {
                if (isFinished) return;
                isFinished = true;

                if (cancel) {
                    // Restore original HTML immediately
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = originalHTML;
                    input.replaceWith(tempDiv.firstChild);
                    return;
                }

                const newPath = input.value.trim();

                // Create a temporary placeholder with the new value (will be replaced by updateWebview)
                const placeholder = document.createElement('div');
                placeholder.className = 'file-path-display';
                placeholder.style.cssText = 'font-size: 10px; opacity: 0.6; margin-top: 2px; cursor: pointer; padding: 4px; margin-left: -4px; margin-right: -4px;';
                placeholder.textContent = newPath ? '▶ ' + newPath : '▶ Paths to include';
                placeholder.onclick = (e) => editFilePath(id, newPath, e);
                input.replaceWith(placeholder);

                // Then send update if path changed
                if (newPath !== currentPath) {
                    vscode.postMessage({
                        command: 'updateFilePath',
                        id: id,
                        newPath: newPath || undefined
                    });
                }
            }

            input.addEventListener('blur', () => finishEdit(false));
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    finishEdit(false);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    finishEdit(true);
                }
            });
        }

        function editExcludePath(id, currentPath, e) {
            e.stopPropagation();
            const searchItem = e.target.closest('.search-item-content');
            const excludePathDiv = searchItem.querySelector('.file-path-display.exclude-path');

            // Save original HTML to restore it later
            const originalHTML = excludePathDiv.outerHTML;
            const parentElement = excludePathDiv.parentElement;

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'exclude-path-input';
            input.value = currentPath;
            input.placeholder = 'e.g., **/*.test.ts, **/dist/**';
            input.style.cssText = 'font-size: 10px; width: 100%; margin-top: 2px; padding: 2px 4px;';

            excludePathDiv.replaceWith(input);
            input.focus();
            input.select();

            let isFinished = false;

            function finishEdit(cancel = false) {
                if (isFinished) return;
                isFinished = true;

                if (cancel) {
                    // Restore original HTML immediately
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = originalHTML;
                    input.replaceWith(tempDiv.firstChild);
                    return;
                }

                const newPath = input.value.trim();

                // Create a temporary placeholder with the new value (will be replaced by updateWebview)
                const placeholder = document.createElement('div');
                placeholder.className = 'file-path-display exclude-path';
                placeholder.style.cssText = 'font-size: 10px; opacity: 0.6; margin-top: 2px; cursor: pointer; padding: 4px; margin-left: -4px; margin-right: -4px;';
                placeholder.textContent = newPath ? '▶ ' + newPath : '▶ Paths to exclude';
                placeholder.onclick = (e) => editExcludePath(id, newPath, e);
                input.replaceWith(placeholder);

                // Then send update if path changed
                if (newPath !== currentPath) {
                    vscode.postMessage({
                        command: 'updateExcludePath',
                        id: id,
                        newPath: newPath || undefined
                    });
                }
            }

            input.addEventListener('blur', () => finishEdit(false));
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    finishEdit(false);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    finishEdit(true);
                }
            });
        }

        function findCommonPathPrefix(fileMatchDetails) {
            if (fileMatchDetails.length === 0) return [];

            // Split all paths into parts
            const allPaths = fileMatchDetails.map(f => f.filePath.split('/').slice(0, -1)); // Exclude filename

            if (allPaths.length === 1) return allPaths[0];

            // Find common prefix
            const commonPrefix = [];
            const minLength = Math.min(...allPaths.map(p => p.length));

            for (let i = 0; i < minLength; i++) {
                const part = allPaths[0][i];
                if (allPaths.every(path => path[i] === part)) {
                    commonPrefix.push(part);
                } else {
                    break;
                }
            }

            return commonPrefix;
        }

        function buildFolderTree(fileMatchDetails) {
            // Find common path prefix to collapse
            const commonPrefix = findCommonPathPrefix(fileMatchDetails);
            const commonPrefixLength = commonPrefix.length;

            // Create a tree structure: { folderPath: { files: [...], subfolders: {...} } }
            const tree = {};

            fileMatchDetails.forEach(fileDetail => {
                const parts = fileDetail.filePath.split('/');
                const fileName = parts[parts.length - 1];
                const folderParts = parts.slice(0, -1);

                // Remove common prefix from folder parts
                const relativeFolderParts = folderParts.slice(commonPrefixLength);

                // If no folders remain after removing prefix, files go at root
                if (relativeFolderParts.length === 0) {
                    // Create a single root node for the common prefix
                    const commonPathStr = commonPrefix.join('/');
                    if (!tree[commonPathStr]) {
                        tree[commonPathStr] = {
                            name: commonPathStr || '.',
                            fullPath: commonPathStr || '.',
                            files: [],
                            subfolders: {}
                        };
                    }
                    tree[commonPathStr].files.push({
                        name: fileName,
                        fullPath: fileDetail.filePath,
                        detail: fileDetail
                    });
                } else {
                    // Navigate/create folder structure
                    let currentLevel = tree;
                    let currentPath = commonPrefix.join('/');

                    relativeFolderParts.forEach((folderName, index) => {
                        currentPath += (currentPath ? '/' : '') + folderName;

                        if (!currentLevel[folderName]) {
                            currentLevel[folderName] = {
                                name: folderName,
                                fullPath: currentPath,
                                files: [],
                                subfolders: {}
                            };
                        }
                        currentLevel = currentLevel[folderName].subfolders;
                    });

                    // Add file to the last folder level
                    const targetLevel = relativeFolderParts.length > 1 ?
                        relativeFolderParts.slice(0, -1).reduce((level, name) => level[name].subfolders, tree) :
                        tree;

                    const lastFolder = relativeFolderParts[relativeFolderParts.length - 1];

                    if (!targetLevel[lastFolder]) {
                        const fullPath = commonPrefix.concat(relativeFolderParts).join('/');
                        targetLevel[lastFolder] = {
                            name: lastFolder,
                            fullPath: fullPath,
                            files: [],
                            subfolders: {}
                        };
                    }

                    targetLevel[lastFolder].files.push({
                        name: fileName,
                        fullPath: fileDetail.filePath,
                        detail: fileDetail
                    });
                }
            });

            // Don't wrap in common prefix - just return the tree directly
            // The common path is implicit and shouldn't be displayed as a folder
            return tree;
        }

        function renderFolderTree(tree, level = 0, searchId, workspaceRoot, color) {
            let html = '';

            // Add expand/collapse all button at the top level
            if (level === 0) {
                // Count total files in tree
                function countFiles(treeNode) {
                    let count = 0;
                    Object.values(treeNode).forEach(folder => {
                        count += folder.files.length;
                        count += countFiles(folder.subfolders);
                    });
                    return count;
                }
                const totalFiles = countFiles(tree);

                html += \`
                    <div class="tree-header" style="display: flex; align-items: center; padding: 0px 0px 1px 0px; margin-bottom: 4px; border-bottom: 2px solid \${color};">
                        <span class="tree-expand-all-icon" id="tree-expand-all-\${searchId}"
                              onclick="toggleExpandAllTree('\${searchId}')"
                              title="Expand/Collapse all folders and files"
                              style="cursor: pointer; padding: 2px 4px;">
                            <span class="codicon codicon-expand-all" style="font-size: 12px;"></span>
                        </span>
                        <span onclick="toggleExpandAllTree('\${searchId}')"
                              title="Expand/Collapse all folders and files"
                              style="font-size: 11px; opacity: 0.7; margin-left: 4px; cursor: pointer;">\${totalFiles} files</span>
                    </div>
                \`;
            }

            // Render folders first
            const folderNames = Object.keys(tree).sort();
            folderNames.forEach(folderName => {
                const folder = tree[folderName];
                const indent = level * 8;
                const folderId = 'folder-' + searchId + '-' + folder.fullPath.replace(/[^a-zA-Z0-9]/g, '-');

                // Count total matches in this folder (including subfolders)
                function countFolderMatches(folderNode) {
                    let count = 0;
                    folderNode.files.forEach(file => {
                        count += file.detail.matchCount;
                    });
                    Object.values(folderNode.subfolders).forEach(subfolder => {
                        count += countFolderMatches(subfolder);
                    });
                    return count;
                }
                const totalMatches = countFolderMatches(folder);
                html += \`
                    <div class="folder-item" style="margin-left: \${indent}px;">
                        <div class="folder-header">
                            <span class="folder-expand-all-icon" id="expand-all-\${folderId}"
                                  onclick="toggleExpandCollapseAll('\${folderId}', event)"
                                  title="Expand all files in this folder">
                                <span class="codicon codicon-expand-all" style="font-size: 12px;"></span>
                            </span>
                            <span class="folder-expand-icon" id="icon-\${folderId}" onclick="toggleFolder('\${folderId}')">▶</span>
                            <span onclick="toggleFolder('\${folderId}')" style="display: flex; align-items: center; flex: 1; cursor: pointer;">
                                <span class="codicon codicon-folder" style="font-size: 14px;"></span>
                                <span class="folder-name">\${escapeHtml(folder.name)}</span>
                                <span class="folder-match-count">(\${totalMatches})</span>
                            </span>
                        </div>
                        <div class="folder-contents" id="\${folderId}" style="display: none;">
                \`;

                // Render files in this folder
                folder.files.forEach(file => {
                    const fileId = 'file-' + searchId + '-' + file.fullPath.replace(/[^a-zA-Z0-9]/g, '-');

                    html += \`
                        <div class="file-item" style="margin-left: \${(level + 1) * 8}px;">
                            <div class="file-header" onclick="toggleFile('\${fileId}')">
                                <span class="file-expand-icon" id="icon-\${fileId}">▶</span>
                                <span class="codicon codicon-file" style="font-size: 14px;"></span>
                                <span class="file-name">\${escapeHtml(file.name)}</span>
                                <span class="file-match-count">(\${file.detail.matchCount})</span>
                            </div>
                            <div class="file-lines" id="\${fileId}" style="display: none;">
                    \`;

                    // Group line matches by line number
                    const groupedMatches = new Map();
                    file.detail.lines.forEach(lineMatch => {
                        if (!groupedMatches.has(lineMatch.line)) {
                            groupedMatches.set(lineMatch.line, {
                                line: lineMatch.line,
                                lineText: lineMatch.lineText,
                                matches: []
                            });
                        }
                        const group = groupedMatches.get(lineMatch.line);
                        const isDuplicate = group.matches.some(m =>
                            m.matchStart === lineMatch.matchStart && m.matchEnd === lineMatch.matchEnd
                        );
                        if (!isDuplicate) {
                            group.matches.push({
                                matchStart: lineMatch.matchStart,
                                matchEnd: lineMatch.matchEnd
                            });
                        }
                    });

                    // Render line matches
                    Array.from(groupedMatches.values()).forEach(group => {
                        html += \`
                            <div class="line-match"
                                 onclick="openFileAtLine(\${escapeJsStringForHtmlAttribute(file.fullPath)}, \${group.line}, \${escapeJsStringForHtmlAttribute(workspaceRoot || '')}, event)"
                                 onmouseover="handleLineHover(\${escapeJsStringForHtmlAttribute(file.fullPath)}, \${group.line}, \${escapeJsStringForHtmlAttribute(workspaceRoot || '')}, event)"
                                 onmouseout="handleLineOut(event)"
                                 style="cursor: pointer; margin-left: \${(level + 2) * 8}px;"
                                 title="Click to open, Ctrl+Hover for preview">
                                <span class="line-number">\${group.line}:</span>
                                <span class="line-text">\${createMultiMatchPreview(group.lineText, group.matches)}</span>
                            </div>
                        \`;
                    });

                    html += \`
                            </div>
                        </div>
                    \`;
                });

                // Recursively render subfolders
                html += renderFolderTree(folder.subfolders, level + 1, searchId, workspaceRoot, color);

                html += \`
                        </div>
                    </div>
                \`;
            });

            return html;
        }

        // Render file matches as a flat list (like VSCode native search)
        function renderFlatList(fileMatchDetails, searchId, workspaceRoot, color) {
            // Add expand/collapse all button at the top
            let html = \`
                <div class="flat-list-header" style="display: flex; align-items: center; padding: 1px 0; margin-bottom: 4px; border-bottom: 2px solid \${color || 'var(--vscode-panel-border)'};">
                    <span class="flat-expand-all-icon" id="flat-expand-all-\${searchId}"
                          onclick="toggleExpandAllFlat('\${searchId}')"
                          title="Expand/Collapse all files"
                          style="cursor: pointer; padding: 2px 4px;">
                        <span class="codicon codicon-expand-all" style="font-size: 12px;"></span>
                    </span>
                    <span onclick="toggleExpandAllFlat('\${searchId}')"
                          title="Expand/Collapse all files"
                          style="font-size: 11px; opacity: 0.7; margin-left: 4px; cursor: pointer;">\${fileMatchDetails.length} files</span>
                </div>
            \`;

            fileMatchDetails.forEach(fileDetail => {
                const fileId = 'flat-file-' + searchId + '-' + fileDetail.filePath.replace(/[^a-zA-Z0-9]/g, '-');

                html += \`
                    <div class="flat-file-item">
                        <div class="flat-file-header" onclick="toggleFile('\${fileId}')">
                            <span class="file-expand-icon" id="icon-\${fileId}">▶</span>
                            <span class="codicon codicon-file" style="font-size: 14px;"></span>
                            <span class="flat-file-path">\${escapeHtml(fileDetail.filePath)}</span>
                            <span class="file-match-count">(\${fileDetail.matchCount})</span>
                        </div>
                        <div class="file-lines" id="\${fileId}" style="display: none;">
                \`;

                // Group line matches by line number
                const groupedMatches = new Map();
                fileDetail.lines.forEach(lineMatch => {
                    if (!groupedMatches.has(lineMatch.line)) {
                        groupedMatches.set(lineMatch.line, {
                            line: lineMatch.line,
                            lineText: lineMatch.lineText,
                            matches: []
                        });
                    }
                    const group = groupedMatches.get(lineMatch.line);
                    const isDuplicate = group.matches.some(m =>
                        m.matchStart === lineMatch.matchStart && m.matchEnd === lineMatch.matchEnd
                    );
                    if (!isDuplicate) {
                        group.matches.push({
                            matchStart: lineMatch.matchStart,
                            matchEnd: lineMatch.matchEnd
                        });
                    }
                });

                // Render line matches
                Array.from(groupedMatches.values()).forEach(group => {
                    html += \`
                        <div class="line-match"
                             onclick="openFileAtLine(\${escapeJsStringForHtmlAttribute(fileDetail.filePath)}, \${group.line}, \${escapeJsStringForHtmlAttribute(workspaceRoot || '')}, event)"
                             onmouseover="handleLineHover(\${escapeJsStringForHtmlAttribute(fileDetail.filePath)}, \${group.line}, \${escapeJsStringForHtmlAttribute(workspaceRoot || '')}, event)"
                             onmouseout="handleLineOut(event)"
                             style="cursor: pointer; margin-left: 16px;"
                             title="Click to open, Ctrl+Hover for preview">
                            <span class="line-number">\${group.line}:</span>
                            <span class="line-text">\${createMultiMatchPreview(group.lineText, group.matches)}</span>
                        </div>
                    \`;
                });

                html += \`
                        </div>
                    </div>
                \`;
            });

            return html;
        }

        // Toggle expand/collapse all files in flat view
        function toggleExpandAllFlat(searchId) {
            const fileMatchesList = document.getElementById('files-' + searchId);
            if (!fileMatchesList) return;

            const allFileLines = fileMatchesList.querySelectorAll('.file-lines');
            const allExpandIcons = fileMatchesList.querySelectorAll('.file-expand-icon');
            const expandAllBtn = document.getElementById('flat-expand-all-' + searchId);

            // Check if any files are collapsed
            let hasCollapsed = false;
            allFileLines.forEach(el => {
                if (el.style.display === 'none') {
                    hasCollapsed = true;
                }
            });

            if (hasCollapsed) {
                // Expand all
                forceExpandAllFlat(searchId);
            } else {
                // Collapse all
                allFileLines.forEach(el => {
                    el.style.display = 'none';
                });
                allExpandIcons.forEach(icon => {
                    icon.textContent = '▶';
                });
                if (expandAllBtn) {
                    const iconEl = expandAllBtn.querySelector('.codicon');
                    if (iconEl) {
                        iconEl.classList.remove('codicon-collapse-all');
                        iconEl.classList.add('codicon-expand-all');
                    }
                    expandAllBtn.setAttribute('title', 'Expand all files');
                }
            }
        }

        // Force expand all files in flat view (no toggle)
        function forceExpandAllFlat(searchId) {
            const fileMatchesList = document.getElementById('files-' + searchId);
            if (!fileMatchesList) return;

            const allFileLines = fileMatchesList.querySelectorAll('.file-lines');
            const allExpandIcons = fileMatchesList.querySelectorAll('.file-expand-icon');
            const expandAllBtn = document.getElementById('flat-expand-all-' + searchId);

            allFileLines.forEach(el => {
                el.style.display = 'block';
            });
            allExpandIcons.forEach(icon => {
                icon.textContent = '▼';
            });
            if (expandAllBtn) {
                const iconEl = expandAllBtn.querySelector('.codicon');
                if (iconEl) {
                    iconEl.classList.remove('codicon-expand-all');
                    iconEl.classList.add('codicon-collapse-all');
                }
                expandAllBtn.setAttribute('title', 'Collapse all files');
            }
        }

        function toggleExpandAllTree(searchId) {
            const fileMatchesList = document.getElementById('files-' + searchId);
            if (!fileMatchesList) return;

            const allFolderContents = fileMatchesList.querySelectorAll('.folder-contents');
            const allFolderIcons = fileMatchesList.querySelectorAll('.folder-expand-icon');
            const allFileLines = fileMatchesList.querySelectorAll('.file-lines');
            const allFileIcons = fileMatchesList.querySelectorAll('.file-expand-icon');
            const expandAllBtn = document.getElementById('tree-expand-all-' + searchId);

            // Check if any folders or files are collapsed
            let hasCollapsed = false;
            allFolderContents.forEach(el => {
                if (el.style.display === 'none' || el.style.display === '') {
                    hasCollapsed = true;
                }
            });
            if (!hasCollapsed) {
                allFileLines.forEach(el => {
                    if (el.style.display === 'none' || el.style.display === '') {
                        hasCollapsed = true;
                    }
                });
            }

            if (hasCollapsed) {
                // Expand all folders and files
                forceExpandAllTree(searchId);
            } else {
                // Collapse all folders and files
                allFolderContents.forEach(el => {
                    el.style.display = 'none';
                });
                allFolderIcons.forEach(icon => {
                    icon.textContent = '▶';
                });
                allFileLines.forEach(el => {
                    el.style.display = 'none';
                });
                allFileIcons.forEach(icon => {
                    icon.textContent = '▶';
                });
                if (expandAllBtn) {
                    const iconEl = expandAllBtn.querySelector('.codicon');
                    if (iconEl) {
                        iconEl.classList.remove('codicon-collapse-all');
                        iconEl.classList.add('codicon-expand-all');
                    }
                    expandAllBtn.setAttribute('title', 'Expand all folders and files');
                }
            }
        }

        // Force expand all folders and files (no toggle)
        function forceExpandAllTree(searchId) {
            const fileMatchesList = document.getElementById('files-' + searchId);
            if (!fileMatchesList) return;

            const allFolderContents = fileMatchesList.querySelectorAll('.folder-contents');
            const allFolderIcons = fileMatchesList.querySelectorAll('.folder-expand-icon');
            const allFileLines = fileMatchesList.querySelectorAll('.file-lines');
            const allFileIcons = fileMatchesList.querySelectorAll('.file-expand-icon');
            const expandAllBtn = document.getElementById('tree-expand-all-' + searchId);

            allFolderContents.forEach(el => {
                el.style.display = 'block';
            });
            allFolderIcons.forEach(icon => {
                icon.textContent = '▼';
            });
            allFileLines.forEach(el => {
                el.style.display = 'block';
            });
            allFileIcons.forEach(icon => {
                icon.textContent = '▼';
            });
            if (expandAllBtn) {
                const iconEl = expandAllBtn.querySelector('.codicon');
                if (iconEl) {
                    iconEl.classList.remove('codicon-expand-all');
                    iconEl.classList.add('codicon-collapse-all');
                }
                expandAllBtn.setAttribute('title', 'Collapse all folders and files');
            }
        }

        function toggleFolder(folderId) {
            const folderContents = document.getElementById(folderId);
            const icon = document.getElementById('icon-' + folderId);
            const expandAllIcon = document.getElementById('expand-all-' + folderId);

            if (folderContents && icon) {
                const isExpanding = folderContents.style.display === 'none';

                if (isExpanding) {
                    // Expanding folder
                    folderContents.style.display = 'block';
                    icon.textContent = '▼';
                } else {
                    // Collapsing folder
                    folderContents.style.display = 'none';
                    icon.textContent = '▶';
                    // Reset icon back to expand-all state when collapsing
                    if (expandAllIcon) {
                        const iconElement = expandAllIcon.querySelector('.codicon');
                        if (iconElement) {
                            iconElement.classList.remove('codicon-collapse-all');
                            iconElement.classList.add('codicon-expand-all');
                            expandAllIcon.setAttribute('title', 'Expand all files in this folder');
                        }
                    }
                }

                // Extract searchId from folderId by finding the parent search item
                const searchItem = folderContents.closest('[data-search-id]');
                if (searchItem) {
                    const searchId = searchItem.getAttribute('data-search-id');
                    if (searchId) {
                        if (isExpanding) {
                            // Use short delay when expanding to wait for content to load
                            setTimeout(() => setupResizeHandle(searchId), 50);
                        } else {
                            // When collapsing, check immediately
                            setTimeout(() => setupResizeHandle(searchId), 0);
                        }
                    }
                }
            }
        }

        function toggleExpandCollapseAll(folderId, event) {
            // Stop propagation to prevent toggling the folder
            if (event) {
                event.stopPropagation();
            }

            const expandAllIconContainer = document.getElementById('expand-all-' + folderId);
            if (!expandAllIconContainer) return;

            const iconElement = expandAllIconContainer.querySelector('.codicon');
            if (!iconElement) return;

            const folderContents = document.getElementById(folderId);
            const folderIcon = document.getElementById('icon-' + folderId);
            if (!folderContents || !folderIcon) return;

            // Check current state based on icon class
            const isExpandAll = iconElement.classList.contains('codicon-expand-all');

            if (isExpandAll) {
                // Expand the folder itself first
                folderContents.style.display = 'block';
                folderIcon.textContent = '▼';

                // Expand all contents
                expandAllInFolder(folderId);

                // Change icon to collapse all
                iconElement.classList.remove('codicon-expand-all');
                iconElement.classList.add('codicon-collapse-all');
                expandAllIconContainer.setAttribute('title', 'Collapse all files in this folder');
            } else {
                // Collapse all contents
                collapseAllInFolder(folderId);

                // Collapse the folder itself
                folderContents.style.display = 'none';
                folderIcon.textContent = '▶';

                // Change icon to expand all
                iconElement.classList.remove('codicon-collapse-all');
                iconElement.classList.add('codicon-expand-all');
                expandAllIconContainer.setAttribute('title', 'Expand all files in this folder');
            }
        }

        function expandAllInFolder(folderId) {
            const folderContents = document.getElementById(folderId);
            if (!folderContents) return;

            // Find all file items within this folder (including nested folders)
            const allFileItems = folderContents.querySelectorAll('.file-item');
            allFileItems.forEach(fileItem => {
                const fileHeader = fileItem.querySelector('.file-header');
                if (fileHeader) {
                    const fileId = fileHeader.querySelector('.file-expand-icon')?.id?.replace('icon-', '');
                    if (fileId) {
                        const fileLines = document.getElementById(fileId);
                        const icon = document.getElementById('icon-' + fileId);
                        if (fileLines && icon && fileLines.style.display === 'none') {
                            fileLines.style.display = 'block';
                            icon.textContent = '▼';
                        }
                    }
                }
            });

            // Also expand all subfolders and update their expand-all icons
            const allSubfolders = folderContents.querySelectorAll('.folder-item');
            allSubfolders.forEach(folderItem => {
                const folderHeader = folderItem.querySelector('.folder-header');
                if (folderHeader) {
                    const subfolderId = folderHeader.querySelector('.folder-expand-icon')?.id?.replace('icon-', '');
                    if (subfolderId) {
                        const subfolderContents = document.getElementById(subfolderId);
                        const icon = document.getElementById('icon-' + subfolderId);
                        const expandAllIcon = document.getElementById('expand-all-' + subfolderId);

                        if (subfolderContents && icon && subfolderContents.style.display === 'none') {
                            subfolderContents.style.display = 'block';
                            icon.textContent = '▼';
                        }

                        // Change subfolder's expand-all icon to collapse-all
                        if (expandAllIcon) {
                            const iconElement = expandAllIcon.querySelector('.codicon');
                            if (iconElement) {
                                iconElement.classList.remove('codicon-expand-all');
                                iconElement.classList.add('codicon-collapse-all');
                                expandAllIcon.setAttribute('title', 'Collapse all files in this folder');
                            }
                        }
                    }
                }
            });

            // Extract searchId from folderId by finding the parent search item
            const searchItem = folderContents.closest('[data-search-id]');
            if (searchItem) {
                const searchId = searchItem.getAttribute('data-search-id');
                if (searchId) {
                    setTimeout(() => setupResizeHandle(searchId), 50);
                }
            }
        }

        function collapseAllInFolder(folderId) {
            const folderContents = document.getElementById(folderId);
            if (!folderContents) return;

            // Find all file items within this folder (including nested folders)
            const allFileItems = folderContents.querySelectorAll('.file-item');
            allFileItems.forEach(fileItem => {
                const fileHeader = fileItem.querySelector('.file-header');
                if (fileHeader) {
                    const fileId = fileHeader.querySelector('.file-expand-icon')?.id?.replace('icon-', '');
                    if (fileId) {
                        const fileLines = document.getElementById(fileId);
                        const icon = document.getElementById('icon-' + fileId);
                        if (fileLines && icon && fileLines.style.display !== 'none') {
                            fileLines.style.display = 'none';
                            icon.textContent = '▶';
                        }
                    }
                }
            });

            // Also collapse all subfolders and reset their expand-all icons
            const allSubfolders = folderContents.querySelectorAll('.folder-item');
            allSubfolders.forEach(folderItem => {
                const folderHeader = folderItem.querySelector('.folder-header');
                if (folderHeader) {
                    const subfolderId = folderHeader.querySelector('.folder-expand-icon')?.id?.replace('icon-', '');
                    if (subfolderId) {
                        const subfolderContents = document.getElementById(subfolderId);
                        const icon = document.getElementById('icon-' + subfolderId);
                        const expandAllIcon = document.getElementById('expand-all-' + subfolderId);

                        if (subfolderContents && icon && subfolderContents.style.display !== 'none') {
                            subfolderContents.style.display = 'none';
                            icon.textContent = '▶';
                        }

                        // Reset subfolder's icon back to expand-all
                        if (expandAllIcon) {
                            const iconElement = expandAllIcon.querySelector('.codicon');
                            if (iconElement) {
                                iconElement.classList.remove('codicon-collapse-all');
                                iconElement.classList.add('codicon-expand-all');
                                expandAllIcon.setAttribute('title', 'Expand all files in this folder');
                            }
                        }
                    }
                }
            });

            // Extract searchId from folderId by finding the parent search item
            const searchItem = folderContents.closest('[data-search-id]');
            if (searchItem) {
                const searchId = searchItem.getAttribute('data-search-id');
                if (searchId) {
                    setTimeout(() => setupResizeHandle(searchId), 0);
                }
            }
        }

        function toggleFile(fileId) {
            const fileLines = document.getElementById(fileId);
            const icon = document.getElementById('icon-' + fileId);
            if (fileLines && icon) {
                const isExpanding = fileLines.style.display === 'none';

                if (isExpanding) {
                    fileLines.style.display = 'block';
                    icon.textContent = '▼';
                } else {
                    fileLines.style.display = 'none';
                    icon.textContent = '▶';
                }

                // Extract searchId from fileId
                const searchItem = fileLines.closest('[data-search-id]');
                if (searchItem) {
                    const searchId = searchItem.getAttribute('data-search-id');
                    if (searchId) {
                        if (isExpanding) {
                            // Use short delay when expanding
                            setTimeout(() => setupResizeHandle(searchId), 50);
                        } else {
                            // When collapsing, check immediately
                            setTimeout(() => setupResizeHandle(searchId), 0);
                        }
                    }
                }
            }
        }

        window.toggleFolder = toggleFolder;
        window.toggleFile = toggleFile;
        window.expandAllInFolder = expandAllInFolder;
        window.collapseAllInFolder = collapseAllInFolder;
        window.toggleExpandCollapseAll = toggleExpandCollapseAll;
        window.toggleExpandAllFlat = toggleExpandAllFlat;
        window.toggleExpandAllTree = toggleExpandAllTree;
        window.forceExpandAllFlat = forceExpandAllFlat;
        window.forceExpandAllTree = forceExpandAllTree;

        function updateMatchListsForSearch(search, searchItem) {
            const searchItemBody = searchItem.querySelector('.search-item-body');
            if (!searchItemBody) return;

            // Get references to both list types
            let fileMatchesList = searchItem.querySelector(\`#files-\${search.id}\`);
            let currentMatchesList = searchItem.querySelector(\`#current-matches-\${search.id}\`);
            let resizeHandle = searchItemBody.querySelector(\`#resize-handle-\${search.id}\`);

            // Determine which type of search this is
            const hasFileMatches = search.fileMatchDetails && search.fileMatchDetails.length > 0;
            // Show current file matches section if it's a local search and we have a fileName (even if 0 matches)
            const shouldShowCurrentFileMatches = !search.filePath && search.currentFileName;

            // Remove file matches list if switching to current file search
            if (!hasFileMatches && fileMatchesList) {
                fileMatchesList.remove();
                fileMatchesList = null;
            }

            // Remove current file matches list if switching to file search or no file name
            if (!shouldShowCurrentFileMatches && currentMatchesList) {
                currentMatchesList.remove();
                currentMatchesList = null;
            }

            // Remove resize handle if switching from file to current file search
            if (!hasFileMatches && resizeHandle) {
                resizeHandle.remove();
                resizeHandle = null;
            }

            // Update or create file matches list
            if (hasFileMatches) {
                // Create container if it doesn't exist
                if (!fileMatchesList) {
                    fileMatchesList = document.createElement('div');
                    fileMatchesList.id = 'files-' + search.id;
                    fileMatchesList.className = 'file-matches-list';
                    searchItemBody.appendChild(fileMatchesList);
                }

                if (fileMatchesList) {
                // Save the expanded state of folders/files before rebuilding
                const wasVisible = fileMatchesList.classList.contains('visible');
                const expandedFolders = [];
                const expandedFiles = [];
                const expandAllIcons = [];

                fileMatchesList.querySelectorAll('.folder-contents').forEach(folder => {
                    if (folder.style.display === 'block') {
                        expandedFolders.push(folder.id);
                    }
                });

                fileMatchesList.querySelectorAll('.file-lines').forEach(file => {
                    if (file.style.display === 'block') {
                        expandedFiles.push(file.id);
                    }
                });

                fileMatchesList.querySelectorAll('.folder-expand-all-icon').forEach(icon => {
                    const iconElement = icon.querySelector('.codicon');
                    if (iconElement && iconElement.classList.contains('codicon-collapse-all')) {
                        expandAllIcons.push(icon.id);
                    }
                });

                // Render based on display mode (tree or flat)
                let contentHtml;
                if (search.displayMode === 'flat') {
                    contentHtml = renderFlatList(search.fileMatchDetails, search.id, search.workspaceRoot, search.color);
                } else {
                    // Build folder tree structure
                    const folderTree = buildFolderTree(search.fileMatchDetails);
                    contentHtml = renderFolderTree(folderTree, 0, search.id, search.workspaceRoot, search.color);
                }
                fileMatchesList.innerHTML = contentHtml;

                // Add resize handle to searchItemBody (not inside fileMatchesList)
                let resizeHandle = searchItemBody.querySelector('#resize-handle-' + search.id);
                if (!resizeHandle) {
                    resizeHandle = document.createElement('div');
                    resizeHandle.className = 'file-matches-resize-handle';
                    resizeHandle.id = 'resize-handle-' + search.id;
                    searchItemBody.appendChild(resizeHandle);
                }

                // Restore expanded state immediately (no timeout)
                if (wasVisible) {
                    fileMatchesList.classList.add('visible');
                }

                expandedFolders.forEach(folderId => {
                    const folder = document.getElementById(folderId);
                    const iconId = folderId.replace('folder-', 'icon-folder-');
                    const icon = document.getElementById(iconId);
                    if (folder) folder.style.display = 'block';
                    if (icon) icon.textContent = '▼';
                });

                expandedFiles.forEach(fileId => {
                    const file = document.getElementById(fileId);
                    const iconId = fileId.replace('file-', 'icon-file-');
                    const icon = document.getElementById(iconId);
                    if (file) file.style.display = 'block';
                    if (icon) icon.textContent = '▼';
                });

                expandAllIcons.forEach(iconId => {
                    const expandAllIcon = document.getElementById(iconId);
                    if (expandAllIcon) {
                        const iconElement = expandAllIcon.querySelector('.codicon');
                        if (iconElement) {
                            iconElement.classList.remove('codicon-expand-all');
                            iconElement.classList.add('codicon-collapse-all');
                            expandAllIcon.setAttribute('title', 'Collapse all files in this folder');
                        }
                    }
                });

                // Setup resize handle whenever there's content
                setTimeout(() => setupResizeHandle(search.id), 50);
            }
            }

            // Update or create current file matches list
            if (shouldShowCurrentFileMatches) {
                // Create container if it doesn't exist
                if (!currentMatchesList) {
                    currentMatchesList = document.createElement('div');
                    currentMatchesList.id = 'current-matches-' + search.id;
                    currentMatchesList.className = 'current-file-matches';
                    searchItemBody.appendChild(currentMatchesList);
                }

                if (currentMatchesList) {
                // Add file name header if available
                const fileNameHeader = search.currentFileName ? \`
                    <div class="current-file-header" style="font-size: 11px; opacity: 0.7; padding: 4px 0 4px 16px; margin-bottom: 4px; border-bottom: 1px solid \${search.color};">
                        \${escapeHtml(search.currentFileName)}
                    </div>
                \` : '';

                // Check if there are matches to display
                if (search.currentFileMatches && search.currentFileMatches.length > 0) {
                    // Group matches by line number
                    const groupedMatches = new Map();
                    search.currentFileMatches.forEach(lineMatch => {
                        if (!groupedMatches.has(lineMatch.line)) {
                            groupedMatches.set(lineMatch.line, {
                                line: lineMatch.line,
                                lineText: lineMatch.lineText,
                                matches: []
                            });
                        }
                        const group = groupedMatches.get(lineMatch.line);
                        const isDuplicate = group.matches.some(m =>
                            m.matchStart === lineMatch.matchStart && m.matchEnd === lineMatch.matchEnd
                        );
                        if (!isDuplicate) {
                            group.matches.push({
                                matchStart: lineMatch.matchStart,
                                matchEnd: lineMatch.matchEnd
                            });
                        }
                    });

                    const lineItems = Array.from(groupedMatches.values()).map(group => \`
                        <div class="line-match"
                             onclick="goToLine(\${group.line}, event)"
                             onmouseover="handleCurrentFileLineHover(\${group.line}, event)"
                             onmouseout="handleLineOut(event)"
                             style="cursor: pointer;"
                             title="Click to go to line, Ctrl+Hover for preview">
                            <span class="line-number">\${group.line}:</span>
                            <span class="line-text">\${createMultiMatchPreview(group.lineText, group.matches)}</span>
                        </div>
                    \`).join('');
                    currentMatchesList.innerHTML = fileNameHeader + lineItems;
                } else {
                    // No matches - just show the file name header
                    currentMatchesList.innerHTML = fileNameHeader;
                }
            }
            }
        }

        function updateSearchList(searches) {
            // Check if we can do a fast update (only counts/loading states changed)
            const existingSearchIds = Array.from(document.querySelectorAll('.search-item')).map(el => el.getAttribute('data-search-id'));
            const newSearchIds = searches.map(s => s.id);
            const sameSearches = existingSearchIds.length === newSearchIds.length &&
                                 existingSearchIds.every((id, idx) => id === newSearchIds[idx]);

            // Check if there are any edit inputs open (textarea editing search term)
            const hasEditInputs = document.querySelector('.search-pattern-input') !== null;

            // Check if any filter states, pause states, or display mode have changed
            let hasFilterChanges = false;
            let hasPauseChanges = false;
            let hasDisplayModeChanges = false;
            let hasFilePathTypeChange = false;
            const globalToLocalTransitions = []; // Track searches transitioning from global to local
            if (sameSearches && !hasEditInputs) {
                for (const search of searches) {
                    const searchItem = document.querySelector('[data-search-id="' + search.id + '"]');
                    if (!searchItem) continue;

                    // Check if pause state changed
                    const currentlyPaused = searchItem.classList.contains('paused');
                    if (currentlyPaused !== (search.isPaused || false)) {
                        hasPauseChanges = true;
                        break;
                    }

                    // Check if filePath presence changed (local <-> global transition)
                    const displayModeBtn = searchItem.querySelector('.display-mode-btn');
                    const hadFilePath = displayModeBtn !== null; // Button only exists if filePath was set
                    const hasFilePath = search.filePath !== undefined && search.filePath !== '';
                    if (hadFilePath !== hasFilePath) {
                        hasFilePathTypeChange = true;
                        // Track global→local transitions (had filePath, now doesn't)
                        if (hadFilePath && !hasFilePath) {
                            globalToLocalTransitions.push(search.id);
                        }
                        break;
                    }

                    // Check if display mode changed
                    if (displayModeBtn) {
                        const currentDisplayMode = displayModeBtn.textContent === '▦' ? 'flat' : 'tree';
                        if (currentDisplayMode !== (search.displayMode || 'tree')) {
                            hasDisplayModeChanges = true;
                            break;
                        }
                    }

                    const filters = searchItem.querySelector('.search-filters');
                    if (!filters) continue;

                    const caseIcon = filters.querySelector('[title="Match Case"]');
                    const wordIcon = filters.querySelector('[title="Match Whole Word"]');
                    const regexIcon = filters.querySelector('[title="Use Regular Expression"]');

                    const currentCaseActive = caseIcon?.classList.contains('active') || false;
                    const currentWordActive = wordIcon?.classList.contains('active') || false;
                    const currentRegexActive = regexIcon?.classList.contains('active') || false;

                    if (currentCaseActive !== (search.isCaseSensitive || false) ||
                        currentWordActive !== (search.isWholeWord || false) ||
                        currentRegexActive !== (search.isRegex || false)) {
                        hasFilterChanges = true;
                        break;
                    }
                }
            }

            if (sameSearches && !hasEditInputs && !hasFilterChanges && !hasPauseChanges && !hasDisplayModeChanges && !hasFilePathTypeChange) {
                // Fast update: only update match counts, loading icons, and match lists
                searches.forEach(search => {
                    const searchItem = document.querySelector(\`[data-search-id="\${search.id}"]\`);
                    if (!searchItem) return;

                    // Update match count
                    const matchCountDisplay = searchItem.querySelector('.match-count-display');
                    if (matchCountDisplay) {
                        matchCountDisplay.textContent = \`\${search.matchCount} matches\${search.filePath ? ' (in path)' : ''}\`;
                    }

                    // Update currentMatchIndex/matchCount display
                    const filters = searchItem.querySelector('.search-filters');
                    if (filters) {
                        const indexDisplay = filters.querySelector('span[style*="margin-right: 6px"]');
                        if (indexDisplay) {
                            indexDisplay.textContent = \`\${search.currentMatchIndex}/\${search.matchCount}\`;
                        }
                    }

                    // Update loading icon
                    const matchCountContainer = matchCountDisplay?.parentElement;
                    if (matchCountContainer) {
                        let loadingIcon = matchCountContainer.querySelector('.codicon-loading');
                        if (search.isSearching && !loadingIcon) {
                            // Add loading icon
                            const icon = document.createElement('span');
                            icon.className = 'codicon codicon-loading codicon-modifier-spin';
                            icon.style.fontSize = '14px';
                            icon.style.marginRight = '4px';
                            matchCountContainer.insertBefore(icon, matchCountDisplay);
                        } else if (!search.isSearching && loadingIcon) {
                            // Remove loading icon
                            loadingIcon.remove();
                        }
                    }

                    // Update expand icon visibility (only show when search is finished)
                    // For local searches, show expand icon if we have a currentFileName (even with 0 matches)
                    const hasMatches = !search.isSearching &&
                                      ((search.fileMatchDetails && search.fileMatchDetails.length > 0) ||
                                       (!search.filePath && search.currentFileName));
                    let expandIcon = matchCountContainer?.querySelector('.expand-icon');
                    if (hasMatches && !expandIcon) {
                        // Add expand icon
                        expandIcon = document.createElement('span');
                        expandIcon.className = 'expand-icon';
                        expandIcon.setAttribute('title', 'Show matches');
                        expandIcon.textContent = '▶';
                        expandIcon.onclick = (e) => {
                            // Manually toggle since we're creating the element dynamically
                            const fileList = document.getElementById('files-' + search.id);
                            const currentFileList = document.getElementById('current-matches-' + search.id);

                            if (fileList) {
                                fileList.classList.toggle('visible');
                                expandIcon.textContent = fileList.classList.contains('visible') ? '▼' : '▶';
                            } else if (currentFileList) {
                                currentFileList.classList.toggle('visible');
                                expandIcon.textContent = currentFileList.classList.contains('visible') ? '▼' : '▶';
                            }
                        };
                        matchCountContainer.appendChild(expandIcon);
                    } else if (!hasMatches && expandIcon) {
                        // Remove expand icon if no matches or still searching
                        expandIcon.remove();
                    }

                    // Only update match lists when search is finished (not during progressive updates)
                    if (!search.isSearching && (hasMatches || search.filePath)) {
                        // For global searches, we need to detect if file content changed (line numbers etc.)
                        // Create a simple hash of the fileMatchDetails to detect changes
                        const fileMatchesList = document.getElementById('files-' + search.id);
                        const currentMatchesList = document.getElementById('current-matches-' + search.id);
                        let currentHash = '';
                        if (search.fileMatchDetails && search.fileMatchDetails.length > 0) {
                            // Hash based on file paths and line numbers
                            currentHash = search.fileMatchDetails.map(f =>
                                f.filePath + ':' + f.lines.map(l => l.line).join(',')
                            ).join('|');
                        } else if (!search.filePath && search.currentFileName) {
                            // Hash for current file matches - include file name to detect file changes
                            const matchesHash = search.currentFileMatches && search.currentFileMatches.length > 0
                                ? search.currentFileMatches.map(l => l.line).join(',')
                                : 'no-matches';
                            currentHash = search.currentFileName + ':' + matchesHash;
                        }

                        const previousHash = fileMatchesList ? fileMatchesList.dataset.contentHash :
                                            (currentMatchesList ? currentMatchesList.dataset.contentHash : '');
                        const needsUpdate = (!fileMatchesList && !currentMatchesList) || previousHash !== currentHash;

                        if (needsUpdate) {
                            updateMatchListsForSearch(search, searchItem);
                            // Store the hash to detect changes
                            const list = document.getElementById('files-' + search.id) ||
                                        document.getElementById('current-matches-' + search.id);
                            if (list) {
                                list.dataset.contentHash = currentHash;
                            }
                        }
                    }
                });
                return globalToLocalTransitions; // Return empty array for fast update path
            }

            // Full rebuild if searches changed
            // Save the current expanded state before updating
            const expandedStates = new Map();
            document.querySelectorAll('.file-matches-list.visible').forEach(el => {
                const id = el.id.replace('files-', '');
                expandedStates.set('files-' + id, true);
            });
            document.querySelectorAll('.current-file-matches.visible').forEach(el => {
                const id = el.id.replace('current-matches-', '');
                expandedStates.set('current-matches-' + id, true);
            });
            document.querySelectorAll('.line-matches.visible').forEach(el => {
                expandedStates.set(el.id, true);
            });

            if (searches.length === 0) {
                searchList.innerHTML = '';
            } else {
                searchList.innerHTML = searches.map((search) => {
                    const filePathInfo = search.filePath
                        ? \`<div class="file-path-display"
                                onclick="editFilePath('\${search.id}', '\${escapeHtml(search.filePath).replace(/'/g, "&apos;")}', event)"
                                title="Click to edit paths to include"
                                style="font-size: 10px; opacity: 0.6; margin-top: 2px; cursor: pointer; padding: 4px; margin-left: -4px; margin-right: -4px;">▶ \${escapeHtml(search.filePath)}</div>\`
                        : \`<div class="file-path-display add-path"
                                onclick="editFilePath('\${search.id}', '', event)"
                                title="Add paths to include"
                                style="font-size: 10px; opacity: 0.4; margin-top: 2px; cursor: pointer; padding: 4px; margin-left: -4px; margin-right: -4px;">▶ Paths to include</div>\`;

                    const excludePathInfo = search.excludePath
                        ? \`<div class="file-path-display exclude-path"
                                onclick="editExcludePath('\${search.id}', '\${escapeHtml(search.excludePath).replace(/'/g, "&apos;")}', event)"
                                title="Click to edit paths to exclude"
                                style="font-size: 10px; opacity: 0.6; margin-top: 2px; cursor: pointer; padding: 4px; margin-left: -4px; margin-right: -4px;">▶ \${escapeHtml(search.excludePath)}</div>\`
                        : \`<div class="file-path-display exclude-path add-path"
                                onclick="editExcludePath('\${search.id}', '', event)"
                                title="Add paths to exclude"
                                style="font-size: 10px; opacity: 0.4; margin-top: 2px; cursor: pointer; padding: 4px; margin-left: -4px; margin-right: -4px;">▶ Paths to exclude</div>\`;

                    // Generate file matches (tree or flat view based on displayMode)
                    let fileMatchesHTML = '';
                    if (search.fileMatchDetails && search.fileMatchDetails.length > 0) {
                        let contentHtml = '';
                        if (search.displayMode === 'flat') {
                            // Flat list view (like VSCode native search)
                            contentHtml = renderFlatList(search.fileMatchDetails, search.id, search.workspaceRoot, search.color);
                        } else {
                            // Tree view (folder structure)
                            const folderTree = buildFolderTree(search.fileMatchDetails);
                            contentHtml = renderFolderTree(folderTree, 0, search.id, search.workspaceRoot, search.color);
                        }
                        fileMatchesHTML = \`<div class="file-matches-list" id="files-\${search.id}">\${contentHtml}</div>\`;
                    }

                    // Generate current file matches with line previews (for current file searches)
                    let currentFileMatchesHTML = '';
                    if (!search.filePath && search.currentFileName) {
                        // Add file name header
                        const fileNameHeader = \`
                            <div class="current-file-header" style="font-size: 11px; opacity: 0.7; padding: 4px 0 4px 16px; margin-bottom: 4px; border-bottom: 1px solid \${search.color};">
                                \${escapeHtml(search.currentFileName)}
                            </div>
                        \`;

                        let lineItems = '';
                        if (search.currentFileMatches && search.currentFileMatches.length > 0) {
                            // Group matches by line number to handle multiple matches on the same line
                            const groupedMatches = new Map();
                            search.currentFileMatches.forEach(lineMatch => {
                                if (!groupedMatches.has(lineMatch.line)) {
                                    groupedMatches.set(lineMatch.line, {
                                        line: lineMatch.line,
                                        lineText: lineMatch.lineText,
                                        matches: []
                                    });
                                }
                                const group = groupedMatches.get(lineMatch.line);
                                // Deduplicate: only add if not already present
                                const isDuplicate = group.matches.some(m =>
                                    m.matchStart === lineMatch.matchStart && m.matchEnd === lineMatch.matchEnd
                                );
                                if (!isDuplicate) {
                                    group.matches.push({
                                        matchStart: lineMatch.matchStart,
                                        matchEnd: lineMatch.matchEnd
                                    });
                                }
                            });

                            lineItems = Array.from(groupedMatches.values()).map(group => \`
                                <div class="line-match"
                                     onclick="goToLine(\${group.line}, event)"
                                     onmouseover="handleCurrentFileLineHover(\${group.line}, event)"
                                     onmouseout="handleLineOut(event)"
                                     style="cursor: pointer;"
                                     title="Click to go to line, Ctrl+Hover for preview">
                                    <span class="line-number">\${group.line}:</span>
                                    <span class="line-text">\${createMultiMatchPreview(group.lineText, group.matches)}</span>
                                </div>
                            \`).join('');
                        }
                        currentFileMatchesHTML = \`<div class="current-file-matches" id="current-matches-\${search.id}">\${fileNameHeader}\${lineItems}</div>\`;
                    }

                    const expandIcon = (search.fileMatchDetails && search.fileMatchDetails.length > 0) || (!search.filePath && search.currentFileName)
                        ? \`<span class="expand-icon" onclick="toggleMatchList('\${search.id}')" title="Show matches">▶</span>\`
                        : '';

                    return \`
                        <div class="search-item\${search.isPaused ? ' paused' : ''}" style="border-left-color: \${search.isPaused ? '#808080' : search.color};"
                             draggable="true"
                             data-search-id="\${search.id}">
                            <div class="search-item-header">
                                <div class="search-item-content" style="flex: 1;">
                                    <div class="search-pattern"
                                         data-search-id="\${search.id}"
                                         title="Click to edit">\${escapeHtml(search.searchTerm)}</div>
                                    \${filePathInfo}
                                    \${excludePathInfo}
                                    <div class="search-info">
                                        <div class="search-filters">
                                            <span class="filter-icon \${search.isCaseSensitive ? 'active' : ''}"
                                                  onclick="toggleFilter('\${search.id}', 'case')"
                                                  title="Match Case">Aa</span>
                                            <span class="filter-icon \${search.isWholeWord ? 'active' : ''}"
                                                  onclick="toggleFilter('\${search.id}', 'word')"
                                                  title="Match Whole Word"
                                                  style="border: 1px solid currentColor;">ab</span>
                                            <span class="filter-icon \${search.isRegex ? 'active' : ''}"
                                                  onclick="toggleFilter('\${search.id}', 'regex')"
                                                  title="Use Regular Expression">.*</span>
                                            <span style="margin-right: 6px; opacity: 0.7; font-size: 11px;">\${search.currentMatchIndex}/\${search.matchCount}</span>
                                            \${search.matchCount > 0 ? \`
                                            <span class="nav-icon" onclick="navigateToPrevMatch('\${search.id}')" title="Previous match">◀</span>
                                            <span class="nav-icon" onclick="navigateToNextMatch('\${search.id}')" title="Next match">▶</span>
                                            \` : ''}
                                        </div>
                                        <div style="display: flex; align-items: center; gap: 4px;">
                                            \${search.isSearching ? \`
                                                <span class="codicon codicon-loading codicon-modifier-spin" style="font-size: 14px; margin-right: 4px;"></span>
                                            \` : ''}
                                            <span class="match-count-display"
                                                  onclick="toggleMatchList('\${search.id}')"
                                                  style="cursor: pointer;"
                                                  title="Click to expand">
                                                \${search.matchCount} matches\${search.filePath ? ' (in path)' : ''}
                                            </span>
                                            \${expandIcon}
                                        </div>
                                    </div>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 0px; align-items: flex-end;">
                                    <div style="display: flex; gap: 0px;">
                                        <button class="action-btn color-btn" id="color-btn-\${search.id}" onclick="openColorPicker('\${search.id}')" title="Change Color" style="background-color: \${search.color}; border: 1px solid \${search.color};">◉</button>
                                        <button class="action-btn pause-btn" id="pause-btn-\${search.id}" onclick="togglePause('\${search.id}')" title="\${search.isPaused ? 'Resume highlighting' : 'Pause highlighting'}">\${search.isPaused ? '<span class="play-icon">▶</span>' : '<span class="pause-icon">❚❚</span>'}</button>
                                        <button class="action-btn remove-btn" onclick="removeSearch('\${search.id}')" title="Remove">×</button>
                                    </div>
                                    <div style="display: flex; gap: 0px;">
                                        <div style="width: 24px; min-width: 24px;"></div>
                                        <button class="action-btn" onclick="toggleReplace('\${search.id}')" title="Replace All">⇄</button>
                                        <button class="action-btn merge-btn" id="merge-btn-\${search.id}" onclick="startMerge('\${search.id}')" title="Select for Merge">⊕</button>
                                    </div>
                                    \${search.filePath ? \`
                                    <button class="action-btn display-mode-btn" id="display-mode-btn-\${search.id}" onclick="toggleDisplayMode('\${search.id}')" title="\${search.displayMode === 'flat' ? 'Switch to tree view' : 'Switch to flat view'}">\${search.displayMode === 'flat' ? '▦' : '≡'}</button>
                                    \` : ''}
                                </div>
                            </div>
                            <div class="search-item-body">
                                \${fileMatchesHTML}
                                \${currentFileMatchesHTML}
                                \${search.fileMatchDetails && search.fileMatchDetails.length > 0 ? \`<div class="file-matches-resize-handle" id="resize-handle-\${search.id}"></div>\` : ''}
                                <div class="replace-box" id="replace-\${search.id}">
                                    <textarea class="replace-input" placeholder="Replace with..." rows="1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();replaceAll('\${search.id}');}"></textarea>
                                    <div class="replace-actions">
                                        <button class="replace-action-btn" onclick="replaceAll('\${search.id}')">Replace All</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    \`;
                }).join('');

                // Restore the expanded state after rebuilding HTML
                setTimeout(() => {
                    expandedStates.forEach((isExpanded, elementId) => {
                        const element = document.getElementById(elementId);
                        if (element && isExpanded) {
                            element.classList.add('visible');

                            // Update the corresponding expand icon
                            if (elementId.startsWith('files-') || elementId.startsWith('current-matches-')) {
                                const searchId = elementId.replace('files-', '').replace('current-matches-', '');
                                const searchItem = document.querySelector(\`[data-search-id="\${searchId}"]\`);
                                const expandIcon = searchItem?.querySelector('.expand-icon');
                                if (expandIcon) {
                                    expandIcon.textContent = '▼';
                                }
                            } else if (elementId.startsWith('lines-')) {
                                // Find the file expand icon for this line-matches element
                                const fileExpandIcon = element.closest('.file-match-file')?.querySelector('.file-expand-icon');
                                if (fileExpandIcon) {
                                    fileExpandIcon.textContent = '▼';
                                }
                            }
                        }
                    });

                    // Setup resize handles for all searches
                    searches.forEach(search => {
                        if (search.fileMatchDetails && search.fileMatchDetails.length > 0) {
                            setupResizeHandle(search.id);
                        }
                    });
                }, 0);
            }

            // Return the list of searches that transitioned from global to local
            return globalToLocalTransitions;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function escapeJsStringForHtmlAttribute(value) {
            const jsString = JSON.stringify(String(value))
                .replace(/\\u2028/g, '\\\\u2028')
                .replace(/\\u2029/g, '\\\\u2029');
            return jsString
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }

        // Create elegant match preview with highlighting
        function createMatchPreview(lineText, matchStart, matchEnd) {
            const MAX_PREVIEW_LENGTH = 150;
            const MIN_WORDS_BEFORE = 3;
            const MIN_WORDS_AFTER = 3;
            const MIN_CHARS_CONTEXT = 25;

            // Trim the line
            const trimmedLine = lineText.trim();
            const trimOffset = lineText.length - lineText.trimStart().length;
            const adjustedStart = Math.max(0, matchStart - trimOffset);
            const adjustedEnd = Math.max(0, matchEnd - trimOffset);

            if (trimmedLine.length <= MAX_PREVIEW_LENGTH) {
                // Line is short enough, show the whole thing with highlight
                const before = escapeHtml(trimmedLine.substring(0, adjustedStart));
                const match = escapeHtml(trimmedLine.substring(adjustedStart, adjustedEnd));
                const after = escapeHtml(trimmedLine.substring(adjustedEnd));
                return \`\${before}<span class="match-highlight">\${match}</span>\${after}\`;
            }

            // Line is too long, extract meaningful context
            const beforeText = trimmedLine.substring(0, adjustedStart);
            const matchText = trimmedLine.substring(adjustedStart, adjustedEnd);
            const afterText = trimmedLine.substring(adjustedEnd);

            // Get words before the match
            const wordsBefore = beforeText.split(/\s+/).filter(w => w.length > 0);
            const wordsAfter = afterText.split(/\s+/).filter(w => w.length > 0);

            // Take at least MIN_WORDS before and after, or enough chars for context
            let contextBefore = '';
            let contextAfter = '';

            // Build context before
            if (wordsBefore.length > 0) {
                const takeWords = Math.max(MIN_WORDS_BEFORE, Math.min(wordsBefore.length, 5));
                contextBefore = wordsBefore.slice(-takeWords).join(' ');

                // Ensure minimum character count
                if (contextBefore.length < MIN_CHARS_CONTEXT && wordsBefore.length > takeWords) {
                    let additionalWords = Math.min(3, wordsBefore.length - takeWords);
                    contextBefore = wordsBefore.slice(-(takeWords + additionalWords)).join(' ');
                }
            }

            // Build context after
            if (wordsAfter.length > 0) {
                const takeWords = Math.max(MIN_WORDS_AFTER, Math.min(wordsAfter.length, 5));
                contextAfter = wordsAfter.slice(0, takeWords).join(' ');

                // Ensure minimum character count
                if (contextAfter.length < MIN_CHARS_CONTEXT && wordsAfter.length > takeWords) {
                    let additionalWords = Math.min(3, wordsAfter.length - takeWords);
                    contextAfter = wordsAfter.slice(0, takeWords + additionalWords).join(' ');
                }
            }

            // If context is still too long, trim it
            const totalLength = contextBefore.length + matchText.length + contextAfter.length;
            if (totalLength > MAX_PREVIEW_LENGTH) {
                const availableSpace = MAX_PREVIEW_LENGTH - matchText.length;
                const halfSpace = Math.floor(availableSpace / 2);

                if (contextBefore.length > halfSpace) {
                    const words = contextBefore.split(/\s+/);
                    contextBefore = words.slice(-MIN_WORDS_BEFORE).join(' ');
                }
                if (contextAfter.length > halfSpace) {
                    const words = contextAfter.split(/\s+/);
                    contextAfter = words.slice(0, MIN_WORDS_AFTER).join(' ');
                }
            }

            const before = escapeHtml(contextBefore);
            const match = escapeHtml(matchText);
            const after = escapeHtml(contextAfter);

            const prefix = contextBefore.length < beforeText.length && contextBefore.length > 0 ? '… ' : '';
            const suffix = contextAfter.length < afterText.length && contextAfter.length > 0 ? ' …' : '';

            return \`\${prefix}\${before}<span class="match-highlight">\${match}</span>\${after}\${suffix}\`;
        }

        // Create match preview with multiple match ranges on the same line
        function createMultiMatchPreview(lineText, matches) {
            // matches is an array of {matchStart, matchEnd} objects for the same line
            // Sort matches by start position
            const sortedMatches = matches.sort((a, b) => a.matchStart - b.matchStart);

            const trimmedLine = lineText.trim();
            const trimOffset = lineText.length - lineText.trimStart().length;

            // Build HTML with all matches highlighted
            let html = '';
            let pos = 0;

            for (const match of sortedMatches) {
                const adjustedStart = Math.max(0, match.matchStart - trimOffset);
                const adjustedEnd = Math.max(0, match.matchEnd - trimOffset);

                // Add text before this match
                if (adjustedStart > pos) {
                    html += escapeHtml(trimmedLine.substring(pos, adjustedStart));
                }

                // Add highlighted match
                html += '<span class="match-highlight">' + escapeHtml(trimmedLine.substring(adjustedStart, adjustedEnd)) + '</span>';

                pos = adjustedEnd;
            }

            // Add remaining text
            if (pos < trimmedLine.length) {
                html += escapeHtml(trimmedLine.substring(pos));
            }

            return html;
        }

        // Drag and drop functionality
        let draggedElement = null;

        function setupDragAndDrop() {
            const searchItems = document.querySelectorAll('.search-item');

            searchItems.forEach(item => {
                item.addEventListener('dragstart', (e) => {
                    draggedElement = e.target;
                    e.target.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                });

                item.addEventListener('dragend', (e) => {
                    e.target.classList.remove('dragging');
                    document.querySelectorAll('.search-item').forEach(item => {
                        item.classList.remove('drag-over');
                    });
                });

                item.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';

                    if (draggedElement && draggedElement !== e.currentTarget) {
                        e.currentTarget.classList.add('drag-over');
                    }
                });

                item.addEventListener('dragleave', (e) => {
                    e.currentTarget.classList.remove('drag-over');
                });

                item.addEventListener('drop', (e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('drag-over');

                    if (draggedElement && draggedElement !== e.currentTarget) {
                        const fromId = draggedElement.getAttribute('data-search-id');
                        const toId = e.currentTarget.getAttribute('data-search-id');

                        // Check if configured modifier key is held to merge searches
                        let modifierKeyPressed = false;
                        if (mergeModifierKey === 'ctrl') {
                            modifierKeyPressed = e.ctrlKey || e.metaKey; // metaKey for Mac Cmd
                        } else if (mergeModifierKey === 'alt') {
                            modifierKeyPressed = e.altKey;
                        } else if (mergeModifierKey === 'shift') {
                            modifierKeyPressed = e.shiftKey;
                        }

                        if (modifierKeyPressed) {
                            vscode.postMessage({
                                command: 'mergeSearches',
                                fromId: fromId,
                                toId: toId
                            });
                        } else {
                            vscode.postMessage({
                                command: 'reorderSearch',
                                fromId: fromId,
                                toId: toId
                            });
                        }
                    }
                });
            });
        }

        // Restore state from previous session
        // Note: searchInput, pathInput, and excludePathInput are intentionally NOT restored
        // They reset when VSCode reopens
        const previousState = vscode.getState();
        if (previousState) {
            if (previousState.workspaceRoot) workspaceRoot = previousState.workspaceRoot;
            if (previousState.isRegex !== undefined) {
                isRegex = previousState.isRegex;
                regexBtn.classList.toggle('active', isRegex);
            }
            if (previousState.isCaseSensitive !== undefined) {
                isCaseSensitive = previousState.isCaseSensitive;
                caseSensitiveBtn.classList.toggle('active', isCaseSensitive);
            }
            if (previousState.isWholeWord !== undefined) {
                isWholeWord = previousState.isWholeWord;
                wholeWordBtn.classList.toggle('active', isWholeWord);
            }
            // fileFiltersExpanded is NOT restored - it's controlled by showFileFiltersByDefault setting

            // Restore expanded state after a short delay to ensure DOM is ready
            if (previousState.expandedState) {
                setTimeout(() => {
                    restoreExpandedState(previousState.expandedState);
                }, 100);
            }
        }

        // Auto-save state every 2 seconds to preserve expand/collapse state
        setInterval(() => {
            saveState();
        }, 2000);

        // Also save state when clicking anywhere (covers most expand/collapse interactions)
        document.addEventListener('click', () => {
            // Use a small delay to ensure DOM has updated after the click
            setTimeout(() => {
                saveState();
            }, 50);
        });

        // State preservation: save which folders/files are expanded
        function saveExpandedState() {
            const state = {
                folders: [],
                files: [],
                expandAllIcons: [],
                fileMatchesLists: [],
                currentFileLists: [],
                visitedLines: []
            };

            // Save expanded file-matches-list (main search results)
            document.querySelectorAll('.file-matches-list.visible').forEach(list => {
                state.fileMatchesLists.push(list.id);
            });

            // Save expanded current-file-matches
            document.querySelectorAll('.current-file-matches.visible').forEach(list => {
                state.currentFileLists.push(list.id);
            });

            // Save expanded folders
            document.querySelectorAll('.folder-contents').forEach(folder => {
                if (folder.style.display === 'block') {
                    state.folders.push(folder.id);
                }
            });

            // Save expanded files
            document.querySelectorAll('.file-lines').forEach(file => {
                if (file.style.display === 'block') {
                    state.files.push(file.id);
                }
            });

            // Save expand-all icon states (collapse-all)
            document.querySelectorAll('.folder-expand-all-icon').forEach(icon => {
                const iconElement = icon.querySelector('.codicon');
                if (iconElement && iconElement.classList.contains('codicon-collapse-all')) {
                    state.expandAllIcons.push(icon.id);
                }
            });

            // Save visited lines
            document.querySelectorAll('.line-match.visited').forEach(line => {
                // Create a unique identifier for each visited line
                // We can use the onclick attribute to identify the line
                const onclickAttr = line.getAttribute('onclick');
                if (onclickAttr) {
                    state.visitedLines.push(onclickAttr);
                }
            });

            return state;
        }

        function restoreExpandedState(state) {
            if (!state) return;

            // Restore expanded file-matches-list (main search results)
            if (state.fileMatchesLists) {
                state.fileMatchesLists.forEach(listId => {
                    const list = document.getElementById(listId);
                    if (list) {
                        list.classList.add('visible');
                        // Also update the expand icon
                        const searchId = listId.replace('files-', '');
                        const searchItem = document.querySelector('[data-search-id="' + searchId + '"]');
                        if (searchItem) {
                            const expandIcon = searchItem.querySelector('.expand-icon');
                            if (expandIcon) {
                                expandIcon.textContent = '▼';
                            }
                        }
                        // Setup resize handle for this list
                        setTimeout(() => setupResizeHandle(searchId), 50);
                    }
                });
            }

            // Restore expanded current-file-matches
            if (state.currentFileLists) {
                state.currentFileLists.forEach(listId => {
                    const list = document.getElementById(listId);
                    if (list) {
                        list.classList.add('visible');
                        // Also update the expand icon
                        const searchId = listId.replace('current-matches-', '');
                        const searchItem = document.querySelector('[data-search-id="' + searchId + '"]');
                        if (searchItem) {
                            const expandIcon = searchItem.querySelector('.expand-icon');
                            if (expandIcon) {
                                expandIcon.textContent = '▼';
                            }
                        }
                    }
                });
            }

            // Restore expanded folders
            if (state.folders) {
                state.folders.forEach(folderId => {
                    const folder = document.getElementById(folderId);
                    const iconId = folderId.replace('folder-', 'icon-folder-');
                    const icon = document.getElementById(iconId);
                    if (folder) {
                        folder.style.display = 'block';
                    }
                    if (icon) {
                        icon.textContent = '▼';
                    }
                });
            }

            // Restore expanded files
            if (state.files) {
                state.files.forEach(fileId => {
                    const file = document.getElementById(fileId);
                    const iconId = fileId.replace('file-', 'icon-file-');
                    const icon = document.getElementById(iconId);
                    if (file) {
                        file.style.display = 'block';
                    }
                    if (icon) {
                        icon.textContent = '▼';
                    }
                });
            }

            // Restore expand-all icon states
            if (state.expandAllIcons) {
                state.expandAllIcons.forEach(iconId => {
                    const expandAllIcon = document.getElementById(iconId);
                    if (expandAllIcon) {
                        const iconElement = expandAllIcon.querySelector('.codicon');
                        if (iconElement) {
                            iconElement.classList.remove('codicon-expand-all');
                            iconElement.classList.add('codicon-collapse-all');
                            expandAllIcon.setAttribute('title', 'Collapse all files in this folder');
                        }
                    }
                });
            }

            // Restore visited lines
            if (state.visitedLines) {
                state.visitedLines.forEach(onclickAttr => {
                    // Find the line-match element with this onclick attribute
                    const lineMatch = document.querySelector('.line-match[onclick="' + onclickAttr.replace(/"/g, '\\"') + '"]');
                    if (lineMatch) {
                        lineMatch.classList.add('visited');
                    }
                });
            }
        }

        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateSearches') {
                // Update settings from message
                if (message.markVisitedMatches !== undefined) {
                    markVisitedMatches = message.markVisitedMatches;
                }

                // Save current scroll position and expand/collapse state
                const scrollPosition = document.documentElement.scrollTop || document.body.scrollTop;
                const expandedState = saveExpandedState();

                // Update the list (returns array of search IDs that transitioned from global to local)
                const globalToLocalTransitions = updateSearchList(message.searches);

                // Restore expand/collapse state after a short delay
                setTimeout(() => {
                    restoreExpandedState(expandedState);

                    // Auto-expand matches list for newly added current file searches
                    // Current file searches (Ctrl+F) are always auto-expanded, regardless of autoExpandResults setting
                    // Only expand for NEW searches to avoid collapsing existing searches when switching files
                    if (message.newSearchIds && message.newSearchIds.length > 0) {
                        message.newSearchIds.forEach(searchId => {
                            // Find this search in the searches array
                            const search = message.searches.find(s => s.id === searchId);
                            // Only process current file searches (no filePath)
                            if (!search || search.filePath) return;

                            const searchItem = document.querySelector('[data-search-id="' + searchId + '"]');
                            const expandIcon = searchItem ? searchItem.querySelector('.expand-icon') : null;
                            const currentMatchesList = document.getElementById('current-matches-' + searchId);

                            // Auto-expand if there are matches and list exists
                            if (currentMatchesList && search.currentFileMatches && search.currentFileMatches.length > 0) {
                                currentMatchesList.classList.add('visible');
                                if (expandIcon) {
                                    expandIcon.textContent = '▼';
                                }
                            }
                        });
                    }

                    // Expand current file searches that just transitioned from global to local
                    // When transitioning from global to local, ALWAYS expand the matches (user wants to see local results)
                    if (globalToLocalTransitions && globalToLocalTransitions.length > 0) {
                        globalToLocalTransitions.forEach(searchId => {
                            const search = message.searches.find(s => s.id === searchId);
                            if (!search || search.filePath) return; // Safety check

                            const searchItem = document.querySelector('[data-search-id="' + searchId + '"]');
                            if (!searchItem) return;

                            const currentMatchesList = document.getElementById('current-matches-' + searchId);

                            // Always expand current file matches when transitioning from global to local
                            if (currentMatchesList && search.currentFileMatches && search.currentFileMatches.length > 0) {
                                const expandIcon = searchItem.querySelector('.expand-icon');
                                currentMatchesList.classList.add('visible');
                                if (expandIcon) {
                                    expandIcon.textContent = '▼';
                                }
                            }
                        });
                    }

                    // Auto-expand file matches list for searches that just finished (global/file searches)
                    if (message.autoExpandIds && message.autoExpandIds.length > 0) {
                        message.autoExpandIds.forEach(searchId => {
                            const searchItem = document.querySelector('[data-search-id="' + searchId + '"]');
                            const expandIcon = searchItem ? searchItem.querySelector('.expand-icon') : null;

                            // Expand file matches list (shows folders/files but not individual lines)
                            const fileMatchesList = document.getElementById('files-' + searchId);
                            if (fileMatchesList) {
                                fileMatchesList.classList.add('visible');
                                if (expandIcon) {
                                    expandIcon.textContent = '▼';
                                }

                                // Auto-expand folders/files based on autoExpandResults setting
                                if (message.autoExpandResults) {
                                    // Small delay to ensure DOM is ready
                                    setTimeout(() => {
                                        // Determine if this is tree or flat view
                                        // Use forceExpand (not toggle) to avoid collapsing already expanded results
                                        const isFlatView = fileMatchesList.querySelector('.flat-list-header') !== null;
                                        if (isFlatView) {
                                            forceExpandAllFlat(searchId);
                                        } else {
                                            forceExpandAllTree(searchId);
                                        }
                                    }, 50);
                                }
                            }
                        });
                    }

                    // Restore scroll position or scroll to show new search with its results
                    if (message.newSearchIds && message.newSearchIds.length > 0) {
                        // New search added - scroll to show the new search and its results
                        // Use a longer delay to ensure results are expanded (especially for global searches)
                        setTimeout(() => {
                            const lastSearchId = message.newSearchIds[message.newSearchIds.length - 1];
                            const searchItem = document.querySelector('[data-search-id="' + lastSearchId + '"]');
                            if (searchItem) {
                                // Scroll the search item into view, aligned to top
                                searchItem.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }
                        }, 100);
                    } else {
                        // No new search - restore previous scroll position
                        window.scrollTo(0, scrollPosition);
                    }

                    setupDragAndDrop();
                }, 0);
            } else if (message.command === 'showCodePreview') {
                showCodePreview(message.filePath, message.line, message.codeLines, message.languageId, message.mouseX || 0, message.mouseY || 0);
            } else if (message.command === 'focusInput') {
                searchInput.focus();
            } else if (message.command === 'setFilePath') {
                pathInput.value = message.filePath;
                workspaceRoot = message.workspaceRoot || '';

                // Expand file filters if requested
                if (message.expandFilters && !fileFiltersExpanded) {
                    fileFiltersExpanded = true;
                    fileFiltersSection.style.display = 'block';
                }

                searchInput.focus();
                saveState();
            } else if (message.command === 'setSearchText') {
                searchInput.value = message.searchText;
                searchInput.focus();
                searchInput.select();
                saveState();
                // Trigger preview
                updatePreview();
            }
        });

        function openColorPicker(id) {
            // Create a hidden color picker input
            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.style.position = 'absolute';
            colorInput.style.opacity = '0';
            colorInput.style.pointerEvents = 'none';
            document.body.appendChild(colorInput);

            // Set current color
            const searchItem = document.querySelector('[data-search-id="' + id + '"]');
            if (searchItem) {
                const currentColor = searchItem.style.borderLeftColor;
                if (currentColor) {
                    colorInput.value = rgbToHex(currentColor);
                }
            }

            // Handle color change with validation
            const handleColorChange = function() {
                const newColor = colorInput.value;

                // Check if color is already used by another search
                // We need to check the color button's background which reflects the current color
                const allSearchItems = document.querySelectorAll('.search-item');
                let colorInUse = false;
                allSearchItems.forEach(item => {
                    const itemId = item.getAttribute('data-search-id');
                    if (itemId !== id) {
                        // Check the color button which reflects the most up-to-date color
                        const itemColorBtn = document.getElementById('color-btn-' + itemId);
                        if (itemColorBtn) {
                            // Check inline style first (most recent JavaScript updates), fallback to computed style
                            let bgColor = itemColorBtn.style.backgroundColor;
                            
                            if (!bgColor) {
                                bgColor = window.getComputedStyle(itemColorBtn).backgroundColor;
                                
                            }
                            const itemColor = rgbToHex(bgColor);
                            
                            if (itemColor.toLowerCase() === newColor.toLowerCase()) {
                                colorInUse = true;
                                
                            }
                        }
                    }
                });

                

                if (colorInUse) {
                    // Don't update anything, just show error
                    vscode.postMessage({
                        command: 'showError',
                        message: 'This color is already used by another search. Please choose a different color.'
                    });
                    // Clean up the color input without applying changes
                    document.body.removeChild(colorInput);
                    // Reopen the color picker for another attempt
                    setTimeout(() => openColorPicker(id), 100);
                    return;
                }

                // Update UI immediately
                const searchItem = document.querySelector('[data-search-id="' + id + '"]');
                if (searchItem) {
                    searchItem.style.borderLeftColor = newColor;
                }

                // Update color button
                const colorBtn = document.getElementById('color-btn-' + id);
                if (colorBtn) {
                    colorBtn.style.backgroundColor = newColor;
                    colorBtn.style.borderColor = newColor;
                    
                } else {
                    
                }

                // Send message to extension to update decorations
                vscode.postMessage({
                    command: 'changeColor',
                    id: id,
                    color: newColor
                });

                // Clean up
                document.body.removeChild(colorInput);
            };

            colorInput.addEventListener('change', handleColorChange);

            // Open the native color picker
            colorInput.click();
        }

        function rgbToHex(rgb) {
            // Handle hex colors
            if (rgb.startsWith('#')) {
                return rgb;
            }

            // Convert to string if needed and normalize
            const rgbStr = String(rgb).trim();
            

            // Manual parsing instead of regex - extract numbers from rgb(r, g, b)
            // Remove 'rgb(' prefix and ')' suffix
            let cleaned = rgbStr;
            if (cleaned.startsWith('rgb(') || cleaned.startsWith('rgb (')) {
                cleaned = cleaned.substring(cleaned.indexOf('(') + 1);
            }
            if (cleaned.endsWith(')')) {
                cleaned = cleaned.substring(0, cleaned.length - 1);
            }

            

            // Split by comma and parse
            const parts = cleaned.split(',');
            

            if (parts.length === 3) {
                const r = parseInt(parts[0].trim());
                const g = parseInt(parts[1].trim());
                const b = parseInt(parts[2].trim());

                if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
                    const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
                    
                    return hex;
                }
            }

            
            return '#FF6B6B'; // Default color
        }

        // Request initial state
        vscode.postMessage({ command: 'requestUpdate' });

        // Make functions available globally
        window.removeSearch = removeSearch;
        window.clearAll = clearAll;
        window.toggleFilter = toggleFilter;
        window.editSearchText = editSearchText;
        window.editFilePath = editFilePath;
        window.toggleReplace = toggleReplace;
        window.replaceAll = replaceAll;
        window.toggleFileList = toggleFileList;
        window.toggleMatchList = toggleMatchList;
        window.goToLine = goToLine;
        window.navigateToPrevMatch = navigateToPrevMatch;
        window.navigateToNextMatch = navigateToNextMatch;
        window.openFile = openFile;
        window.openFileAtLine = openFileAtLine;
        window.toggleFilePreview = toggleFilePreview;
        window.openColorPicker = openColorPicker;
        window.toggleDisplayMode = toggleDisplayMode;
    </script>
</body>
</html>`;
    }
}
