/**
 * Syntax highlighting and tokenization utilities for code preview
 */

import * as vscode from 'vscode';
import { escapeHtml } from '../search';

/**
 * Represents a tokenized piece of text with optional type information.
 * Used for syntax highlighting in code previews.
 */
export interface Token {
    /** The actual text content of the token */
    text: string;
    /** Optional type classification (e.g., 'keyword', 'string', 'comment') */
    type?: string;
}

/**
 * Language-specific keywords for syntax highlighting
 */
const LANGUAGE_KEYWORDS: {[key: string]: string[]} = {
    'typescript': ['abstract', 'any', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'constructor', 'continue', 'debugger', 'declare', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'from', 'function', 'get', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'is', 'keyof', 'let', 'module', 'namespace', 'never', 'new', 'null', 'number', 'of', 'package', 'private', 'protected', 'public', 'readonly', 'require', 'return', 'set', 'static', 'string', 'super', 'switch', 'symbol', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined', 'var', 'void', 'while', 'with', 'yield'],
    'javascript': ['abstract', 'arguments', 'async', 'await', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'double', 'else', 'enum', 'eval', 'export', 'extends', 'false', 'final', 'finally', 'float', 'for', 'function', 'goto', 'if', 'implements', 'import', 'in', 'instanceof', 'int', 'interface', 'let', 'long', 'native', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'true', 'try', 'typeof', 'var', 'void', 'volatile', 'while', 'with', 'yield'],
    'python': ['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'],
    'java': ['abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'false', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'true', 'try', 'void', 'volatile', 'while'],
    'go': ['break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'false', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'true', 'type', 'var'],
    'rust': ['Self', 'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while'],
    'cpp': ['alignas', 'alignof', 'and', 'and_eq', 'asm', 'auto', 'bitand', 'bitor', 'bool', 'break', 'case', 'catch', 'char', 'class', 'compl', 'const', 'constexpr', 'const_cast', 'continue', 'decltype', 'default', 'delete', 'do', 'double', 'dynamic_cast', 'else', 'enum', 'explicit', 'export', 'extern', 'false', 'float', 'for', 'friend', 'goto', 'if', 'inline', 'int', 'long', 'mutable', 'namespace', 'new', 'noexcept', 'not', 'not_eq', 'nullptr', 'operator', 'or', 'or_eq', 'private', 'protected', 'public', 'register', 'reinterpret_cast', 'return', 'short', 'signed', 'sizeof', 'static', 'static_assert', 'static_cast', 'struct', 'switch', 'template', 'this', 'thread_local', 'throw', 'true', 'try', 'typedef', 'typeid', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void', 'volatile', 'wchar_t', 'while', 'xor', 'xor_eq'],
    'c': ['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'int', 'long', 'register', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while']
};

/**
 * Tokenizes individual words within text, identifying keywords and types.
 *
 * Processes text word-by-word to classify tokens as keywords, numbers, class names,
 * or function names based on context and patterns. Modifies the tokens array in-place.
 *
 * @param text - The text to tokenize
 * @param keywords - Array of language keywords to identify
 * @param tokens - Array to append identified tokens to (modified in-place)
 *
 * @example
 * ```typescript
 * const tokens: Token[] = [];
 * tokenizeWords('const MyClass = 123', ['const'], tokens);
 * // tokens contains: [{text: 'const', type: 'keyword'}, {text: 'MyClass', type: 'class'}, ...]
 * ```
 */
export function tokenizeWords(text: string, keywords: string[], tokens: Token[]) {
    const wordPattern = /(\w+|\s+|[^\w\s]+)/g;
    let match;
    let prevToken: string | null = null;

    while ((match = wordPattern.exec(text)) !== null) {
        const word = match[0];

        if (keywords.includes(word)) {
            tokens.push({text: word, type: 'keyword'});
            prevToken = word;
        } else if (/^\d+\.?\d*$/.test(word) || /^\.\d+$/.test(word)) {
            tokens.push({text: word, type: 'number'});
            prevToken = null;
        } else if (/^[A-Z][a-zA-Z0-9]*$/.test(word) && word.length > 1) {
            // Likely a class/type name
            tokens.push({text: word, type: 'class'});
            prevToken = null;
        } else if (/^\w+$/.test(word)) {
            // Check if it follows function/class keywords or is followed by parentheses
            if (prevToken === 'function' || prevToken === 'def' || prevToken === 'fn' || prevToken === 'func') {
                tokens.push({text: word, type: 'function'});
            } else if (prevToken === 'class' || prevToken === 'interface' || prevToken === 'struct' || prevToken === 'enum') {
                tokens.push({text: word, type: 'class'});
            } else {
                tokens.push({text: word});
            }
            prevToken = null;
        } else {
            tokens.push({text: word});
            prevToken = null;
        }
    }
}

/**
 * Tokenizes a line of code based on language, identifying keywords, strings, comments, etc.
 *
 * Performs language-aware syntax tokenization by identifying strings and comments first,
 * then processing the remaining text for keywords and other language constructs.
 * Supports 8 programming languages: TypeScript, JavaScript, Python, Java, Go, Rust, C/C++.
 *
 * @param text - The line of code to tokenize
 * @param languageId - VSCode language identifier (e.g., 'typescript', 'python')
 * @returns Array of tokens with text and type classifications
 *
 * @example
 * ```typescript
 * const tokens = tokenizeLine('const msg = "Hello"', 'typescript');
 * // Returns: [{text: 'const', type: 'keyword'}, ..., {text: '"Hello"', type: 'string'}]
 * ```
 */
export function tokenizeLine(text: string, languageId: string): Token[] {
    const tokens: Token[] = [];

    const langKeywords = LANGUAGE_KEYWORDS[languageId] || LANGUAGE_KEYWORDS['javascript'];

    // Regex patterns
    const stringPattern = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
    const commentPattern = /(\/\/.*|\/\*[\s\S]*?\*\/|#.*)/g;

    let lastIndex = 0;
    const segments: Array<{start: number, end: number, text: string, type: string}> = [];

    // Find strings
    let match;
    while ((match = stringPattern.exec(text)) !== null) {
        segments.push({start: match.index, end: match.index + match[0].length, text: match[0], type: 'string'});
    }

    // Find comments
    commentPattern.lastIndex = 0;
    while ((match = commentPattern.exec(text)) !== null) {
        segments.push({start: match.index, end: match.index + match[0].length, text: match[0], type: 'comment'});
    }

    // Sort segments by start position
    segments.sort((a, b) => a.start - b.start);

    // Fill in the gaps with keywords and regular text
    lastIndex = 0;
    for (const segment of segments) {
        if (lastIndex < segment.start) {
            // Process the text before this segment
            const beforeText = text.substring(lastIndex, segment.start);
            tokenizeWords(beforeText, langKeywords, tokens);
        }
        tokens.push({text: segment.text, type: segment.type});
        lastIndex = segment.end;
    }

    // Process remaining text
    if (lastIndex < text.length) {
        const remainingText = text.substring(lastIndex);
        tokenizeWords(remainingText, langKeywords, tokens);
    }

    return tokens;
}

/**
 * Builds HTML from VSCode's semantic tokens for syntax highlighting
 */
export function buildSemanticTokensHTML(
    lineText: string,
    lineIndex: number,
    semanticTokens: vscode.SemanticTokens,
    legend: vscode.SemanticTokensLegend,
    document: vscode.TextDocument
): string {
    const lineTokens: Array<{start: number, length: number, tokenType: string, modifiers: string[]}> = [];

    // Decode semantic tokens (5 integers per token: deltaLine, deltaStart, length, tokenType, tokenModifiers)
    let currentLine = 0;
    let currentChar = 0;

    for (let i = 0; i < semanticTokens.data.length; i += 5) {
        const deltaLine = semanticTokens.data[i];
        const deltaStart = semanticTokens.data[i + 1];
        const length = semanticTokens.data[i + 2];
        const tokenTypeIndex = semanticTokens.data[i + 3];
        const tokenModifiers = semanticTokens.data[i + 4];

        currentLine += deltaLine;
        if (deltaLine !== 0) {
            currentChar = deltaStart;
        } else {
            currentChar += deltaStart;
        }

        // Only process tokens on our target line
        if (currentLine === lineIndex) {
            const tokenType = legend.tokenTypes[tokenTypeIndex];
            const modifiers: string[] = [];

            // Decode modifiers bitfield
            let modBits = tokenModifiers;
            for (let j = 0; modBits > 0 && j < legend.tokenModifiers.length; j++) {
                if (modBits & 1) {
                    modifiers.push(legend.tokenModifiers[j]);
                }
                modBits >>= 1;
            }

            lineTokens.push({
                start: currentChar,
                length: length,
                tokenType: tokenType,
                modifiers: modifiers
            });
        } else if (currentLine > lineIndex) {
            break;
        }
    }

    // Build HTML with tokens
    if (lineTokens.length === 0) {
        return escapeHtml(lineText);
    }

    let html = '';
    let pos = 0;

    for (const token of lineTokens) {
        // Add any text before this token
        if (token.start > pos) {
            html += escapeHtml(lineText.substring(pos, token.start));
        }

        // Add the token with semantic class
        const tokenText = lineText.substring(token.start, token.start + token.length);
        const cssClass = 'stok-' + token.tokenType;
        html += `<span class="${cssClass}">${escapeHtml(tokenText)}</span>`;

        pos = token.start + token.length;
    }

    // Add any remaining text
    if (pos < lineText.length) {
        html += escapeHtml(lineText.substring(pos));
    }

    return html;
}

/**
 * Gets a highlighted line from a document, using semantic tokens if available,
 * falling back to manual tokenization
 */
export async function getHighlightedLine(document: vscode.TextDocument, lineIndex: number): Promise<string> {
    try {
        const line = document.lineAt(lineIndex);
        const lineText = line.text;
        const languageId = document.languageId;

        // Try to get semantic tokens from VSCode
        try {
            const semanticTokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
                'vscode.provideDocumentSemanticTokens',
                document.uri
            );

            if (semanticTokens && semanticTokens.data.length > 0) {
                const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
                    'vscode.provideDocumentSemanticTokensLegend',
                    document.uri
                );

                if (legend) {
                    return buildSemanticTokensHTML(lineText, lineIndex, semanticTokens, legend, document);
                }
            }
        } catch (e) {
            // Semantic tokens not available, fall through to manual tokenization
        }

        // Fallback to enhanced manual tokenization
        const tokens = tokenizeLine(lineText, languageId);

        // Build HTML with color spans
        let html = '';
        for (const token of tokens) {
            const escapedText = escapeHtml(token.text);
            if (token.type) {
                html += `<span class="token-${token.type}">${escapedText}</span>`;
            } else {
                html += escapedText;
            }
        }

        return html;
    } catch (error) {
        // Fallback to plain text
        return escapeHtml(document.lineAt(lineIndex).text);
    }
}
