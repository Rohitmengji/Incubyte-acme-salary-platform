import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

// OWASP Password Storage Cheat Sheet minimum for Argon2id: m=19 MiB, t=2, p=1.
// @node-rs/argon2 defaults to the Argon2id variant.
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same verification cost when the email is unknown, so response time does not reveal
 * which accounts exist.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(await dummyHash, password);
}

/** 256-bit opaque session token; only its SHA-256 is stored server-side. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
