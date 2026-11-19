import type { AuthContext } from './auth.ts';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
    }
  }
}
