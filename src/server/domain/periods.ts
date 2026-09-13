import { get, query, run } from "../db";
import { type Actor } from "./audit";
import { LedgerError, rethrowLedgerError } from "./errors";

export interface Period {
  year: number;
  month: number;
  locked_at: string;
  locked_by: string | null;
  locked_by_kind: string | null;
}

/** Split a 'YYYY-MM-DD' date into the period it belongs to. */
export function periodOf(date: string): { year: number; month: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

export async function isPeriodLocked(date: string): Promise<boolean> {
  const { year, month } = periodOf(date);
  const row = await get<{ year: number }>(
    "SELECT year FROM periods WHERE year = ? AND month = ?",
    [year, month],
  );
  return !!row;
}

/**
 * Refuse a write whose entry date falls in a closed period. Called on every
 * path that puts something into the ledger, so a back-dated document cannot
 * slip into a month that has already been reported.
 */
export async function assertPeriodOpen(date: string, what: string): Promise<void> {
  if (await isPeriodLocked(date)) {
    const { year, month } = periodOf(date);
    throw new LedgerError(
      `${what} is dated ${date}, but ${year}-${String(month).padStart(2, "0")} is locked. ` +
        `Post it into an open period instead -- a locked period cannot be reopened.`,
    );
  }
}

export async function listPeriods(): Promise<Period[]> {
  return query<Period>("SELECT * FROM periods ORDER BY year DESC, month DESC");
}

export async function lockPeriod(year: number, month: number, actor: Actor): Promise<Period> {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    throw new LedgerError(`'${year}' is not a valid year.`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new LedgerError(`'${month}' is not a month between 1 and 12.`);
  }
  // A lock is one-way and there is no unlock route, so locking a month that
  // hasn't ended yet would permanently refuse every invoice for the rest of
  // it with no way back.
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  if (year > currentYear || (year === currentYear && month >= currentMonth)) {
    throw new LedgerError(
      `${year}-${String(month).padStart(2, "0")} has not ended yet. A period can only be locked once its month is over.`,
    );
  }
  try {
    await run(
      `INSERT INTO periods (year, month, locked_by, locked_by_kind) VALUES (?, ?, ?, ?)
       ON CONFLICT(year, month) DO NOTHING`,
      [year, month, actor.actor, actor.actor_kind],
    );
  } catch (error) {
    rethrowLedgerError(error);
  }
  const locked = await get<Period>(
    "SELECT * FROM periods WHERE year = ? AND month = ?",
    [year, month],
  );
  if (!locked) throw new Error("Failed to load locked period");
  return locked;
}
