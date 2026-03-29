/**
 * CLI utilities — argument parsing, banner, colors
 */

export function parseArgs(argv) {
  const args = {
    help: false,
    apiKey: null,
    memoryId: null,
    model: null,
    provider: null,
    skipAuth: false,
    skipModel: false,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--help': case '-h': args.help = true; break;
      case '--api-key': args.apiKey = argv[++i]; break;
      case '--memory-id': args.memoryId = argv[++i]; break;
      case '--model': args.model = argv[++i]; break;
      case '--provider': args.provider = argv[++i]; break;
      case '--skip-auth': args.skipAuth = true; break;
      case '--skip-model': args.skipModel = true; break;
    }
  }

  return args;
}

export function printBanner() {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   🧠 AwarenessClaw                                    ║
║   One-click AI agent with persistent memory           ║
║                                                       ║
║   Built on OpenClaw + Awareness Memory                ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
`);
}

export function printSuccess() {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   ✅ AwarenessClaw is ready!                          ║
║                                                       ║
║   Start chatting:  openclaw chat                      ║
║   Open dashboard:  openclaw dashboard                 ║
║                                                       ║
║   Your AI now remembers everything across sessions.   ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
`);
}
