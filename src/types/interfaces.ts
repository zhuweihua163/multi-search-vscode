import * as vscode from 'vscode';
import * as cp from 'child_process';

export interface LineMatch {
    line: number;
    column: number;
    lineText: string;
    matchStart: number;
    matchEnd: number;
}

export interface FileMatchDetail {
    filePath: string;
    matchCount: number;
    lines: LineMatch[];
}

export interface SearchHighlight {
    id: string;
    searchTerm: string;
    decorationType: vscode.TextEditorDecorationType;
    color: string;
    isRegex: boolean;
    isCaseSensitive: boolean;
    isWholeWord: boolean;
    filePath?: string; // Optional glob pattern for file search
    excludePath?: string; // Optional glob patterns to exclude (comma-separated)
    workspaceRoot?: string; // Workspace root for file search (to support multi-workspace)
    fileMatches?: Map<string, number>; // Map of file URI to match count
    fileMatchDetails?: FileMatchDetail[]; // Detailed match information with line previews (for file searches)
    currentFileMatches?: LineMatch[]; // Match details for current file search
    currentFileName?: string; // Name of the file where currentFileMatches were found
    currentMatchIndex?: number; // Current match index for navigation (1-based)
    mergedTerms?: string[]; // Terms that were merged (for filtering lines with all terms)
    searchProcess?: cp.ChildProcess; // Active search process for cancellation
    isSearching?: boolean; // Whether search is in progress
    isPaused?: boolean; // Whether highlighting is paused for this search
    displayMode?: 'tree' | 'flat'; // Display mode for file matches: tree (folder structure) or flat (path list like VSCode)
}
