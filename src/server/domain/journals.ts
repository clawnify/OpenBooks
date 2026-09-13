import { get, query } from "../db";
import { SYSTEM_ACTOR, type Actor } from "./audit";
import { rethrowLedgerError } from "./errors";

export interface JournalEntry {
  id: number;
  reference: string;
  description: string | null;
  date: string;
  source_type: string | null;
  source_id: number | null;
  status: string;
  reverses_entry_id: number | null;
  reversed_by_entry_id: number | null;
  posted_at: string;
  created_at: string;
}

export interface JournalLine {
  id: number;
  entry_id: number;
  position: number;
  account_code: string;
  description: string | null;
  debit_cents: number;
  credit_cents: number;
}

export interface JournalEntryWithLines extends JournalEntry {
  lines: JournalLine[];
  total_debit_cents: number;
  total_credit_cents: number;
}

export async function listEntries(filters: { source_type?: string; from?: string; to?: string } = {}): Promise<JournalEntryWithLines[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.source_type) { where.push("source_type = ?"); params.push(filters.source_type); }
  if (filters.from) { where.push("date >= ?"); params.push(filters.from); }
  if (filters.to) { where.push("date <= ?"); params.push(filters.to); }
  const entries = await query<JournalEntry>(
    `SELECT * FROM journal_entries ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY date DESC, id DESC`,
    params,
  );
  if (entries.length === 0) return [];
  const ids = entries.map((e) => e.id);
  const lines = await query<JournalLine>(
    `SELECT * FROM journal_lines WHERE entry_id IN (${ids.map(() => "?").join(",")}) ORDER BY entry_id, position`,
    ids,
  );
  const byEntry = new Map<number, JournalLine[]>();
  for (const line of lines) {
    if (!byEntry.has(line.entry_id)) byEntry.set(line.entry_id, []);
    byEntry.get(line.entry_id)!.push(line);
  }
  return entries.map((e) => {
    const entryLines = byEntry.get(e.id) ?? [];
    return {
      ...e,
      lines: entryLines,
      total_debit_cents: entryLines.reduce((s, l) => s + l.debit_cents, 0),
      total_credit_cents: entryLines.reduce((s, l) => s + l.credit_cents, 0),
    };
  });
}

export async function getEntry(id: number): Promise<JournalEntryWithLines | undefined> {
  const entry = await get<JournalEntry>("SELECT * FROM journal_entries WHERE id = ?", [id]);
  if (!entry) return undefined;
  const lines = await query<JournalLine>(
    "SELECT * FROM journal_lines WHERE entry_id = ? ORDER BY position",
    [id],
  );
  return {
    ...entry,
    lines,
    total_debit_cents: lines.reduce((s, l) => s + l.debit_cents, 0),
    total_credit_cents: lines.reduce((s, l) => s + l.credit_cents, 0),
  };
}

/** Publish a complete original once; historical pending rows do not block retry. */
export async function createFromInvoice(invoiceId: number, actor: Actor = SYSTEM_ACTOR): Promise<JournalEntry | undefined> {
  try {
    // RETURNING works with both D1 and Storage bindings; Storage need not
    // provide lastInsertRowid metadata. All lines/audit publish in this INSERT.
    const inserted = await query<{ id: number }>(
      `INSERT INTO journal_entries
        (reference, description, date, source_type, source_id, status, mutation_actor, mutation_actor_kind)
       SELECT number, type || ' ' || number, COALESCE(issue_date, date('now')), type, id, 'pending', ?, ?
         FROM invoices i WHERE id = ? AND type IN ('invoice','credit_note')
           AND number IS NOT NULL AND status IN ('issued','sent','paid')
           AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.source_id = i.id
             AND j.source_type = i.type AND j.status = 'posted' AND j.reverses_entry_id IS NULL)
       RETURNING id`,
      [actor.actor, actor.actor_kind, invoiceId],
    );
    if (!inserted.length) return undefined;
    return get<JournalEntry>("SELECT * FROM journal_entries WHERE id = ?", [inserted[0].id]);
  } catch (error) {
    rethrowLedgerError(error);
  }
}

export async function backfillFromInvoices(actor: Actor = SYSTEM_ACTOR): Promise<{ created: number }> {
  const candidates = await query<{ id: number }>(
    `SELECT i.id FROM invoices i WHERE i.number IS NOT NULL
       AND i.type IN ('invoice','credit_note') AND i.status IN ('issued','sent','paid')
       AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.source_id = i.id
         AND j.source_type = i.type AND j.status = 'posted' AND j.reverses_entry_id IS NULL)`,
  );
  let created = 0;
  for (const row of candidates) {
    if (await createFromInvoice(row.id, actor)) created++;
  }
  return { created };
}

export interface TrialBalanceRow {
  account_code: string;
  debit_cents: number;
  credit_cents: number;
  balance_cents: number;
}

export async function trialBalance(opts: { from?: string; to?: string } = {}): Promise<TrialBalanceRow[]> {
  const where: string[] = ["e.status = 'posted'"];
  const params: unknown[] = [];
  if (opts.from) { where.push("e.date >= ?"); params.push(opts.from); }
  if (opts.to) { where.push("e.date <= ?"); params.push(opts.to); }
  return query<TrialBalanceRow>(
    `SELECT
       l.account_code,
       SUM(l.debit_cents) AS debit_cents,
       SUM(l.credit_cents) AS credit_cents,
       SUM(l.debit_cents) - SUM(l.credit_cents) AS balance_cents
     FROM journal_lines l
     JOIN journal_entries e ON e.id = l.entry_id
     WHERE ${where.join(" AND ")}
     GROUP BY l.account_code
     ORDER BY l.account_code`,
    params,
  );
}
