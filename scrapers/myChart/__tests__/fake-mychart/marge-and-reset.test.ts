/**
 * Tests for fake-mychart features added alongside the marge user:
 *   - The marge user requires TOTP 2FA at login
 *   - GET /reset serves an HTML page with a reset button
 *   - POST /reset wipes mutable in-memory state (sessions, per-user TOTP)
 *
 * Requires fake-mychart running on FAKE_MYCHART_HOST (default localhost:4000).
 *
 * Run with: bun test scrapers/myChart/__tests__/fake-mychart/marge-and-reset.test.ts
 */

import { describe, it, expect, afterEach } from 'bun:test'
import { myChartUserPassLogin } from '../../login'

const HOST = process.env.FAKE_MYCHART_HOST ?? 'localhost:4000'
const BASE = `http://${HOST}`

async function postReset(): Promise<void> {
  const r = await fetch(`${BASE}/reset`, { method: 'POST' })
  if (!r.ok) throw new Error(`/reset failed: ${r.status}`)
}

function buildLoginInfo(user: string, pass: string): string {
  return JSON.stringify({
    Type: 'PasswordLogin',
    Credentials: {
      Username: Buffer.from(user).toString('base64'),
      Password: Buffer.from(pass).toString('base64'),
    },
  })
}

async function rawDoLogin(user: string, pass: string): Promise<{ status: number; body: string; cookie: string | null }> {
  const r = await fetch(`${BASE}/MyChart/Authentication/Login/DoLogin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'LoginInfo=' + encodeURIComponent(buildLoginInfo(user, pass)),
  })
  return { status: r.status, body: await r.text(), cookie: r.headers.get('set-cookie') }
}

describe('fake-mychart marge user + /reset', () => {
  // Reset state after every test so order doesn't matter and TOTP toggles
  // don't bleed between tests.
  afterEach(postReset)

  it('homer logs in directly without 2FA', async () => {
    const result = await myChartUserPassLogin({
      hostname: HOST,
      user: 'homer',
      pass: 'donuts123',
      protocol: 'http',
    })
    expect(result.state).toBe('logged_in')
  }, 15_000)

  it('marge login requires 2FA (TOTP enabled by default)', async () => {
    const result = await myChartUserPassLogin({
      hostname: HOST,
      user: 'marge',
      pass: 'donuts123',
      protocol: 'http',
    })
    expect(result.state).toBe('need_2fa')
  }, 15_000)

  it('marge login fails with wrong password', async () => {
    const result = await myChartUserPassLogin({
      hostname: HOST,
      user: 'marge',
      pass: 'not-donuts',
      protocol: 'http',
    })
    expect(result.state).toBe('invalid_login')
  }, 15_000)

  it('GET /reset returns the HTML reset page with a button', async () => {
    const r = await fetch(`${BASE}/reset`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type') ?? '').toContain('text/html')
    const body = await r.text()
    expect(body).toContain('Reset Fake MyChart RAM')
    expect(body).toContain('<button')
  })

  it('POST /reset returns ok and re-enables marge TOTP', async () => {
    // Log in as marge to seed a session (and pick up its cookie)
    const loginResp = await rawDoLogin('marge', 'donuts123')
    expect(loginResp.body).toContain('secondaryvalidationcontroller')
    const cookie = loginResp.cookie ?? ''
    const sessionCookie = cookie.split(';')[0] // "MyChartSession=..."

    // Complete 2FA so the session is fully authenticated
    await fetch(`${BASE}/MyChart/Authentication/SecondaryValidation/Validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: sessionCookie,
      },
      body: 'TwoFactorCode=123456',
    })

    // Disable marge's TOTP so we can confirm reset puts it back
    await fetch(`${BASE}/MyChart/api/secondary-validation/UpdateTwoFactorTotpOptInStatus`, {
      method: 'POST',
      headers: { Cookie: sessionCookie },
    })

    // With TOTP off, marge logs in directly
    const beforeReset = await rawDoLogin('marge', 'donuts123')
    expect(beforeReset.body).toContain('md_home_index')

    // Reset and verify marge requires 2FA again
    const resetResp = await fetch(`${BASE}/reset`, { method: 'POST' })
    expect(resetResp.status).toBe(200)
    expect(await resetResp.json()).toEqual({ ok: true })

    const afterReset = await rawDoLogin('marge', 'donuts123')
    expect(afterReset.body).toContain('secondaryvalidationcontroller')
  }, 30_000)
})
