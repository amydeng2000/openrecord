#!/usr/bin/env node
// Stdio MCP transport requires stdout be ONLY JSON-RPC messages — anything
// else corrupts the framing and the host (Claude Desktop) reports
// "Unexpected token X is not valid JSON". The scrapers / login code use
// console.log freely for human-readable progress messages, so reroute every
// such call to stderr BEFORE any scraper module is imported.
//
// Console method lookups are dynamic (`console.log` is resolved at call
// time, not at import time), so this rebinding affects all later callers
// regardless of when they were imported.
/* eslint-disable @typescript-eslint/no-explicit-any */
(console as any).log = console.error;
(console as any).info = console.error;
(console as any).debug = console.error;
(console as any).warn = console.error;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * OpenRecord MCPB — Claude Desktop Extension entry point.
 *
 * Stdio MCP server that speaks the 2025-06-18 protocol (so it can use
 * elicitation). Delegates all tool implementation to ./tools.ts; the
 * setup wizard is in ./setup-flow.ts; session management in ./session-manager.ts.
 *
 * The bundle is run by Claude Desktop as `node dist/server.cjs`. No
 * user_config is required — all auth happens via the in-chat setup_account
 * tool, which uses MCP elicitation to deterministically collect each field
 * (instance picker → username + password → 2FA → passkey opt-in).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './tools';
import { clearAllSessions } from './session-manager';

async function main(): Promise<void> {
  const server = new McpServer(
    {
      name: 'openrecord',
      version: '0.1.0',
    },
    {
      capabilities: { tools: {} },
      instructions:
        'OpenRecord connects this conversation to the user\'s MyChart patient portal. ' +
        '\n\n' +
        'EVERY data tool requires an `account` parameter — the MyChart hostname returned by ' +
        'list_accounts. If you do not already know which account to use, call list_accounts ' +
        'first. Multiple accounts can be active at once; just pass a different `account` per call.' +
        '\n\n' +
        'Setup flow (no MCP elicitation needed — runs as ordinary tool calls + chat prompts):' +
        '\n  1. Call list_accounts. If the user\'s MyChart is already there, skip to step 5.' +
        '\n  2. Ask the user for their health system name. Call search_mycharts(query) to find the hostname.' +
        '\n  3. Ask the user for their MyChart username and password.' +
        '\n  4. Call setup_account(hostname, username, password). On `need_2fa`, ask the user for the ' +
        '     6-digit code, then call complete_2fa(pending_id, code). On `invalid_login`, ask again.' +
        '\n  5. (Recommended) Call register_passkey(account) so future logins skip the password + 2FA.' +
        '\n  6. Use the data tools (get_medications, get_lab_results, send_message, etc.) with the ' +
        '     `account` from the previous step.',
    },
  );

  registerAllTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean up keepalive timers when the parent (Claude Desktop) closes stdio.
  const shutdown = () => {
    clearAllSessions();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('close', shutdown);
}

main().catch(err => {
  console.error('[openrecord] fatal:', err);
  process.exit(1);
});
