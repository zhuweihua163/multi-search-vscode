/**
 * Encoding utilities for handling byte-to-character offset conversion.
 * Ripgrep returns positions in UTF-8 bytes, but JavaScript strings and VSCode
 * use UTF-16 code units. This module handles multi-byte characters correctly.
 */

/**
 * Convert byte offset to UTF-16 code unit offset.
 *
 * Example: 📁 is 4 bytes in UTF-8, but 2 code units in UTF-16 (surrogate pair)
 *
 * @param text The text string to convert offsets for
 * @param byteOffset The byte offset from ripgrep
 * @returns The UTF-16 code unit offset for use in VSCode
 */
export function byteOffsetToCharOffset(text: string, byteOffset: number): number {
    const encoder = new TextEncoder();
    let byteCount = 0;
    let utf16Offset = 0;

    for (const codePoint of text) {
        if (byteCount >= byteOffset) {
            break;
        }
        byteCount += encoder.encode(codePoint).length;
        // codePoint.length gives the number of UTF-16 code units (1 or 2)
        utf16Offset += codePoint.length;
    }

    return utf16Offset;
}
