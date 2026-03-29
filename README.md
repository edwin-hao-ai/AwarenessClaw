# AwarenessClaw

> One-click AI agent with persistent memory. Built on [OpenClaw](https://openclaw.ai) + [Awareness Memory](https://awareness.market).

**AwarenessClaw** gives you a fully configured AI assistant that remembers everything across conversations — with zero technical setup.

## Features

- **One-Click Install**: Download, double-click, done. No terminal, no Node.js, no Git.
- **Persistent Memory**: Your AI remembers past conversations, decisions, and preferences.
- **Visual Configuration**: Set up models, channels (Telegram, WhatsApp, Slack), and memory — all through a clean GUI.
- **Auto Upgrade**: Follows OpenClaw releases automatically.
- **Cross-Platform**: Windows, macOS, Linux.

## Quick Start

### Option 1: Desktop App (Recommended)

Download from [Releases](https://github.com/edwin-hao-ai/AwarenessClaw/releases):
- **Windows**: `AwarenessClaw-Setup.exe`
- **macOS**: `AwarenessClaw.dmg`
- **Linux**: `AwarenessClaw.AppImage`

### Option 2: CLI (Advanced)

```bash
npx @awareness-sdk/claw
```

## Architecture

```
AwarenessClaw (this project)
  └── wraps OpenClaw (open-source AI agent, 247K+ stars)
       └── pre-configured with Awareness Memory plugin
            └── hybrid search (vector + keyword)
            └── perception signals (contradiction, pattern, resonance)
            └── cross-device sync
```

## Development

```bash
# CLI
cd packages/cli && npm start

# Desktop
cd packages/desktop && npm run dev
```

## License

MIT
