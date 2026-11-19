import type { Request } from 'express';

/** cookie-parser types req.cookies as any; read one cookie as an untrusted string. */
export function readCookie(req: Request, name: string): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : undefined;
}
