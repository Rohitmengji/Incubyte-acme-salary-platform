import type { AuthUser, LoginRequest } from '@acme/shared';
import type { PrismaClient } from '../../db.ts';
import type { Clock } from '../../lib/clock.ts';
import type { AuthContext } from '../../types/auth.ts';
import { UnauthorizedError } from '../../http/errors.ts';
import {
  generateSessionToken,
  hashSessionToken,
  verifyAgainstDummy,
  verifyPassword,
} from './crypto.ts';

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: AuthUser;
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: Clock,
    private readonly sessionTtlMs: number,
  ) {}

  async login({ email, password }: LoginRequest): Promise<LoginResult> {
    const user = await this.prisma.appUser.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.isActive) {
      await verifyAgainstDummy(password);
      throw new UnauthorizedError('Invalid email or password.');
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw new UnauthorizedError('Invalid email or password.');
    }

    const now = this.clock.now();
    const token = generateSessionToken();
    const expiresAt = new Date(now.getTime() + this.sessionTtlMs);
    await this.prisma.$transaction([
      // Housekeeping: drop this user's expired sessions so the table does not grow unbounded.
      this.prisma.session.deleteMany({ where: { userId: user.id, expiresAt: { lte: now } } }),
      this.prisma.session.create({
        data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt },
      }),
      this.prisma.appUser.update({ where: { id: user.id }, data: { lastLoginAt: now } }),
    ]);

    return {
      token,
      expiresAt,
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
    };
  }

  async logout(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  }

  /** Resolves a cookie token to an auth context, or null if unknown, expired or the user is disabled. */
  async authenticate(token: string): Promise<AuthContext | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt <= this.clock.now() || !session.user.isActive) return null;
    return {
      userId: session.user.id,
      sessionId: session.id,
      role: session.user.role,
      email: session.user.email,
      displayName: session.user.displayName,
    };
  }
}
