# Contributing to MultiSearch

Thank you for your interest in contributing to MultiSearch! We welcome bug reports, feature requests, documentation improvements, and code contributions.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Architecture Overview](#architecture-overview)
- [Key Components](#key-components)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Style Guidelines](#code-style-guidelines)
- [Submitting Changes](#submitting-changes)

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- VSCode or VSCodium
- Git

### Development Setup

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/Ghizmoo/multisearch-vscode.git
   cd MultiSearch
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Compile the extension:**
   ```bash
   npm run compile
   ```

4. **Watch mode for development:**
   ```bash
   npm run watch
   ```

5. **Open in VSCode:**
   ```bash
   code .
   ```

6. **Run the extension:**
   - Press `F5` to open a new Extension Development Host window
   - The extension will be loaded and ready to test

## Architecture Overview

The codebase is organized with a modular structure for better maintainability:

```
src/
├── extension.ts              # Main extension entry point and activation
├── types/                    # TypeScript interfaces and type definitions
│   ├── interfaces.ts         # SearchHighlight, LineMatch, FileMatchDetail
│   └── index.ts              # Type exports
├── core/                     # Core decoration and match utilities
│   ├── decorationUtils.ts    # updateFileMatchesFromMap, createSearchDecorations
│   └── index.ts              # Core exports
├── search/                   # Search-related functionality
│   ├── searchOperations.ts   # Main search logic (ripgrep integration)
│   ├── searchUtils.ts        # Helper functions (regex, counting, filtering)
│   ├── ripgrepService.ts     # Ripgrep service abstraction and process management
│   └── index.ts              # Search exports
├── ui/                       # UI components and webview
│   ├── webviewProvider.ts    # Main webview panel logic
│   ├── syntaxHighlight.ts    # Code syntax highlighting in results
│   ├── quickPickUtils.ts     # Quick pick UI utilities for search selection
│   └── index.ts              # UI exports
├── commands/                 # Command handlers and registration
│   └── index.ts              # Command exports and registration
├── listeners/                # Event listeners and handlers
│   └── index.ts              # Listener exports and registration
├── utils/                    # General utility functions and constants
│   ├── colors.ts             # Color palette constants (COLORS array)
│   ├── pathUtils.ts          # File path utilities (openFileFromPath)
│   ├── constants.ts          # Configuration constants (RG_PATH)
│   ├── encoding.ts           # UTF-8 to UTF-16 offset conversion utilities
│   ├── escapeSequences.ts    # ANSI escape sequence handling
│   └── index.ts              # Utility exports
└── test/                     # Test files
    ├── index.ts              # Test suite configuration
    ├── searchUtils.test.ts   # Unit tests for search utilities
    └── syntaxHighlight.test.ts # Unit tests for syntax highlighting
```

## Key Components

### Extension Entry Point ([extension.ts](src/extension.ts))

The main activation point for the extension. Handles:
- Command registration (Ctrl+F, Ctrl+Shift+F, etc.)
- Search highlight management
- Editor decorations
- Integration with webview provider

### Search Operations ([search/searchOperations.ts](src/search/searchOperations.ts))

Core search functionality using ripgrep:
- File-based searches with glob patterns
- In-memory searches for unsaved documents
- UTF-8 to UTF-16 offset conversion for proper highlighting
- Support for regex, case sensitivity, and whole word matching

### Webview Provider ([ui/webviewProvider.ts](src/ui/webviewProvider.ts))

Manages the search results panel:
- Displays active searches with color coding
- Shows file matches and line previews
- Handles user interactions (click to navigate, edit paths, etc.)
- State persistence across VSCode sessions

### Decoration Utilities ([core/decorationUtils.ts](src/core/decorationUtils.ts))

Creates and manages text decorations:
- Color-coded highlights in the editor
- Decoration lifecycle management
- Match index tracking

## Development Workflow

### Adding a New Feature

1. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes:**
   - Write code following the style guidelines
   - Update relevant documentation
   - Test thoroughly in the Extension Development Host

3. **Compile and check for errors:**
   ```bash
   npm run compile
   npm run lint
   ```

4. **Commit your changes:**
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

### Debugging

1. **Set breakpoints** in VSCode by clicking in the gutter next to line numbers

2. **Press F5** to start debugging - this opens a new Extension Development Host

3. **View logs:**
   - Open Developer Tools: Help → Toggle Developer Tools
   - Check the Console tab for `console.log()` output
   - MultiSearch logs include `=== MultiSearch Debug ===` markers

4. **View extension output:**
   - Open Output panel: View → Output
   - Select "Extension Host" from the dropdown

### Working with the Webview

The webview uses inline HTML/CSS/JavaScript. When editing [webviewProvider.ts](src/ui/webviewProvider.ts):

1. Changes to webview HTML/CSS/JS require reloading the Extension Development Host
2. Use `console.log()` in the webview script - logs appear in the Extension Development Host's Developer Tools
3. The webview state persists using `vscode.setState()` and `vscode.getState()`

## Testing

### Manual Testing Checklist

When adding new features or fixing bugs, test:

- [ ] Current file search (Ctrl+F)
- [ ] Global search (Ctrl+Shift+F)
- [ ] Regex search mode
- [ ] Case-sensitive search
- [ ] Whole word search
- [ ] File path filters (include/exclude)
- [ ] Multiple comma-separated patterns
- [ ] Navigation (F3/F4, click to jump)
- [ ] Clearing searches
- [ ] Search persistence across sessions
- [ ] Unicode/emoji handling in search results
- [ ] Very long lines (500+ characters)

### Testing with Different Files

Test with:
- Small files (< 100 lines)
- Large files (> 10,000 lines)
- Binary files
- Files with emojis or special Unicode characters
- Unsaved/untitled documents

## Code Style Guidelines

### TypeScript

- Use **explicit types** for function parameters and return values
- Prefer **interfaces** over type aliases for object shapes
- Use **async/await** instead of `.then()` for promises
- Add **JSDoc comments** for exported functions and complex logic

### Naming Conventions

- **Variables/Functions:** camelCase (`searchTerm`, `updateWebview`)
- **Interfaces/Types:** PascalCase (`SearchHighlight`, `LineMatch`)
- **Constants:** UPPER_SNAKE_CASE (`RG_PATH`, `COLORS`)
- **Private class members:** Prefix with underscore (`_pendingAutoExpand`)

### File Organization

- One main export per file when possible
- Group related functionality in directories
- Use `index.ts` for clean re-exports
- Keep files under 1000 lines - split if needed

### Comments

- Explain **why**, not what (code should be self-documenting)
- Use `//` for single-line comments
- Use `/** */` for function documentation
- Add section headers for long files:
  ```typescript
  // ============================================================================
  // Section Name
  // ============================================================================
  ```

### Error Handling

- Use try/catch for async operations
- Show user-friendly error messages via `vscode.window.showErrorMessage()`
- Log detailed errors to console for debugging
- Don't fail silently - always handle errors

## Submitting Changes

### Pull Request Process

1. **Update documentation** if you've changed functionality
2. **Test thoroughly** using the manual testing checklist
3. **Ensure it compiles** without errors or warnings:
   ```bash
   npm run compile
   npm run lint
   ```

4. **Create a pull request** with:
   - Clear title describing the change
   - Description of what changed and why
   - Reference any related issues

5. **Address review feedback** promptly

### Commit Message Format

Follow conventional commits:

- `feat: add support for multiple include patterns`
- `fix: correct highlight offset for emoji characters`
- `docs: update architecture diagram in CONTRIBUTING`
- `refactor: extract search logic to separate module`
- `chore: update dependencies`

### What to Include in PRs

- **Code changes** with clear intent
- **Updated documentation** (README, CONTRIBUTING, code comments)
- **No breaking changes** without discussion (open an issue first)

### What NOT to Include

- Unrelated changes (create separate PRs)
- Commented-out code
- Console.log statements for debugging (unless part of a logging system)
- Large dependency additions without justification

## Questions or Need Help?

- Open an issue for bugs or feature requests
- Check existing issues before creating new ones
- Be respectful and constructive in discussions

Thank you for contributing to MultiSearch!