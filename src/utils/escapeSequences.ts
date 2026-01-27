/**
 * Escape sequence utilities for handling special characters in search patterns.
 * Converts escape sequences like \n, \t, \r into regex patterns that match both
 * the literal escape sequence and the actual character.
 */

interface EscapeChar {
    seq: string;
    actual: string;
    placeholder: string;
    pattern: string;
}

/**
 * List of supported escape sequences and their character mappings
 */
const ESCAPE_SEQUENCES: EscapeChar[] = [
    { seq: '\\n', actual: '\n', placeholder: '\u0001NEWLINE\u0001', pattern: '(\\n|\\\\n)' },
    { seq: '\\t', actual: '\t', placeholder: '\u0001TAB\u0001', pattern: '(\\t|\\\\t)' },
    { seq: '\\r', actual: '\r', placeholder: '\u0001CR\u0001', pattern: '(\\r|\\\\r)' },
    { seq: '\\b', actual: '\b', placeholder: '\u0001BS\u0001', pattern: '(\\x08|\\\\b)' },
    { seq: '\\f', actual: '\f', placeholder: '\u0001FF\u0001', pattern: '(\\f|\\\\f)' },
    { seq: '\\a', actual: '\x07', placeholder: '\u0001BELL\u0001', pattern: '(\\x07|\\\\a)' },
    { seq: '\\v', actual: '\v', placeholder: '\u0001VT\u0001', pattern: '(\\v|\\\\v)' }
];

/**
 * Check if a search term contains any escape sequences
 */
export function hasEscapeSequences(searchTerm: string): boolean {
    // Check only for the escape sequence forms (\n, \t, etc), not the actual characters
    // because actual characters would be ambiguous in plain text
    return ESCAPE_SEQUENCES.some(seq => searchTerm.includes(seq.seq));
}

/**
 * Convert escape sequences in a search term to regex patterns
 * Replaces \n, \t, etc. with patterns that match both the literal sequence and the actual character
 *
 * @param searchTerm The search term potentially containing escape sequences
 * @returns Object with processed term and map of placeholders to patterns
 */
export function convertEscapeSequences(searchTerm: string): {
    term: string;
    placeholders: Map<string, string>;
} {
    const placeholders = new Map<string, string>();
    let processedTerm = searchTerm;

    for (const { seq, actual, placeholder, pattern } of ESCAPE_SEQUENCES) {
        if (processedTerm.includes(seq)) {
            processedTerm = processedTerm.split(seq).join(placeholder);
            placeholders.set(placeholder, pattern);
        } else if (processedTerm.includes(actual)) {
            processedTerm = processedTerm.split(actual).join(placeholder);
            placeholders.set(placeholder, pattern);
        }
    }

    return { term: processedTerm, placeholders };
}

/**
 * Build a regex pattern from a search term with escape sequence handling
 * Returns the pattern as a string for use with ripgrep or as a RegExp source
 *
 * @param searchTerm The original search term
 * @param isCaseSensitive Whether to use case-sensitive matching
 * @param isWholeWord Whether to match whole words only
 * @returns The regex pattern string
 */
export function buildRegexPatternWithEscapeSequences(
    searchTerm: string,
    isWholeWord: boolean = false
): string {
    const { term: processedTerm, placeholders } = convertEscapeSequences(searchTerm);

    // Escape regex special chars
    let regexPattern = processedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Add whole word boundaries if needed
    if (isWholeWord) {
        regexPattern = `\\b${regexPattern}\\b`;
    }

    // Replace placeholders with patterns
    for (const [placeholder, pattern] of placeholders) {
        regexPattern = regexPattern.split(placeholder).join(pattern);
    }

    return regexPattern;
}

/**
 * Build a RegExp from a search term with escape sequence handling
 *
 * @param searchTerm The original search term
 * @param isCaseSensitive Whether to use case-sensitive matching
 * @param isWholeWord Whether to match whole words only
 * @returns The compiled RegExp object
 */
export function buildRegexWithEscapeSequences(
    searchTerm: string,
    isCaseSensitive: boolean,
    isWholeWord: boolean = false
): RegExp {
    const regexPattern = buildRegexPatternWithEscapeSequences(searchTerm, isWholeWord);
    const flags = isCaseSensitive ? 'gm' : 'gim';
    return new RegExp(regexPattern, flags);
}
