import * as assert from 'assert';
import { escapeHtml, createRegex } from '../search/searchUtils';
import { SearchHighlight } from '../types';

suite('Search Utils Test Suite', () => {

    suite('escapeHtml', () => {
        test('should escape HTML special characters', () => {
            const input = '<script>alert("XSS")</script>';
            const expected = '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;';
            assert.strictEqual(escapeHtml(input), expected);
        });

        test('should escape ampersands', () => {
            assert.strictEqual(escapeHtml('A & B'), 'A &amp; B');
        });

        test('should escape single quotes', () => {
            assert.strictEqual(escapeHtml("It's"), 'It&#039;s');
        });

        test('should handle empty string', () => {
            assert.strictEqual(escapeHtml(''), '');
        });

        test('should handle string with no special characters', () => {
            assert.strictEqual(escapeHtml('Hello World'), 'Hello World');
        });
    });

    suite('createRegex', () => {
        test('should create case-insensitive regex by default', () => {
            const highlight: SearchHighlight = {
                id: 'test',
                searchTerm: 'test',
                decorationType: {} as any,
                color: '#fff',
                isRegex: false,
                isCaseSensitive: false,
                isWholeWord: false
            };

            const regex = createRegex(highlight);
            assert.strictEqual(regex.flags, 'gi');
            assert.strictEqual(regex.test('TEST'), true);
            assert.strictEqual(regex.test('test'), true);
        });

        test('should create case-sensitive regex when specified', () => {
            const highlight: SearchHighlight = {
                id: 'test',
                searchTerm: 'test',
                decorationType: {} as any,
                color: '#fff',
                isRegex: false,
                isCaseSensitive: true,
                isWholeWord: false
            };

            const regex = createRegex(highlight);
            assert.strictEqual(regex.flags, 'g');
            assert.strictEqual(regex.test('TEST'), false);
            assert.strictEqual(regex.test('test'), true);
        });

        test('should create whole word regex', () => {
            const highlight: SearchHighlight = {
                id: 'test',
                searchTerm: 'log',
                decorationType: {} as any,
                color: '#fff',
                isRegex: false,
                isCaseSensitive: false,
                isWholeWord: true
            };

            const regex = createRegex(highlight);
            assert.strictEqual(regex.test('log'), true);
            assert.strictEqual(regex.test('logger'), false);
            assert.strictEqual(regex.test('dialog'), false);
        });

        test('should handle regex patterns', () => {
            const highlight: SearchHighlight = {
                id: 'test',
                searchTerm: 'test\\d+',
                decorationType: {} as any,
                color: '#fff',
                isRegex: true,
                isCaseSensitive: false,
                isWholeWord: false
            };

            const regex = createRegex(highlight);
            assert.strictEqual(regex.test('test123'), true);
            assert.strictEqual(regex.test('test'), false);
        });

        test('should escape special regex characters in literal mode', () => {
            const highlight: SearchHighlight = {
                id: 'test',
                searchTerm: 'a+b*c?',
                decorationType: {} as any,
                color: '#fff',
                isRegex: false,
                isCaseSensitive: false,
                isWholeWord: false
            };

            const regex = createRegex(highlight);
            assert.strictEqual(regex.test('a+b*c?'), true);
            assert.strictEqual(regex.test('aaabbbccc'), false);
        });
    });
});
