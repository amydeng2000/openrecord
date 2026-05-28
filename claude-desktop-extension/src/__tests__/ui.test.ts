import { describe, expect, test } from 'bun:test';
import { buildSetupUiHtml, SETUP_UI_MIME_TYPE } from '../ui';

describe('buildSetupUiHtml', () => {
  test('serves the MCP Apps mime type', () => {
    expect(SETUP_UI_MIME_TYPE).toBe('text/html;profile=mcp-app');
  });

  test('renders all three setup steps', () => {
    const html = buildSetupUiHtml();
    // Step 1: health-system picker.
    expect(html).toContain('id="step-picker"');
    // Step 2: chosen instance logo + username/password fields.
    expect(html).toContain('id="step-creds"');
    expect(html).toContain('id="instance-logo"');
    expect(html).toContain('id="username"');
    expect(html).toContain('id="password"');
    // Step 3: dedicated 2FA code entry (only reached when need_2fa).
    expect(html).toContain('id="step-2fa"');
    expect(html).toContain('id="2fa-code"');
    expect(html).toContain('id="verify"');
  });

  test('keeps the hidden attribute authoritative over flex layout', () => {
    // .field { display:flex } would otherwise beat the UA [hidden] rule, so a
    // global [hidden]{display:none!important} must be present.
    expect(buildSetupUiHtml()).toContain('[hidden] { display: none !important; }');
  });

  test('fully replaces the featured placeholder (default = empty array)', () => {
    const html = buildSetupUiHtml();
    expect(html).not.toContain('__FEATURED_JSON__');
    expect(html).toContain('var FEATURED = [];');
  });

  test('injects featured instances as JSON', () => {
    const html = buildSetupUiHtml([
      { hostname: 'fake-mychart.fanpierlabs.com', name: 'Springfield General Hospital (test)', logoUrl: '' },
    ]);
    expect(html).not.toContain('__FEATURED_JSON__');
    expect(html).toContain('fake-mychart.fanpierlabs.com');
    expect(html).toContain('Springfield General Hospital (test)');
    // The injected literal must be valid embedded JSON.
    const match = html.match(/var FEATURED = (\[.*?\]);/s);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed[0].hostname).toBe('fake-mychart.fanpierlabs.com');
  });

  test('does not let "$" sequences in data corrupt the injection', () => {
    const html = buildSetupUiHtml([
      { hostname: 'h.example', name: 'Cost $5 & $$ Clinic', logoUrl: '' },
    ]);
    const match = html.match(/var FEATURED = (\[.*?\]);/s);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed[0].name).toBe('Cost $5 & $$ Clinic');
  });
});
