/**
 * A refusal to change the books.
 *
 * Thrown when a write would break an accounting rule the app is not allowed to
 * bend: editing a posted document, deleting an entry, or posting into a locked
 * period. Routes turn it into a 409 with the message shown to the caller --
 * including an agent, which is why the messages say what to do instead.
 */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

const SQL_REFUSALS: Record<string, string> = {
  "invalid-date": "Use a valid calendar date in YYYY-MM-DD format (1900 or later).",
  "period-locked": "That accounting period is locked. Post into an open period instead.",
  "invalid-period": "Use a valid accounting year and month.",
  "period-not-ended": "A period can only be locked once its month is over.",
  "invalid-original": "Only an unreversed original posted entry can be reversed.",
  "invalid-source": "Only a numbered, issued invoice or credit note can be posted.",
  "empty-invoice": "Add at least one line before posting an invoice.",
  "unbalanced-entry": "The journal entry must have lines with equal total debits and credits.",
  "invalid-transition": "That invoice status transition is not allowed. A cancelled invoice stays cancelled.",
};

/** Only our explicit SQLite refusals are conflicts; storage faults remain 500s. */
export function rethrowLedgerError(error: unknown): never {
  const marker = error instanceof Error ? /\bledger:([a-z-]+)\b/.exec(error.message)?.[1] : undefined;
  if (marker && SQL_REFUSALS[marker]) throw new LedgerError(SQL_REFUSALS[marker]);
  throw error;
}
