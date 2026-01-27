// Configuration constants for MultiSearch extension

// Path to ripgrep binary - determined at runtime with fallback
export let RG_PATH: string;

try {
    const ripgrepModule = require('@vscode/ripgrep');
    RG_PATH = ripgrepModule.rgPath;
    // Verify the path exists and is accessible
    const fs = require('fs');
    if (!fs.existsSync(RG_PATH)) {
        console.warn(`MultiSearch: Ripgrep binary not found at ${RG_PATH}, falling back to system ripgrep`);
        RG_PATH = 'rg';
    }
} catch (error) {
    // Fallback to system ripgrep (installed via apt, brew, choco, etc.)
    RG_PATH = 'rg';
}
