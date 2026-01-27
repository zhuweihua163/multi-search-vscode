import * as vscode from 'vscode';
import * as path from 'path';
import { SearchHighlight, LineMatch, FileMatchDetail } from '../types';
import { createRegex } from '../search';

/**
 * Updates file matches from a map structure
 */
export function updateFileMatchesFromMap(
    highlight: SearchHighlight,
    fileMatchMap: Map<string, { count: number; lines: LineMatch[] }>,
    workspaceRoot: string
) {
    highlight.fileMatches = new Map();
    highlight.fileMatchDetails = [];

    for (const [filePath, fileData] of fileMatchMap.entries()) {
        const fullPath = path.join(workspaceRoot, filePath);
        highlight.fileMatches.set(vscode.Uri.file(fullPath).toString(), fileData.count);

        highlight.fileMatchDetails.push({
            filePath: filePath,
            matchCount: fileData.count,
            lines: fileData.lines
        });
    }
}

/**
 * Creates decoration options for a search term in the current editor
 */
export function createSearchDecorations(
    editor: vscode.TextEditor,
    searchTerm: string,
    isRegex: boolean,
    isCaseSensitive: boolean,
    isWholeWord: boolean
): vscode.DecorationOptions[] {
    const text = editor.document.getText();
    const decorations: vscode.DecorationOptions[] = [];

    try {
        const regex = createRegex({
            id: '',
            searchTerm,
            decorationType: {} as any, // Not used for regex creation
            color: '',
            isRegex,
            isCaseSensitive,
            isWholeWord
        } as SearchHighlight);

        let match;
        while ((match = regex.exec(text)) !== null) {
            const startPos = editor.document.positionAt(match.index);
            const endPos = editor.document.positionAt(match.index + match[0].length);
            decorations.push({ range: new vscode.Range(startPos, endPos) });
        }
    } catch (error) {
        // Invalid regex - return empty decorations
    }

    return decorations;
}
