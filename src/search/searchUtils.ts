import * as vscode from 'vscode';
import * as path from 'path';
import { SearchHighlight } from '../types';

/**
 * Creates a RegExp from a SearchHighlight configuration.
 *
 * Handles both literal text search and regex patterns with proper escaping.
 * Supports case sensitivity and whole word matching options.
 *
 * @param highlight - The search highlight configuration
 * @returns A configured RegExp with appropriate flags (g/gi)
 *
 * @example
 * ```typescript
 * const highlight = { searchTerm: 'test', isRegex: false, isCaseSensitive: false, isWholeWord: true };
 * const regex = createRegex(highlight);
 * // Returns: /\btest\b/gi
 * ```
 */
export function createRegex(highlight: SearchHighlight): RegExp {
    if (highlight.isRegex) {
        const flags = highlight.isCaseSensitive ? 'g' : 'gi';
        return new RegExp(highlight.searchTerm, flags);
    } else {
        let escapedPattern = highlight.searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (highlight.isWholeWord) {
            escapedPattern = `\\b${escapedPattern}\\b`;
        }
        const flags = highlight.isCaseSensitive ? 'g' : 'gi';
        return new RegExp(escapedPattern, flags);
    }
}

/**
 * Counts the number of matches for a search highlight in the current editor.
 *
 * Executes the search pattern against the entire document text and counts
 * all matching occurrences. Handles invalid regex patterns gracefully.
 *
 * @param editor - The VSCode text editor containing the document to search
 * @param highlight - The search highlight configuration with pattern and options
 * @returns The total number of matches found, or 0 if no matches or invalid regex
 *
 * @example
 * ```typescript
 * const count = countMatches(editor, { searchTerm: 'TODO', isRegex: false, ... });
 * 
 * ```
 */
export function countMatches(editor: vscode.TextEditor, highlight: SearchHighlight): number {
    if (!highlight.searchTerm) return 0;

    const text = editor.document.getText();
    let count = 0;

    try {
        const regex = createRegex(highlight);
        while (regex.exec(text) !== null) {
            count++;
        }
    } catch (error) {
        // Invalid regex
    }

    return count;
}

/**
 * Checks if a file should be searched based on a glob pattern.
 *
 * Performs cross-platform path normalization and glob pattern matching
 * to determine if a file matches the search criteria. Currently supports
 * prefix matching with ** wildcard patterns.
 *
 * @param fileUri - The URI of the file to check
 * @param globPattern - The glob pattern to match against (e.g., "src/**")
 * @returns true if the file matches the pattern, false otherwise
 *
 * @example
 * ```typescript
 * const uri = vscode.Uri.file('/workspace/src/utils/helper.ts');
 * const shouldSearch = shouldSearchInFile(uri, 'src/**');
 * // Returns: true
 * ```
 */
export function shouldSearchInFile(fileUri: vscode.Uri, globPattern: string): boolean {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
    if (!workspaceFolder) return false;

    // Global search (pattern is "." or empty) - search all files in workspace
    if (globPattern === '.' || globPattern === '' || globPattern === '**' || globPattern === '**/*') {
        return true;
    }

    // Normalize paths for cross-platform compatibility
    const normalizedWorkspacePath = path.normalize(workspaceFolder.uri.fsPath);
    const normalizedFilePath = path.normalize(fileUri.fsPath);
    const relativePath = path.relative(normalizedWorkspacePath, normalizedFilePath);

    // Simple glob matching - check if the file path starts with the pattern prefix
    // Normalize glob pattern path separators to forward slashes for consistent matching
    const normalizedGlobPattern = globPattern.replace(/\\/g, '/');
    const normalizedRelativePath = relativePath.replace(/\\/g, '/');
    const patternPrefix = normalizedGlobPattern.replace(/\/?\*\*.*$/, '');

    // If pattern prefix is empty after removing **, match all files
    if (patternPrefix === '' || patternPrefix === '.') {
        return true;
    }

    return normalizedRelativePath.startsWith(patternPrefix);
}

/**
 * Checks if a file should be excluded based on exclude patterns.
 *
 * Supports multiple comma-separated patterns and glob matching.
 * Returns true if the file matches any exclude pattern.
 *
 * @param fileUri - The URI of the file to check
 * @param excludePatterns - Comma-separated exclude patterns (e.g., "*.md,test/**")
 * @returns true if the file should be excluded, false otherwise
 *
 * @example
 * ```typescript
 * const uri = vscode.Uri.file('/workspace/README.md');
 * const shouldExclude = shouldExcludeFile(uri, '*.md,test/**');
 * // Returns: true
 * ```
 */
