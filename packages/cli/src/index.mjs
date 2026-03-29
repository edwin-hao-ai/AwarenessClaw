/**
 * AwarenessClaw CLI — Main entry point
 *
 * Zero-dependency installer that:
 * 1. Detects / installs OpenClaw
 * 2. Installs Awareness memory plugin
 * 3. Starts local daemon
 * 4. Runs device auth (optional)
 * 5. Configures model provider
 * 6. Writes pre-configured Awareness settings
 */

import { detectEnvironment } from './detect.mjs';
import { installOpenClaw } from './installer.mjs';
import { installPlugin } from './plugin-setup.mjs';
import { startDaemon, waitForDaemon } from './daemon.mjs';
import { runDeviceAuth } from './device-auth.mjs';
import { configureModel } from './model-config.mjs';
import { writeConfig } from './config-writer.mjs';
import { checkUpdates } from './updater.mjs';
import { parseArgs, printBanner, printSuccess } from './utils.mjs';

export async function main(argv) {
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    return;
  }

  printBanner();

  // Step 1: Detect environment
  const env = await detectEnvironment();

  // Step 2: Install OpenClaw if needed
  if (!env.openclawInstalled) {
    await installOpenClaw(env);
  }

  // Step 3: Install Awareness plugin
  await installPlugin(env);

  // Step 4: Start local daemon
  await startDaemon();
  await waitForDaemon();

  // Step 5: Device auth (optional, skip if --api-key provided)
  let credentials = {};
  if (args.apiKey) {
    credentials = { apiKey: args.apiKey, memoryId: args.memoryId };
  } else {
    credentials = await runDeviceAuth({ skip: args.skipAuth });
  }

  // Step 6: Configure model provider (skip if --model provided)
  let modelConfig = {};
  if (args.model) {
    modelConfig = { provider: args.provider || 'auto', model: args.model };
  } else if (!args.skipModel) {
    modelConfig = await configureModel();
  }

  // Step 7: Write config
  await writeConfig({ credentials, modelConfig });

  // Step 8: Check for updates
  await checkUpdates();

  printSuccess();
}

function printHelp() {
  console.log(`
AwarenessClaw — One-click AI agent with persistent memory

Usage:
  npx @awareness-sdk/claw              Interactive setup wizard
  npx @awareness-sdk/claw --help       Show this help

Options:
  --api-key <key>       Awareness API key (skip browser auth)
  --memory-id <id>      Awareness memory ID
  --model <name>        Model name (e.g. deepseek-chat, gpt-4o)
  --provider <name>     Model provider (e.g. openai, deepseek, ollama)
  --skip-auth           Skip cloud auth, use local-only mode
  --skip-model          Skip model configuration
  --help                Show this help message

Examples:
  npx @awareness-sdk/claw
  npx @awareness-sdk/claw --api-key aw_xxx --memory-id mem_xxx
  npx @awareness-sdk/claw --model deepseek-chat --skip-auth
`);
}
