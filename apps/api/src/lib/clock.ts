import { utcToday } from '@acme/shared';

/** Injected so date-dependent rules (current salary, session expiry) are deterministic in tests. */
export interface Clock {
  now(): Date;
  /** Business "today" as YYYY-MM-DD in UTC. */
  today(): string;
}

export const systemClock: Clock = {
  now: () => new Date(),
  today: () => utcToday(new Date()),
};

export class FixedClock implements Clock {
  private current: Date;

  constructor(iso: string) {
    this.current = new Date(iso);
  }

  now(): Date {
    return new Date(this.current);
  }

  today(): string {
    return utcToday(this.current);
  }

  advanceBy(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Prisma maps @db.Date columns to JS Dates at UTC midnight. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fromIsoDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}
