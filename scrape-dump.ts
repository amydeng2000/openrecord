/**
 * scrape-dump.ts — logs into a real MyChart portal ONCE, calls every category
 * scraper, and writes full raw JSON per category to $OUT_DIR (outside the repo).
 *
 * Credentials come from .env (bun auto-loads it):
 *   username="..."      MyChart username
 *   pw="..."            MyChart password
 *   host="..."          MyChart hostname (e.g. mychart.example.org)  [or $MYCHART_HOST]
 *
 * 2FA: on first login MyChart emails/texts a code. This script waits for the
 * code to appear in $TWOFA_CODE_FILE, then completes the flow. The session is
 * cached to .cookie-cache/<host>.json so later runs skip login + 2FA entirely.
 *
 * NOTHING here is committed; output is PHI and lives outside the repo.
 */
import * as fs from 'fs';
import * as path from 'path';
import { myChartUserPassLogin, complete2faFlow, areCookiesValid } from './scrapers/myChart/login';
import { MyChartRequest } from './scrapers/myChart/myChartRequest';

import { getMyChartProfile, getEmail } from './scrapers/myChart/profile';
import { getHealthSummary } from './scrapers/myChart/healthSummary';
import { getMedications } from './scrapers/myChart/medications';
import { getAllergies } from './scrapers/myChart/allergies';
import { getHealthIssues } from './scrapers/myChart/healthIssues';
import { getImmunizations } from './scrapers/myChart/immunizations';
import { getMedicalHistory } from './scrapers/myChart/medicalHistory';
import { getVitals } from './scrapers/myChart/vitals';
import { getCareTeam } from './scrapers/myChart/careTeam';
import { getPreventiveCare } from './scrapers/myChart/preventiveCare';
import { getInsurance } from './scrapers/myChart/insurance';
import { getReferrals } from './scrapers/myChart/referrals';
import { getLetters } from './scrapers/myChart/letters';
import { getDocuments } from './scrapers/myChart/documents';
import { getGoals } from './scrapers/myChart/goals';
import { getUpcomingOrders } from './scrapers/myChart/upcomingOrders';
import { getQuestionnaires } from './scrapers/myChart/questionnaires';
import { getCareJourneys } from './scrapers/myChart/careJourneys';
import { getActivityFeed } from './scrapers/myChart/activityFeed';
import { getEducationMaterials } from './scrapers/myChart/educationMaterials';
import { getEhiExportTemplates } from './scrapers/myChart/ehiExport';
import { getEmergencyContacts } from './scrapers/myChart/emergencyContacts';
import { getLinkedMyChartAccounts } from './scrapers/myChart/other_mycharts/other_mycharts';
import { upcomingVisits, pastVisits } from './scrapers/myChart/visits/visits';
import { listLabResults, getImagingResults } from './scrapers/myChart/labs_and_procedure_results/labResults';
import { listConversations } from './scrapers/myChart/messages/conversations';
import { getBillingHistory } from './scrapers/myChart/bills/bills';

const HOST = process.env.host || process.env.MYCHART_HOST || '';
const USER = process.env.username || '';
const PASS = process.env.pw || '';
const OUT_DIR = process.env.OUT_DIR || path.join(process.cwd(), 'scrape-output');
const CACHE_DIR = path.join(process.cwd(), '.cookie-cache');
const CODE_FILE = process.env.TWOFA_CODE_FILE || path.join(process.cwd(), '.2fa-code');
const CODE_WAIT_SEC = Number(process.env.TWOFA_WAIT_SEC || 300);
// Optional allowlist of category names to scrape (comma-separated); empty = all.
const ONLY = (process.env.SCRAPE_ONLY || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!HOST || !USER || !PASS) {
  console.error('Missing host/username/pw. Set them in .env (host, username, pw).');
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadCachedSession(): Promise<MyChartRequest | null> {
  const p = path.join(CACHE_DIR, `${HOST}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const req = await MyChartRequest.unserialize(fs.readFileSync(p, 'utf8'));
    if (req && (await areCookiesValid(req))) {
      console.log('  Using cached session (skipping login + 2FA).');
      return req;
    }
  } catch { /* fall through to fresh login */ }
  return null;
}

async function saveSession(req: MyChartRequest) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${HOST}.json`), await req.serialize());
}

async function waitForCode(): Promise<string> {
  if (fs.existsSync(CODE_FILE)) fs.unlinkSync(CODE_FILE);
  console.log(`\n  >>> Waiting up to ${CODE_WAIT_SEC}s for your 2FA code.`);
  console.log(`  >>> (paste the code to the assistant, or: echo 123456 > ${CODE_FILE})\n`);
  const deadline = Date.now() + CODE_WAIT_SEC * 1000;
  while (Date.now() < deadline) {
    if (fs.existsSync(CODE_FILE)) {
      const code = fs.readFileSync(CODE_FILE, 'utf8').trim();
      if (code) { fs.unlinkSync(CODE_FILE); return code; }
    }
    await sleep(2500);
  }
  throw new Error('Timed out waiting for 2FA code.');
}

