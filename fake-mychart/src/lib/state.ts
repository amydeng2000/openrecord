// Centralized in-memory mutable state for fake-mychart.
//
// All runtime mutations (sessions, per-user TOTP/passkey config, conversations,
// emergency contacts, booked appointments) live here. resetState() restores
// every field to its starting value, which the /reset endpoint uses to wipe
// the server back to a clean slate without restarting the process.

import * as homer from '@/data/homer';
import { resetSessions } from './session';

export type Passkey = {
  rawId: string;
  name: string;
  createdOnDevice: string;
  creationInstant: string;
  lastUsedInstant: string | null;
  // Highest WebAuthn signature counter the server has accepted for this
  // credential. Real MyChart (like any WebAuthn RP) requires each assertion's
  // counter to be strictly greater than this; we mirror that to catch
  // client/server counter desync. 0 = no assertion accepted yet.
  signCount: number;
};

export type FakeUserProfile = {
  name: string;
  dob: string;
  mrn: string;
  pcp: string;
};

export type FakeUser = {
  username: string;
  password: string;
  displayName: string;
  // Contact info used by the account-recovery flow (one-time code destination
  // + username lookup) and by self-signup duplicate-email detection. Optional
  // so callers that build ad-hoc users keep compiling, but the seeds set them.
  email?: string;
  mobilePhone?: string;
  // Profile data rendered on /Home and parsed by the profile scraper.
  // Each user gets a distinct name/dob/mrn so integration tests can verify
  // which session was actually hit when multiple accounts share a hostname.
  profile: FakeUserProfile;
  // Whether the login flow itself demands the 2FA step. Seeded per user and
  // never mutated by the TOTP toggle endpoint — that endpoint only flips the
  // UI-visible totpEnabled flag, matching the prior fake-mychart behavior so
  // the CLI's --set-up-totp / --disable-totp round-trip can keep using
  // username+password without juggling a 2FA code.
  requires2faAtLogin: boolean;
  // What the settings UI and getTwoFactorInfo report. Mutable via the toggle
  // endpoint. Independent of requires2faAtLogin.
  totpEnabled: boolean;
  passkeys: Passkey[];
};

function seedUsers(): Record<string, FakeUser> {
  return {
    homer: {
      username: 'homer',
      password: 'donuts123',
      displayName: 'Homer Jay Simpson',
      email: 'homer@springfield.net',
      mobilePhone: '555-555-7890',
      profile: {
        name: homer.profile.name,
        dob: homer.profile.dob,
        mrn: homer.profile.mrn,
        pcp: homer.profile.pcp,
      },
      requires2faAtLogin: false,
      totpEnabled: false,
      passkeys: [],
    },
    marge: {
      username: 'marge',
      password: 'donuts123',
      displayName: 'Marge Simpson',
      email: 'marge@springfield.net',
      mobilePhone: '555-555-7204',
      profile: {
        name: 'Marge Bouvier Simpson',
        dob: '03/19/1956',
        mrn: '743',
        pcp: 'Dr. Julius Hibbert, MD',
      },
      requires2faAtLogin: true,
      totpEnabled: true,
      passkeys: [],
    },
  };
}

// A signup in progress: the demographics (self-signup) or pre-matched identity
// (activation code) are captured, a one-time contact code has been "sent", and
// the flow is waiting on contact verification + a chosen username/password.
export type PendingSignup = {
  email: string;
  mobilePhone?: string;
  displayName: string;
  // The fixed one-time code we "sent" (always TEST_OTP_CODE here; real MyChart
  // emails/texts a random code). Verified before the account can be created.
  contactCode: string;
  contactVerified: boolean;
};

// A recovery in progress: the contact is known, a code has been "sent", and the
// resolved username is held until the code is verified (then revealed).
export type PendingRecovery = {
  contactInfo: string;
  username: string;
  code: string;
  codeVerified: boolean;
};

// The fixed one-time code the fake "sends" for signup contact verification and
// account recovery, mirroring the fixed 2FA code (123456) the login flow uses.
export const TEST_OTP_CODE = '123456';

type State = {
  users: Record<string, FakeUser>;
  conversations: typeof homer.conversations;
  emergencyContacts: typeof homer.emergencyContacts;
  ecIdCounter: number;
  composeIdCounter: number;
  passkeyIdCounter: number;
  // Pre-auth onboarding flows (keyed by opaque token handed back to the client).
  pendingSignups: Record<string, PendingSignup>;
  pendingRecoveries: Record<string, PendingRecovery>;
  // Valid activation codes (enrollment-letter / AVS codes) → seeded identity.
  activationCodes: Record<string, { displayName: string; email: string }>;
  signupTokenCounter: number;
  bookedAppointments: Array<{
    confirmationNumber: string;
    slotId: string;
    provider: string;
    department: string;
    location: string;
    visitType: string;
    date: string;
    time: string;
    reason: string;
  }>;
};

// Seed one known-good activation code so the activation-code signup path is
// testable end-to-end. Format mirrors Epic's 3-part code.
function seedActivationCodes(): Record<string, { displayName: string; email: string }> {
  return {
    'ABCDE-FGHIJ-KLMNO': { displayName: 'Bart Simpson', email: 'bart@springfield.net' },
  };
}

function freshState(): State {
  return {
    users: seedUsers(),
    conversations: JSON.parse(JSON.stringify(homer.conversations)),
    emergencyContacts: JSON.parse(JSON.stringify(homer.emergencyContacts)),
    ecIdCounter: 100,
    composeIdCounter: 1000,
    passkeyIdCounter: 0,
    pendingSignups: {},
    pendingRecoveries: {},
    activationCodes: seedActivationCodes(),
    signupTokenCounter: 0,
    bookedAppointments: [],
  };
}

export const state: State = freshState();

export function resetState(): void {
  const next = freshState();
  state.users = next.users;
  state.conversations = next.conversations;
  state.emergencyContacts = next.emergencyContacts;
  state.ecIdCounter = next.ecIdCounter;
  state.composeIdCounter = next.composeIdCounter;
  state.passkeyIdCounter = next.passkeyIdCounter;
  state.pendingSignups = next.pendingSignups;
  state.pendingRecoveries = next.pendingRecoveries;
  state.activationCodes = next.activationCodes;
  state.signupTokenCounter = next.signupTokenCounter;
  state.bookedAppointments.length = 0;
  resetSessions();
}

export function findUser(username: string | null | undefined): FakeUser | null {
  if (!username) return null;
  return state.users[username.toLowerCase()] ?? null;
}

/**
 * Find a user by their recovery contact (email or mobile phone), normalizing
 * away formatting on phone numbers so "555-555-7890" matches "5555557890".
 */
export function findUserByContact(contactInfo: string | null | undefined): FakeUser | null {
  if (!contactInfo) return null;
  const needle = contactInfo.trim().toLowerCase();
  const digits = (s: string) => s.replace(/\D/g, '');
  for (const user of Object.values(state.users)) {
    if (user.email && user.email.toLowerCase() === needle) return user;
    if (user.mobilePhone && digits(user.mobilePhone) === digits(needle) && digits(needle).length >= 7) {
      return user;
    }
  }
  return null;
}

/** Generate the next opaque signup/recovery token. */
export function nextSignupToken(prefix: string): string {
  state.signupTokenCounter++;
  return `${prefix}-${state.signupTokenCounter}-${Math.random().toString(36).slice(2, 10)}`;
}

export function findUserByPasskey(rawId: string): FakeUser | null {
  for (const user of Object.values(state.users)) {
    if (user.passkeys.some(pk => pk.rawId === rawId)) return user;
  }
  return null;
}
