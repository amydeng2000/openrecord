# mychart-connector

Programmatic access to Epic MyChart patient portals from Node.js. Log in, fetch
every section of a patient's chart, and act on it (request refills, send
messages, manage emergency contacts) — all running locally in your process.

This is the same scraper engine that powers
[openrecord.fanpierlabs.com](https://openrecord.fanpierlabs.com), packaged for
you to embed in your own integration.

## Install

```bash
npm install mychart-connector
```

## Quick start

```ts
import { MyChartClient } from 'mychart-connector';

const result = await MyChartClient.connect({
  hostname: 'mychart.example.org',
  user:     'alice',
  pass:     'hunter2',
});

let client;
if (result.state === 'connected') {
  client = result.client;
} else if (result.state === 'need_2fa') {
  // Prompt the user — `result.delivery` describes how MyChart sent the code.
  const code = await promptUser(`Enter the code sent to ${result.delivery?.contact}`);
  client = await result.complete(code);
} else {
  throw new Error(`login failed: ${result.state}`);
}

const profile = await client.getProfile();
const meds    = await client.getMedications();

console.log(profile, meds);

client.close();   // stops the background keepalive timer
```

## Recommended: use a passkey for fully-automated auth

Username + password isn't a great fit for unattended automation: most
MyChart instances enforce 2FA, which means a human has to type a code
every login. **Use a passkey instead.** A passkey is a public/private
keypair MyChart trusts the same way it trusts the 2FA flow — once
registered, your code can log in with no prompts and no 2FA.

The recommended workflow:

**1. One-time setup (interactive, via the CLI).** Log in once with
username + password + 2FA, then ask MyChart to register a new passkey
on the account:

```bash
# In this repo:
bun run cli mychart --host mychart.example.org --set-up-passkey
```

The CLI walks the password + 2FA flow once, registers a new passkey
(via the same WebAuthn dance the official MyChart app uses), and writes
the credential to disk. Copy that file somewhere your automation can
read — it's the only thing you'll need from now on.

**2. All future runs (no human in the loop).** Load the saved
credential and call `connectWithPasskey`:

```ts
import {
  MyChartClient,
  deserializeCredential,
  serializeCredential,
} from 'mychart-connector';
import * as fs from 'node:fs/promises';

const credential = deserializeCredential(
  await fs.readFile('./passkey.json', 'utf8'),
);

const result = await MyChartClient.connectWithPasskey({
  hostname: 'mychart.example.org',
  credential,
});
if (result.state !== 'connected') throw new Error('passkey login failed');
const client = result.client;

// IMPORTANT: passkeys mutate on use — see below.
await fs.writeFile('./passkey.json', serializeCredential(credential));

const meds = await client.getMedications();
client.close();
```

> [!IMPORTANT]
> **The passkey is not a static key — its `signCount` increments every
> time you log in.** WebAuthn requires the counter to monotonically
> increase across logins; if you replay the *same* credential bytes
> twice, MyChart will reject the second attempt as a possible cloned
> authenticator. After every successful `connectWithPasskey` call you
> **must** re-serialize the credential and overwrite the file on disk.
> The example above does exactly this.
>
> Concretely: load → use → re-save. Don't bake the passkey into a Docker
> image, a `process.env`, or anything else immutable. Treat it like a
> rotating session token that you persist back after every use.

**Other passkey tools** (also exported from the package, take
`client.request` as the first argument):

```ts
import { setupPasskey, listPasskeys, deletePasskey } from 'mychart-connector';

const credential = await setupPasskey(client.request);   // register a new one programmatically
const list       = await listPasskeys(client.request);   // audit what's on the account
await deletePasskey(client.request, rawId);              // revoke one
```

## What you get

- **One method per scraper.** `client.getProfile()`, `client.getMedications()`,
  `client.getAllergies()`, `client.getImagingResults()`, `client.sendMessage()`,
  `client.requestMedicationRefill()`, and ~40 more — see the table below.
- **Auto keepalive.** The client pings MyChart's `/Home/KeepAlive` and
  `/keepalive.asp` every 30 seconds (matching the official client) so the
  session doesn't time out under your feet. Pass `keepalive: false` to opt out.
- **TOTP and passkey logins.** `MyChartClient.totpCode(secret)`,
  `MyChartClient.connectWithPasskey({ credential })`,
  `pending.complete(code, { isTOTP: true })`.
- **Persisted sessions.** `client.serialize()` returns JSON; restore with
  `MyChartClient.fromSerialized(json)` — no re-login.
- **Raw scraper functions also exported**, for power users who want to drive
  the underlying `MyChartRequest` themselves.
- **TypeScript-first.** Full `.d.ts` declarations.

## API

### Construction

| Method | Description |
| --- | --- |
| `MyChartClient.connect({ hostname, user, pass, keepalive?, protocol?, fetchFn?, skipSendCode? })` | Username/password login. May return `{ state: 'need_2fa', complete }`. |
| `MyChartClient.connectWithPasskey({ hostname, credential, ... })` | Passkey login (bypasses 2FA). |
| `MyChartClient.fromSerialized(json, opts?)` | Restore a previously-serialized session. |

### Session

| Method | Description |
| --- | --- |
| `client.serialize()` | Returns a JSON string for persistence. |
| `client.isSessionValid()` | Cheap server-side check that cookies still authenticate. |
| `client.close()` | Stops the keepalive timer. After close, methods throw. |
| `client.request` | The underlying `MyChartRequest`. Public for power users. |

### Data — by domain

| Domain | Methods |
| --- | --- |
| Profile | `getProfile`, `getEmail` |
| Health | `getHealthSummary`, `getVitals`, `getAllergies`, `getHealthIssues`, `getMedicalHistory`, `getImmunizations` |
| Medications | `getMedications`, `requestMedicationRefill(key)` |
| Labs / imaging | `listLabResults`, `getImagingResults`, `downloadImagingStudy(fdiContext, name, outputDir, opts?)` |
| Visits | `upcomingVisits`, `pastVisits(oldestRenderedDate)` |
| Messages | `listConversations`, `getConversationMessages(id)`, `sendMessage(params)`, `sendReply(params)`, `deleteMessage(id)`, `getMessageRecipients(token)`, `getMessageTopics(token)` |
| Bills | `getBillingHistory` |
| Care | `getCareTeam`, `getReferrals`, `getInsurance`, `getDocuments`, `getGoals`, `getCareJourneys`, `getUpcomingOrders`, `getPreventiveCare`, `getEducationMaterials`, `getQuestionnaires`, `getActivityFeed`, `getLetters`, `getLetterDetails(hnoId, csn)` |
| Contacts | `getEmergencyContacts`, `addEmergencyContact(input)`, `updateEmergencyContact(input)`, `removeEmergencyContact(id)` |
| Other | `getLinkedMyChartAccounts`, `getEhiExportTemplates` |

### Raw function-style API

If the class doesn't fit your control flow, every scraper is also exported as a
plain function that takes a `MyChartRequest` as its first argument:

```ts
import { myChartUserPassLogin, getMedications, MyChartRequest } from 'mychart-connector';

const result = await myChartUserPassLogin({ hostname, user, pass });
if (result.state === 'logged_in') {
  const meds = await getMedications(result.mychartRequest);
}
```

## 2FA flow

When `result.state === 'need_2fa'`, MyChart has just sent a code to the user.
Submit it via `result.complete(code)`:

```ts
if (result.state === 'need_2fa') {
  console.log('Code was sent via', result.delivery?.method, 'to', result.delivery?.contact);
  const code = await prompt('6-digit code: ');
  const client = await result.complete(code);
  // ...
}
```

For accounts using an authenticator app (TOTP) instead of SMS/email codes, pass
`{ isTOTP: true }`:

```ts
const code = await MyChartClient.totpCode(userTotpSecret);
const client = await pending.complete(code, { isTOTP: true });
```

## Persisting sessions

```ts
const json = await client.serialize();
await fs.writeFile('session.json', json);

// ...later, in another process
const restored = await MyChartClient.fromSerialized(await fs.readFile('session.json', 'utf8'));
if (await restored.isSessionValid()) {
  const meds = await restored.getMedications();
}
```

## Telemetry

This package sends anonymous usage events (think: Next.js / Vercel CLI
telemetry) so we can see which scrapers are actually exercised in the
wild and prioritize fixes accordingly.

What is collected:

- The event name (e.g. `scraper_login_started`) and the MyChart hostname
  the call targeted (the portal domain — not your machine's hostname).
- OS platform, architecture, OS version, and runtime version (e.g.
  `bun 1.3.9` or `node v22.11.0`).
- A stable random UUID generated once per project install and cached
  at `<your-project>/node_modules/.cache/mychart-connector/anonymous-id`
  (same convention Babel / ESLint / Webpack use). Used purely for
  dedupe. Never written outside `node_modules`. Cleared whenever you
  reinstall.

What is **not** collected: your public IP, OS hostname, OS username,
git config (`user.name` / `user.email`), or any data scraped from your
chart.

To disable telemetry entirely, set:

```bash
export MYCHART_CONNECTOR_TELEMETRY_DISABLED=1
```

## License

This package is distributed under a proprietary source-available license. See
[LICENSE](./LICENSE).
