#!/usr/bin/env node

/**
 * Build Electron main + preload from TypeScript
 */

import { execSync } from 'child_process';

console.log('Building Electron main process...');
execSync('npx tsc -p tsconfig.electron.json', { stdio: 'inherit' });
console.log('Electron build complete.');