export function shouldExcludeFile(fileUri: vscode.Uri, excludePatterns: string | undefined): boolean {
    if (!excludePatterns) return false;

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
    if (!workspaceFolder) return false;

    // Normalize paths for cross-platform compatibility
    const normalizedWorkspacePath = path.normalize(workspaceFolder.uri.fsPath);
    const normalizedFilePath = path.normalize(fileUri.fsPath);
    const relativePath = path.relative(normalizedWorkspacePath, normalizedFilePath);
    const normalizedRelativePath = relativePath.replace(/\\/g, '/');
    const fileName = path.basename(normalizedFilePath);

    // Split patterns by comma and test each one
    const patterns = excludePatterns.split(',').map(p => p.trim()).filter(p => p);

    for (const pattern of patterns) {
        // Remove ! prefix if present (used in ripgrep args)
        const cleanPattern = pattern.startsWith('!') ? pattern.substring(1) : pattern;
        const normalizedPattern = cleanPattern.replace(/\\/g, '/');

        if (matchesGlobPath(normalizedRelativePath, normalizedPattern) ||
            matchesGlobPath(fileName, normalizedPattern)) {
            return true;
        }

        if (normalizedPattern.endsWith('/**')) {
            const directoryPattern = normalizedPattern.slice(0, -3);
            const pathSegments = normalizedRelativePath.split('/');
            if (pathSegments.some((_, index) =>
                matchesGlobPath(pathSegments.slice(0, index + 1).join('/'), directoryPattern))) {
                return true;
            }
        }
    }

    return false;
}

export function matchesGlobPath(filePath: string, globPattern: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const normalizedPattern = globPattern.replace(/\\/g, '/').replace(/^\/+/, '');
    let regexPattern = '^';

    for (let i = 0; i < normalizedPattern.length; i++) {
        const char = normalizedPattern[i];
        if (char === '*' && normalizedPattern[i + 1] === '*') {
            i++;
            if (normalizedPattern[i + 1] === '/') {
                regexPattern += '(?:.*/)?';
                i++;
            } else {
                regexPattern += '.*';
            }
        } else if (char === '*') {
            regexPattern += '[^/]*';
        } else if (char === '?') {
            regexPattern += '[^/]';
        } else {
            regexPattern += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
    }

    const matcher = new RegExp(`${regexPattern}$`);
    const segments = normalizedPath.split('/');
    return segments.some((_, index) => matcher.test(segments.slice(0, index + 1).join('/')));
}

export function getWorkspaceExcludePatterns(resource: vscode.Uri): string[] {
    const filesExclude = vscode.workspace
        .getConfiguration('files', resource)
        .get<Record<string, boolean>>('exclude', {});
    const searchExclude = vscode.workspace
        .getConfiguration('search', resource)
        .get<Record<string, boolean>>('exclude', {});

    return Object.entries({ ...filesExclude, ...searchExclude })
        .filter(([, enabled]) => enabled === true)
        .map(([pattern]) => pattern.replace(/\\/g, '/'));
}

export function toRipgrepExcludeGlobs(workspaceExcludePatterns: string[], customExcludePath?: string): string[] {
    const globs = new Set<string>();

    for (const pattern of workspaceExcludePatterns) {
        globs.add(`!${pattern}`);
        if (!pattern.endsWith('/**')) {
            globs.add(`!${pattern.replace(/\/+$/, '')}/**`);
        }
    }

    if (customExcludePath) {
        for (const pattern of customExcludePath.split(',').map(item => item.trim()).filter(Boolean)) {
            globs.add(pattern.startsWith('!') ? pattern : `!${pattern.replace(/\\/g, '/')}`);
        }
    }

    return Array.from(globs);
}

export function getRipgrepExcludeGlobs(resource: vscode.Uri, customExcludePath?: string): string[] {
    return toRipgrepExcludeGlobs(getWorkspaceExcludePatterns(resource), customExcludePath);
}

export function isExcludedByWorkspaceSettings(fileUri: vscode.Uri): boolean {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
    if (!workspaceFolder) return false;

    const relativePath = path.relative(workspaceFolder.uri.fsPath, fileUri.fsPath).replace(/\\/g, '/');
    return getWorkspaceExcludePatterns(fileUri).some(pattern => matchesGlobPath(relativePath, pattern));
}

/**
 * Escapes HTML special characters to prevent XSS attacks.
 *
 * Converts potentially dangerous characters (&, <, >, ", ') into their
 * HTML entity equivalents, making the text safe for insertion into HTML.
 *
 * @param text - The raw text to escape
 * @returns The escaped text safe for HTML insertion
 *
 * @example
 * ```typescript
 * const userInput = '<script>alert("XSS")</script>';
 * const safe = escapeHtml(userInput);
 * // Returns: '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'
 * ```
 */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
