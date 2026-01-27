import * as assert from 'assert';
import { tokenizeLine, tokenizeWords, Token } from '../ui/syntaxHighlight';

suite('Syntax Highlight Test Suite', () => {

    suite('tokenizeWords', () => {
        test('should identify keywords', () => {
            const tokens: Token[] = [];
            const keywords = ['const', 'let', 'var'];
            tokenizeWords('const x = 10', keywords, tokens);

            assert.ok(tokens.some(t => t.text === 'const' && t.type === 'keyword'));
        });

        test('should identify numbers', () => {
            const tokens: Token[] = [];
            tokenizeWords('x = 123', [], tokens);

            assert.ok(tokens.some(t => t.text === '123' && t.type === 'number'));
        });

        test('should identify floating point numbers', () => {
            const tokens: Token[] = [];
            tokenizeWords('pi = 3.14', [], tokens);

            assert.ok(tokens.some(t => t.text === '3.14' && t.type === 'number'));
        });

        test('should identify class names', () => {
            const tokens: Token[] = [];
            tokenizeWords('MyClass extends BaseClass', [], tokens);

            assert.ok(tokens.some(t => t.text === 'MyClass' && t.type === 'class'));
        });

        test('should identify functions after function keyword', () => {
            const tokens: Token[] = [];
            const keywords = ['function'];
            tokenizeWords('function myFunc', keywords, tokens);

            const funcToken = tokens.find(t => t.text === 'myFunc');
            assert.ok(funcToken);
            assert.strictEqual(funcToken?.type, 'function');
        });
    });

    suite('tokenizeLine', () => {
        test('should tokenize JavaScript code with strings', () => {
            const tokens = tokenizeLine('const msg = "Hello World"', 'javascript');

            // Should have const as keyword
            assert.ok(tokens.some(t => t.text === 'const' && t.type === 'keyword'));

            // Should have string
            assert.ok(tokens.some(t => t.text === '"Hello World"' && t.type === 'string'));
        });

        test('should tokenize comments', () => {
            const tokens = tokenizeLine('// This is a comment', 'javascript');

            assert.ok(tokens.some(t => t.type === 'comment'));
        });

        test('should tokenize Python code', () => {
            const tokens = tokenizeLine('def greet():', 'python');

            assert.ok(tokens.some(t => t.text === 'def' && t.type === 'keyword'));
        });

        test('should handle multi-line comment syntax', () => {
            const tokens = tokenizeLine('/* comment */', 'javascript');

            assert.ok(tokens.some(t => t.type === 'comment'));
        });

        test('should handle empty lines', () => {
            const tokens = tokenizeLine('', 'javascript');

            assert.strictEqual(tokens.length, 0);
        });

        test('should tokenize TypeScript keywords', () => {
            const tokens = tokenizeLine('interface User { name: string }', 'typescript');

            assert.ok(tokens.some(t => t.text === 'interface' && t.type === 'keyword'));
            assert.ok(tokens.some(t => t.text === 'string' && t.type === 'keyword'));
        });

        test('should handle backtick strings', () => {
            const tokens = tokenizeLine('const msg = `template ${var}`', 'javascript');

            assert.ok(tokens.some(t => t.type === 'string' && t.text.includes('`')));
        });

        test('should identify class after class keyword', () => {
            const tokens = tokenizeLine('class MyClass extends Base', 'javascript');

            const myClassToken = tokens.find(t => t.text === 'MyClass');
            assert.strictEqual(myClassToken?.type, 'class');
        });
    });
});
