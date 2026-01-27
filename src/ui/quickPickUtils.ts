/**
 * QuickPick utilities for search term input with live preview
 *
 * Provides reusable components for creating interactive QuickPick dialogs
 * that show live search results as the user types.
 */

import * as vscode from 'vscode';

/**
 * Create a preview decoration type for highlighting matches
 */
export function createPreviewDecorationType(): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
        backgroundColor: '#FF6B6B40',
        border: '1px solid #FF6B6B',
        borderRadius: '2px',
        overviewRulerColor: '#FF6B6B',
        overviewRulerLane: vscode.OverviewRulerLane.Center
    });
}

/**
 * Create navigation buttons for QuickPick
 */
export function createNavigationButtons(): {
    prev: vscode.QuickInputButton;
    next: vscode.QuickInputButton;
} {
    return {
        prev: {
            iconPath: new vscode.ThemeIcon('arrow-up'),
            tooltip: 'Previous match (↑)'
        },
        next: {
            iconPath: new vscode.ThemeIcon('arrow-down'),
            tooltip: 'Next match (↓)'
        }
    };
}

/**
 * Update QuickPick title and buttons based on match count
 */
export function updateQuickPickButtons(
    quickPick: vscode.QuickPick<vscode.QuickPickItem>,
    baseTitle: string,
    currentIndex: number,
    totalMatches: number,
    buttons: { prev: vscode.QuickInputButton; next: vscode.QuickInputButton }
): void {
    if (totalMatches > 0) {
        quickPick.title = `${baseTitle} - ${currentIndex + 1} of ${totalMatches} matches`;
    } else {
        quickPick.title = baseTitle;
    }
    quickPick.buttons = [buttons.prev, buttons.next];
}

/**
 * Check if a button click matches a specific icon
 */
export function isButtonClick(button: vscode.QuickInputButton, iconId: string): boolean {
    return (button.iconPath as vscode.ThemeIcon)?.id === iconId;
}
