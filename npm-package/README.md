# mychart-connector

Programmatic access to Epic MyChart patient portals from Node.js. Log in,
fetch every section of a patient's chart, and act on it (request refills,
send messages, manage emergency contacts) — all running locally in your
process.

This is the same scraper engine that powers
[openrecord.fanpierlabs.com](https://openrecord.fanpierlabs.com), packaged
for you to embed in your own integration.

## Install

```bash
npm install mychart-connector
```

The package installs a CLI binary at `node_modules/.bin/mychart-connector`
(use it via `npx mychart-connector …`). You only run the CLI once, to set
up a passkey — see Quick start.

## Quick start

The recommended setup flow is **one-shot interactive**: register a
passkey via the CLI, save it, and from then on log in from code with no
prompts.

### 1. Register a passkey

Run the bundled CLI once:

```bash
npx mychart-connector --set-up-passkey --host mychart.example.org
```

The CLI walks you through username + password + 2FA, registers a new
passkey on your MyChart account (the same WebAuthn flow the official
MyChart app uses), and writes the credential to:

```
./.passkey-credentials/mychart.example.org.json
```

### 2. Add the credentials directory to `.gitignore`

```
echo '.passkey-credentials/' >> .gitignore
```

The file contains a private key — never commit it.

### 3. Use the passkey from your code

```ts
import {
  MyChartClient,
  deserializeCredential,
  serializeCredential,
} from 'mychart-connector';
import * as fs from 'node:fs/promises';

const path = './.passkey-credentials/mychart.example.org.json';
const credential = deserializeCredential(await fs.readFile(path, 'utf8'));

const result = await MyChartClient.connectWithPasskey({
  hostname: 'mychart.example.org',
  credential,
});
if (result.state !== 'connected') throw new Error('passkey login failed');
const client = result.client;

const meds = await client.getMedications();
console.log(meds);

client.close();

// IMPORTANT — see Authentication section below.
await fs.writeFile(path, serializeCredential(credential));
```

That's it. No more 2FA codes, no more prompts. Re-run the CLI's
`--set-up-passkey` only if you want to register a new passkey (e.g.
because you cleared the stored one).

## Authentication

Passkey-based login is the **recommended** auth flow for this package
because it's the only one that runs end-to-end without a human typing
in a 2FA code on every login. After the one-shot CLI setup above,
`MyChartClient.connectWithPasskey` is non-interactive and bypasses 2FA.

### `signCount` — must be persisted after every login

> [!IMPORTANT]
> A passkey credential is **not a static key**. Its `signCount` increments
> every time you log in. WebAuthn requires the counter to monotonically
> increase across logins; if you replay the *same* credential bytes twice,
> MyChart will reject the second attempt as a possible cloned authenticator.
>
> After every successful `connectWithPasskey` call you **must** re-serialize
> the credential and overwrite the file on disk. The Quick-start example
> above does exactly this.
>
> Concretely: load → use → re-save. Don't bake the passkey into a Docker
> image, a `process.env`, or anything else immutable. Treat it like a
> rotating session token that you persist back after every use.

### Other auth options

If a passkey doesn't fit your use case, the package also exposes:

- **Username + password + 2FA** — `MyChartClient.connect({ hostname, user, pass })`.
  Returns `{ state: 'connected', client }` for instances without 2FA, or
  `{ state: 'need_2fa', complete, delivery, sentAt }` when MyChart sent a
  code. Call `await pending.complete(code)` to finish.
- **TOTP** — if the user has an authenticator app set up, derive the code
  with `MyChartClient.totpCode(secret)` and pass `{ isTOTP: true }` to
  `pending.complete`.
- **Restored sessions** — `MyChartClient.fromSerialized(json)` rehydrates
  a previously-`serialize()`d session without re-logging-in. Handy when
  you want to dispatch from a queue and don't want to keep re-authing.

All of these still ultimately depend on either a human typing a code or
a saved TOTP secret, so prefer passkeys for unattended automation.

## CLI reference

```
npx mychart-connector --host <hostname> [flags]
```

| Flag | Purpose |
| --- | --- |
| `--host <hostname>` | MyChart instance hostname. Required. |
| `--user <username>` | Skip the username prompt. |
| `--pass <password>` | Skip the password prompt. |
| `--2fa <code>` | Skip the 2FA prompt; use this code directly. |
| `--set-up-passkey` | Register a new passkey on the account, save it under `./.passkey-credentials/<host>.json`. **Run this once.** |
| `--use-passkey` | Log in with a previously-saved passkey instead of password+2FA. |
| `--list-passkeys` | After login, print all passkeys registered on the account. |
| `--delete-passkey` | Interactively delete a passkey by `rawId`. |
| `--set-up-totp` | Register a TOTP authenticator on the account, save the secret to `./.totp-secrets/<host>.txt`. |
| `--use-saved-totp` | Use the saved TOTP secret to derive 2FA codes (no prompt). |
| `--disable-totp` | Disable TOTP on the account. |
| `--no-cache` | Don't reuse cached cookies; force a fresh login. |
| `--action <name>` | Run a one-shot action: `send-message`, `send-reply`, `get-imaging`. |
| `--resend-2fa` | Pull the 2FA code from a Resend mailbox (Fan Pier Labs internal — requires `resend` and `@aws-sdk/client-secrets-manager` to be installed). |

The default invocation (no flags besides `--host`) logs in interactively
and dumps every scrape category to stdout. Useful as a smoke test.

The CLI stores credentials under `./.passkey-credentials/` and
`./.totp-secrets/` (both relative to the cwd). Override either with
`MYCHART_PASSKEY_DIR=/abs/path` or `MYCHART_TOTP_DIR=/abs/path`.

## API reference

All shapes are TypeScript-first; importing from `mychart-connector` gives
you full `.d.ts` autocomplete. The reference below is grouped by domain.

### `MyChartClient` — high-level wrapper

The class owns a session, runs an auto-keepalive ping every 30s
(matching the official MyChart client), and exposes one method per
scraper. Construct it via one of three factories.

#### Construction

```ts
class MyChartClient {
  static connect(args: ConnectArgs): Promise<ConnectResult>;
  static connectWithPasskey(args: MyChartClientOptions & { credential: PasskeyCredential }): Promise<ConnectResult>;
  static fromSerialized(json: string, opts?: { fetchFn?, keepalive?: boolean }): Promise<MyChartClient | null>;
  static totpCode(secret: string): Promise<string>;
}

interface MyChartClientOptions {
  hostname: string;
  protocol?: 'http' | 'https';                                    // default: 'https' (auto-'http' for hosts without a dot)
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  keepalive?: boolean;                                            // default: true
}

interface ConnectArgs extends MyChartClientOptions {
  user: string;
  pass: string;
  skipSendCode?: boolean;
}

type ConnectResult =
  | { state: 'connected'; client: MyChartClient }
  | { state: 'need_2fa'; delivery?: TwoFaDeliveryInfo; sentAt?: number; complete(code: string, opts?: { isTOTP?: boolean }): Promise<MyChartClient> }
  | { state: 'invalid_login' | 'error'; error?: string };
```

#### Session

| Method | Returns | Notes |
| --- | --- | --- |
| `client.serialize()` | `Promise<string>` | JSON blob — pair with `MyChartClient.fromSerialized(json)`. |
| `client.isSessionValid()` | `Promise<boolean>` | Cheap server-side check (fires `/Home/KeepAlive`). |
| `client.close()` | `void` | Stops the keepalive timer. After close, methods throw. Idempotent. |
| `client.request` | `MyChartRequest` | The underlying request object. Public for power users. |

#### Profile / contact

| Method | Returns |
| --- | --- |
| `client.getProfile()` | `Promise<ProfileData \| null>` — `{ name, dob, mrn, pcp, email? }` |
| `client.getEmail()` | `Promise<string \| null>` — secure email on file |

#### Health summary

| Method | Returns |
| --- | --- |
| `client.getHealthSummary()` | `Promise<HealthSummary>` — flowsheets + summary tables |
| `client.getVitals()` | `Promise<Flowsheet[]>` — height, weight, BP, etc. (latest readings + history) |
| `client.getAllergies()` | `Promise<AllergiesResult>` — `{ allergies: Allergy[], lastUpdated, ... }` |
| `client.getHealthIssues()` | `Promise<HealthIssue[]>` — current diagnoses |
| `client.getMedicalHistory()` | `Promise<MedicalHistoryResult>` — surgeries + family history + diagnoses |
| `client.getImmunizations()` | `Promise<Immunization[]>` |

#### Medications

| Method | Returns |
| --- | --- |
| `client.getMedications()` | `Promise<MedicationsResult>` — `{ medications: Medication[], pharmacies: Pharmacy[] }` |
| `client.requestMedicationRefill(medicationKey)` | `Promise<RefillRequestResult>` — `medicationKey` from `Medication.key` |

#### Labs / imaging

| Method | Returns |
| --- | --- |
| `client.listLabResults()` | `Promise<LabTestResultWithHistory[]>` — every lab test result + historical components |
| `client.getImagingResults({ followSaml? })` | `Promise<ImagingResult[]>` — imaging studies. With `followSaml: true` resolves the eUnity SAML chain to populate `fdiContext`. |
| `client.downloadImagingStudy(fdiContext, studyName, outputDir, opts?)` | `Promise<DirectDownloadResult>` — downloads CLO image bytes via eUnity. Pass `{ skipFileWrite: true }` to keep results in-memory. |

The CLO bytes returned by `downloadImagingStudy` can be turned into JPEGs
via the **CLO image conversion** functions below.

#### CLO image conversion

```ts
import { convertCloToJpg, convertCloToBitmap16 } from 'mychart-connector';
```

| Function | Signature |
| --- | --- |
| `convertCloToJpg({ pixelData, wrapperData?, outputPath? })` | `Promise<Buffer \| string>` — high-level. Returns JPEG bytes; if `outputPath` ends in `.webp`, returns WebP. |
| `convertCloToBitmap(pixelInput, wrapperInput?)` | `Bitmap` — 8-bit raw pixels (1 channel). |
| `convertCloToBitmap16(pixelInput, wrapperInput?)` | `Bitmap16` — 16-bit raw pixels with VOI LUT applied. |
| `convertBitmap16ToJpg(b, opts?, outputPath?)` | `Promise<Buffer>` — JPEG. |
| `convertBitmap16ToPng(b, opts?, outputPath?)` | `Promise<Buffer>` — PNG (16-bit grayscale supported). |
| `convertBitmap16ToAvif(b, opts?, outputPath?)` | `Promise<Buffer>` — AVIF (8-bit only with prebuilt sharp). |
| `convertBitmap16ToTiff(b, opts?, outputPath?)` | `Promise<Buffer>` — TIFF. |
| `convertBitmap16ToWebp(b, outputPath?)` | `Promise<Buffer>` — lossless WebP. |
| `convertBitmapToJpg(b, outputPath?)` | `Promise<Buffer>` — 8-bit Bitmap → JPEG (legacy compat). |
| `convertBitmapToWebp(b, outputPath?)` | `Promise<Buffer>` — 8-bit Bitmap → lossless WebP. |
| `parseWrapper(input)` | `CloMetadata` — DICOM-ish metadata embedded in the wrapper file. |
| `applyVoiLut(img16, h, w, metadata)` | `Uint16Array` — apply VOI LUT / window-level for medical-grade rendering. |
| `to8bit(img, invert)` | `Uint8Array` — clip 16-bit to 8-bit. |
| `to16bit(img, invert)` | `Uint16Array` — re-pack 16-bit. |

#### Visits

| Method | Returns |
| --- | --- |
| `client.upcomingVisits()` | `Promise<VisitListContainer \| { visits: never[]; error: string }>` |
| `client.pastVisits(oldestRenderedDate: Date)` | `Promise<PastVisitsContainer \| { visits: never[]; error: string }>` |

#### Messages

| Method | Returns |
| --- | --- |
| `client.listConversations()` | `Promise<ConversationListResponse \| null>` |
| `client.getConversationMessages(conversationId)` | `Promise<ConversationThread>` |
| `client.sendMessage(params: SendNewMessageParams)` | `Promise<SendNewMessageResult>` |
| `client.sendReply(params: SendReplyParams)` | `Promise<SendReplyResult>` |
| `client.deleteMessage(conversationId)` | `Promise<DeleteMessageResult>` |
| `client.getMessageRecipients(token)` | `Promise<MessageRecipient[]>` — `token` from `getVerificationToken(req)`. |
| `client.getMessageTopics(token)` | `Promise<MessageTopic[]>` |

`SendNewMessageParams` shape:

```ts
{
  recipientId: string;       // from getMessageRecipients
  topicId: string;           // from getMessageTopics
  subject: string;
  body: string;
  organizationId?: string;
}
```

#### Bills

| Method | Returns |
| --- | --- |
| `client.getBillingHistory()` | `Promise<BillingAccount[]>` — every billing account + statements/payments |

#### Care coordination

| Method | Returns |
| --- | --- |
| `client.getCareTeam()` | `Promise<CareTeamMember[]>` |
| `client.getReferrals()` | `Promise<Referral[]>` |
| `client.getInsurance()` | `Promise<InsuranceResult>` — `{ coverages: InsuranceCoverage[], lastUpdated }` |
| `client.getDocuments()` | `Promise<Document[]>` |
| `client.getGoals()` | `Promise<GoalsResult>` |
| `client.getCareJourneys()` | `Promise<CareJourney[]>` |
| `client.getUpcomingOrders()` | `Promise<UpcomingOrder[]>` |
| `client.getPreventiveCare()` | `Promise<PreventiveCareItem[]>` |
| `client.getEducationMaterials()` | `Promise<EducationMaterial[]>` |
| `client.getQuestionnaires()` | `Promise<Questionnaire[]>` |
| `client.getActivityFeed()` | `Promise<ActivityFeedItem[]>` |
| `client.getLetters()` | `Promise<Letter[]>` |
| `client.getLetterDetails(hnoId, csn)` | `Promise<LetterDetailsResponse>` |

#### Emergency contacts

| Method | Returns |
| --- | --- |
| `client.getEmergencyContacts()` | `Promise<EmergencyContact[]>` |
| `client.addEmergencyContact(input: EmergencyContactInput)` | `Promise<EmergencyContactResult>` |
| `client.updateEmergencyContact(input: EmergencyContactUpdateInput)` | `Promise<EmergencyContactResult>` |
| `client.removeEmergencyContact(id)` | `Promise<EmergencyContactResult>` |

#### Other accounts / EHI export

| Method | Returns |
| --- | --- |
| `client.getLinkedMyChartAccounts()` | `Promise<LinkedMyChart[]>` — accounts at other MyChart instances linked to this one |
| `client.getEhiExportTemplates()` | `Promise<EhiTemplate[]>` |

### Lower-level: passkey lifecycle

Most users only need `connectWithPasskey`. If you want to manage passkeys
programmatically (audit, revoke, register without the CLI), use these
raw functions, which take a logged-in `MyChartRequest` as their first
argument:

```ts
import {
  setupPasskey,        // (req) => Promise<PasskeyCredential | null>   — register a new passkey on the account
  listPasskeys,        // (req) => Promise<unknown[] | null>           — audit what's currently registered
  deletePasskey,       // (req, rawId: string) => Promise<boolean>     — revoke one by rawId
  serializeCredential, // (cred) => string                             — JSON-serialize for persistence
  deserializeCredential, // (json) => PasskeyCredential
} from 'mychart-connector';

// `req` comes from any successful login — e.g. `client.request` or the
// `mychartRequest` field on a `LoginResult`.
const cred = await setupPasskey(client.request);
await fs.writeFile('passkey.json', serializeCredential(cred!));
```

### Lower-level: TOTP lifecycle

```ts
import {
  setupTotp,        // (req, password: string) => Promise<SetupTotpResult>     — enroll, returns secret + QR + backup codes
  disableTotp,      // (req, password: string, totpSecret: string) => Promise<boolean>
  generateTotpCode, // (secret: string, timestamp?: number) => Promise<string> — derive a 6-digit code locally
  parseTotpUri,     // (uri) => { secret, issuer, account }
} from 'mychart-connector';
```

### Lower-level: raw scraper functions

If the class doesn't fit your control flow, every scraper is also
exported as a plain function whose first argument is a `MyChartRequest`:

```ts
import {
  myChartUserPassLogin,
  myChartPasskeyLogin,
  complete2faFlow,
  areCookiesValid,
  parse2faDeliveryMethods,
  getMyChartProfile, getEmail, getHealthSummary, getVitals,
  getMedications, requestMedicationRefill,
  getAllergies, getHealthIssues, getMedicalHistory, getImmunizations,
  listLabResults, getImagingResults, downloadImagingStudyDirect,
  upcomingVisits, pastVisits,
  listConversations, getConversationMessages,
  sendNewMessage, sendReply, deleteMessage,
  getMessageRecipients, getMessageTopics, getVerificationToken,
  getBillingHistory,
  getCareTeam, getReferrals, getInsurance, getDocuments,
  getGoals, getCareJourneys, getUpcomingOrders, getPreventiveCare,
  getEducationMaterials, getQuestionnaires, getActivityFeed,
  getLetters, getLetterDetails,
  getEmergencyContacts, addEmergencyContact, updateEmergencyContact, removeEmergencyContact,
  getLinkedMyChartAccounts, getEhiExportTemplates,
  MyChartRequest,
} from 'mychart-connector';

const result = await myChartUserPassLogin({ hostname, user, pass });
if (result.state === 'logged_in') {
  const meds = await getMedications(result.mychartRequest);
}
```

Login result shape:

```ts
type LoginResult = {
  state: 'logged_in' | 'need_2fa' | 'invalid_login' | 'error';
  error?: string;
  mychartRequest: MyChartRequest;
  twoFaSentTime?: number;
  twoFaDelivery?: { method: 'email' | 'sms'; contact?: string };
};
```

`complete2faFlow({ mychartRequest, code, isTOTP? })` finishes the 2FA
step and returns `{ state: 'logged_in' | 'invalid_2fa' | 'error', mychartRequest }`.

## Persisting sessions

Cookie-based sessions are short-lived (MyChart times them out after
~15 min of idle), but you can still skip a re-login between processes
by serializing the active session and rehydrating it later:

```ts
const json = await client.serialize();
await fs.writeFile('session.json', json);

// ...later, in another process
const restored = await MyChartClient.fromSerialized(await fs.readFile('session.json', 'utf8'));
if (await restored.isSessionValid()) {
  const meds = await restored.getMedications();
}
```

For longer-lived persistence (across sleep, across days), prefer the
passkey flow — re-running `connectWithPasskey` is fast and the
credential survives indefinitely as long as you re-save the mutated
copy after each login.

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
