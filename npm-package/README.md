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

## License

This package is distributed under a proprietary source-available license. See
[LICENSE](./LICENSE).
