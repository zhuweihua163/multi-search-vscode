import * as vscode from 'vscode';
import * as path from 'path';

export async function openFileFromPath(filePath: string, line?: number, workspaceRoot?: string) {
    let fullPath: vscode.Uri;

    

    // If workspace root is provided, use it (for searches from different windows)
    if (workspaceRoot && workspaceRoot.trim() !== '') {
        fullPath = vscode.Uri.file(path.join(workspaceRoot, filePath));
        
    } else {
        // Fallback to current workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showWarningMessage('No workspace folder open');
            return;
        }
        fullPath = vscode.Uri.file(path.join(workspaceFolders[0].uri.fsPath, filePath));
        
    }

    try {
        
        const document = await vscode.workspace.openTextDocument(fullPath);
        const editor = await vscode.window.showTextDocument(document);

        // If line number is provided, move cursor to that line
        if (line !== undefined && line > 0) {
            const position = new vscode.Position(line - 1, 0); // Convert to 0-based
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }
        
    } catch (error) {
        console.error(`[MultiSearch] Failed to open file: ${error}`);
        vscode.window.showErrorMessage(`Failed to open file: ${filePath} - ${error}`);
    }
}
