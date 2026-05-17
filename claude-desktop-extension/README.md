# OpenRecord — Claude Desktop Extension

A Claude Desktop Extension (`.mcpb`) that gives Claude access to your Epic
MyChart patient portal. Read your medications, lab results, imaging, messages,
billing, and more — or send a message to your care team, request a refill,
and manage emergency contacts — all through a natural conversation.

## Install

```bash
cd claude-desktop-extension
bun install
bun run pack          # builds dist/server.cjs and produces openrecord.mcpb
```

Then double-click `openrecord.mcpb` (or drag it into Claude Desktop → Settings → Extensions).

## Use

After installing, open a new Claude chat and say:

> Set up my MyChart.

Claude walks through a setup sequence using ordinary tool calls (works in
Claude Desktop, Claude.ai web, and any other MCP client):

1. **`search_mycharts`** — Claude asks you for your health system name (e.g.
   "uchealth", "mass general") and looks up the hostname.
2. **`setup_account(hostname, username, password)`** — Claude asks you for
   your credentials in chat, then logs in. Credentials are stored locally in
   `~/.openrecord-mcpb/` on your machine. Never sent to Anthropic.
3. **`complete_2fa(pending_id, code)`** — if MyChart requires 2FA, Claude
   asks you for the 6-digit code.
4. **`register_passkey(account)`** — (optional, recommended) future logins
   skip the password and 2FA prompts entirely.

After setup, every data tool takes a required `account` parameter (the
MyChart hostname returned by `list_accounts`). Multiple accounts can be
active at the same time — just pass a different `account` per call.

> What's my next appointment at uchealth?
> Refill my lisinopril (use my mass general account).
> Send a message to Dr. Smith asking about my latest blood pressure reading.
> Show me my last imaging study.

## Architecture

- **stdio MCP server** — speaks the 2025-06-18 MCP protocol with elicitation
  support. Claude Desktop ships its own Node runtime; no Node install needed
  on the user's machine.
- **Pure JS** — no `sharp`, no `keytar`, no `sqlite3`. CLO → JPEG imaging
  conversion uses [`jpeg-js`](https://www.npmjs.com/package/jpeg-js).
- **Local storage** — credentials and sessions live at `~/.openrecord-mcpb/`:
  - `accounts.json` — username/password (file mode 0600)
  - `passkeys/<hostname>.json` — WebAuthn credentials
  - `sessions/<hostname>.json` — serialized cookie jars for fast resume

## File layout

```
claude-desktop-extension/
├── manifest.json           # MCPB manifest (see https://github.com/modelcontextprotocol/mcpb)
├── package.json
├── tsup.config.ts          # single-file CJS bundle for Claude Desktop's Node
├── icon.png                # 256×256 extension icon
└── src/
    ├── index.ts            # stdio entry
    ├── tools.ts            # registers setup_account + all scraper tools
    ├── setup-flow.ts       # elicitation-driven setup wizard
    ├── session-manager.ts  # per-account session cache with keepalive + passkey auto-login
    ├── credential-store.ts # ~/.openrecord-mcpb/ persistence
    ├── instances.ts        # picker data (sourced from scrapers/list-all-mycharts/)
    └── imaging/            # pure-JS CLO → JPEG encoder
```

## Development

```bash
bun run build      # produces dist/server.cjs
bun run dev        # tsup watch mode
bun run pack       # build + run `mcpb pack` → openrecord.mcpb
```

To test in Claude Desktop:

1. `bun run pack`
2. Drag the resulting `openrecord.mcpb` into Claude Desktop → Settings → Extensions.
3. Open a new chat and ask Claude to "set up MyChart".
