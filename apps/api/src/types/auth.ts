import type { UserRole } from '@acme/shared';

export interface AuthContext {
  userId: string;
  sessionId: string;
  role: UserRole;
  email: string;
  displayName: string;
}
