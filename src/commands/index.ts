import * as vscode from 'vscode';

/**
 * Interface for command handler dependencies.
 * All command handlers are passed in from extension.ts to maintain current functionality.
 */
export interface CommandHandlers {
    addSearchHighlight: () => Promise<void>;
    addSelectionToFind: () => Promise<void>;
    addGlobalSearch: () => Promise<void>;
    addSelectionToGlobalSearch: () => Promise<void>;
    findInFolder: (uri: vscode.Uri) => Promise<void>;
    clearAllHighlights: () => Promise<void>;
    removeHighlight: (highlightId: string) => Promise<void>;
    goToNextMatch: () => void;
    goToPreviousMatch: () => void;
}

/**
 * Registers all MultiSearch commands with VSCode.
 * Uses dependency injection to receive command handlers from the main extension.
 *
 * @param context - VSCode extension context for subscriptions
 * @param handlers - Object containing all command handler functions
 */
export function registerCommands(
    context: vscode.ExtensionContext,
    handlers: CommandHandlers
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('multi-search.addFindWidget', async () => {
            await handlers.addSearchHighlight();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('multi-search.addSelectionToFind', async () => {
            await handlers.addSelectionToFind();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('multi-search.addGlobalSearch', async () => {
            await handlers.addGlobalSearch();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('multi-search.addSelectionToGlobalSearch', async () => {
            await handlers.addSelectionToGlobalSearch();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('multi-search.findInFolder', async (uri: vscode.Uri) => {
            await handlers.findInFolder(uri);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('multi-search.clearAllWidgets', () => {
            handlers.clearAllHighlights();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('multi-search.removeHighlight', (highlightId: string) => {
            handlers.removeHighlight(highlightId);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('multi-search.goToNextMatch', () => {
            handlers.goToNextMatch();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('multi-search.goToPreviousMatch', () => {
            handlers.goToPreviousMatch();
        })
    );
}
