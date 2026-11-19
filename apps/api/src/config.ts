import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a postgresql:// connection string'),
  WEB_ORIGIN: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  SESSION_TTL_HOURS: z.coerce.number().min(0.25).max(24).default(8),
  COOKIE_SECURE: booleanString.optional(),
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(600),
});

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  logLevel: string;
  databaseUrl: string;
  allowedOrigins: string[];
  trustProxyHops: number;
  sessionTtlMs: number;
  cookie: { name: string; secure: boolean };
  rateLimits: { loginPerWindow: number; loginWindowMs: number; apiPerMinute: number };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  const secure = production || (e.COOKIE_SECURE ?? false);
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    allowedOrigins: e.WEB_ORIGIN,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    sessionTtlMs: e.SESSION_TTL_HOURS * 60 * 60 * 1000,
    // The __Host- prefix makes browsers refuse the cookie unless it is Secure, host-only and Path=/.
    cookie: { name: secure ? '__Host-acme_session' : 'acme_session', secure },
    rateLimits: {
      loginPerWindow: e.LOGIN_RATE_LIMIT,
      loginWindowMs: 15 * 60 * 1000,
      apiPerMinute: e.API_RATE_LIMIT_PER_MINUTE,
    },
  };
}