async function login(): Promise<MyChartRequest> {
  const cached = await loadCachedSession();
  if (cached) return cached;

  console.log(`  Logging into ${HOST} as ${USER} ...`);
  const res = await myChartUserPassLogin({ hostname: HOST, user: USER, pass: PASS });
  if (res.state === 'invalid_login') throw new Error('Invalid username or password.');
  if (res.state === 'error') throw new Error(`Login error: ${(res as any).error}`);

  let req = res.mychartRequest;
  if (res.state === 'need_2fa') {
    const d = (res as any).twoFaDelivery;
    if (d) console.log(`  2FA code sent via ${d.method}${d.contact ? ` to ${d.contact}` : ''}`);
    const code = await waitForCode();
    const tfa = await complete2faFlow({ mychartRequest: req, twofaCodeArray: [{ code, score: 1 }] });
    if (tfa.state === 'invalid_2fa') throw new Error('Invalid 2FA code.');
    console.log('  2FA complete.');
  }
  await saveSession(req);
  console.log('  Logged in; session cached.');
  return req;
}

type Task = { name: string; run: (r: MyChartRequest) => Promise<unknown> };

const TASKS: Task[] = [
  { name: 'profile',            run: (r) => getMyChartProfile(r) },
  { name: 'email',              run: (r) => getEmail(r) },
  { name: 'health_summary',     run: (r) => getHealthSummary(r) },
  { name: 'medications',        run: (r) => getMedications(r) },
  { name: 'allergies',          run: (r) => getAllergies(r) },
  { name: 'health_issues',      run: (r) => getHealthIssues(r) },
  { name: 'immunizations',      run: (r) => getImmunizations(r) },
  { name: 'medical_history',    run: (r) => getMedicalHistory(r) },
  { name: 'vitals',             run: (r) => getVitals(r) },
  { name: 'care_team',          run: (r) => getCareTeam(r) },
  { name: 'preventive_care',    run: (r) => getPreventiveCare(r) },
  { name: 'insurance',          run: (r) => getInsurance(r) },
  { name: 'referrals',          run: (r) => getReferrals(r) },
  { name: 'letters',            run: (r) => getLetters(r) },
  { name: 'documents',          run: (r) => getDocuments(r) },
  { name: 'goals',              run: (r) => getGoals(r) },
  { name: 'upcoming_orders',    run: (r) => getUpcomingOrders(r) },
  { name: 'questionnaires',     run: (r) => getQuestionnaires(r) },
  { name: 'care_journeys',      run: (r) => getCareJourneys(r) },
  { name: 'activity_feed',      run: (r) => getActivityFeed(r) },
  { name: 'education_materials',run: (r) => getEducationMaterials(r) },
  { name: 'ehi_export',         run: (r) => getEhiExportTemplates(r) },
  { name: 'emergency_contacts', run: (r) => getEmergencyContacts(r) },
  { name: 'linked_accounts',    run: (r) => getLinkedMyChartAccounts(r) },
  { name: 'upcoming_visits',    run: (r) => upcomingVisits(r) },
  { name: 'past_visits',        run: (r) => { const d = new Date(); d.setFullYear(d.getFullYear() - 2); return pastVisits(r, d); } },
  { name: 'lab_results',        run: (r) => listLabResults(r) },
  { name: 'imaging_results',    run: (r) => getImagingResults(r) },
  { name: 'messages',           run: (r) => listConversations(r) },
  { name: 'billing',            run: (r) => getBillingHistory(r) },
];

function describe(v: unknown): string {
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (v && typeof v === 'object') return `object{${Object.keys(v as object).slice(0, 10).join(', ')}}`;
  if (v === null || v === undefined) return 'empty';
  return typeof v;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Apply the optional SCRAPE_ONLY allowlist, warning about any unknown names.
  let tasks = TASKS;
  if (ONLY.length) {
    const known = new Set(TASKS.map((t) => t.name));
    const unknown = ONLY.filter((n) => !known.has(n));
    if (unknown.length) {
      console.warn(`  ! Ignoring unknown categories: ${unknown.join(', ')}`);
    }
    tasks = TASKS.filter((t) => ONLY.includes(t.name));
    if (!tasks.length) {
      console.error(`  ✗ SCRAPE_ONLY matched no categories. Known: ${TASKS.map((t) => t.name).join(', ')}`);
      process.exit(1);
    }
  }

  const req = await login();

  console.log(`\n  Scraping ${tasks.length} categories → ${OUT_DIR}\n`);
  const summary: { category: string; status: string; shape: string; count: number | null }[] = [];

  for (const t of tasks) {
    try {
      const data = await t.run(req);
      fs.writeFileSync(path.join(OUT_DIR, `${t.name}.json`), JSON.stringify(data, null, 2));
      const count = Array.isArray(data) ? data.length : null;
      summary.push({ category: t.name, status: 'ok', shape: describe(data), count });
      console.log(`  ✓ ${t.name.padEnd(22)} ${describe(data)}`);
    } catch (err) {
      summary.push({ category: t.name, status: 'error', shape: (err as Error).message, count: null });
      console.log(`  ✗ ${t.name.padEnd(22)} ERROR: ${(err as Error).message}`);
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, '_summary.json'), JSON.stringify(summary, null, 2));
  const ok = summary.filter((s) => s.status === 'ok').length;
  console.log(`\n  Done. ${ok}/${tasks.length} categories succeeded. Raw JSON in ${OUT_DIR}`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
