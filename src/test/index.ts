import * as path from 'path';
import { glob } from 'glob';

export async function run(): Promise<void> {
    // Import Mocha dynamically
    const Mocha = (await import('mocha')).default;

    // Create the mocha test
    const mocha = new Mocha({
        ui: 'tdd',
        color: true
    });

    const testsRoot = path.resolve(__dirname, '.');

    try {
        // Find test files
        const files = await glob('**/**.test.js', { cwd: testsRoot });

        // Add files to the test suite
        files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

        // Run the mocha test
        return new Promise((resolve, reject) => {
            try {
                mocha.run((failures: number) => {
                    if (failures > 0) {
                        reject(new Error(`${failures} tests failed.`));
                    } else {
                        resolve();
                    }
                });
            } catch (err) {
                console.error(err);
                reject(err);
            }
        });
    } catch (err) {
        throw err;
    }
}
