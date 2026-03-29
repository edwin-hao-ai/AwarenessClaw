#!/usr/bin/env node

/**
 * AwarenessClaw CLI — One-click setup for OpenClaw with Awareness memory
 *
 * Usage:
 *   npx @awareness-sdk/claw           # Interactive setup wizard
 *   npx @awareness-sdk/claw --help    # Show help
 *   npx @awareness-sdk/claw --api-key aw_xxx --memory-id xxx  # Non-interactive
 */

import { main } from '../src/index.mjs';

main(process.argv.slice(2)).catch((err) => {
  console.error('\n❌ AwarenessClaw setup failed:', err.message);
  process.exit(1);
});
