import { get, query, run } from "../db";
import { record, SYSTEM_ACTOR, type Actor } from "./audit";
import { assertPeriodOpen, isPeriodLocked } from "./periods";
import { getInvoice, getLines } from "./invoices";

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

const RECEIVABLE_ACCOUNT = "BVor";
const REVENUE_ACCOUNT_FALLBACK = "WOmz";
const VAT_PAYABLE_ACCOUNT = "BKas";

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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Reverse one posted entry with a mirror-image Storno.
 *
 * Both entries stay `posted` and net to zero, so the trial balance is right
 * without either one leaving the books. The Storno is dated in the original's
 * period when that period is still open, and today when it is not -- a closed
 * month keeps the numbers it was reported with, and the correction lands where
 * it can still be seen.
 */
async function reverseEntry(entry: JournalEntry, actor: Actor): Promise<number> {
  // Idempotent: a prior call may have posted the Storno and then crashed
  // before linking it back (see the write order below). Reuse it rather
  // than posting a second reversal for the same entry.
  const existingStorno = await get<JournalEntry>(
    "SELECT * FROM journal_entries WHERE reverses_entry_id = ? AND status = 'posted'",
    [entry.id],
  );
  if (existingStorno) {
    if (!entry.reversed_by_entry_id) {
      await run("UPDATE journal_entries SET reversed_by_entry_id = ? WHERE id = ?", [existingStorno.id, entry.id]);
    }
    return existingStorno.id;
  }

  const stornoDate = (await isPeriodLocked(entry.date)) ? today() : entry.date;
  await assertPeriodOpen(stornoDate, `The reversal of ${entry.reference}`);

  const lines = await query<JournalLine>(
    "SELECT * FROM journal_lines WHERE entry_id = ? ORDER BY position",
    [entry.id],
  );

  // There is no transaction primitive here, so the writes are ordered to fail
  // safe: the Storno is only counted once its lines exist. A crash part-way
  // leaves a 'pending' entry, which no report reads, rather than half a
  // reversal that silently unbalances the books.
  const result = await run(
    `INSERT INTO journal_entries (reference, description, date, source_type, source_id, status, reverses_entry_id)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [
      entry.reference,
      `Reversal of ${entry.description ?? entry.reference}`,
      stornoDate,
      entry.source_type,
      entry.source_id,
      entry.id,
    ],
  );
  const stornoId = result.lastInsertRowid;

  for (const line of lines) {
    await run(
      `INSERT INTO journal_lines (entry_id, position, account_code, description, debit_cents, credit_cents)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        stornoId,
        line.position,
        line.account_code,
        `Reversal ${line.description ?? ""}`.trim(),
        line.credit_cents,
        line.debit_cents,
      ],
    );
  }

  // Post the Storno before linking it back. A crash between these two writes
  // then leaves the books already correct (every report already counts the
  // posted Storno) with only the back-link missing -- and the idempotency
  // check above finishes that link on retry instead of posting a second,
  // duplicate reversal.
  await run("UPDATE journal_entries SET status = 'posted' WHERE id = ?", [stornoId]);
  await run("UPDATE journal_entries SET reversed_by_entry_id = ? WHERE id = ?", [stornoId, entry.id]);

  await record(actor, "journal.reverse", "journal_entry", entry.id, entry, {
    reversed_by_entry_id: stornoId,
    date: stornoDate,
  });
  return stornoId;
}

/**
 * Reverse every posted entry behind an invoice.
 *
 * Replaces the delete this used to be: a posted entry is never removed, so
 * cancelling a document leaves the original and its Storno both on the record.
 */
export async function reverseEntriesForInvoice(invoiceId: number, actor: Actor): Promise<number> {
  const entries = await query<JournalEntry>(
    `SELECT * FROM journal_entries
      WHERE source_type IN ('invoice','credit_note')
        AND source_id = ?
        AND status = 'posted'
        AND reversed_by_entry_id IS NULL`,
    [invoiceId],
  );
  for (const entry of entries) {
    await reverseEntry(entry, actor);
  }
  return entries.length;
}

interface PendingLine {
  account_code: string;
  description: string;
  debit_cents: number;
  credit_cents: number;
}

export async function createFromInvoice(invoiceId: number, actor: Actor = SYSTEM_ACTOR): Promise<JournalEntry | undefined> {
  const inv = await getInvoice(invoiceId);
  if (!inv) return undefined;
  if (!inv.number) return undefined;
  if (inv.status === "draft" || inv.status === "cancelled") return undefined;

  const lines = await getLines(invoiceId);
  if (lines.length === 0) return undefined;

  const isCreditNote = inv.type === "credit_note";

  // Group revenue by account_code
  const revenueByAccount = new Map<string, number>();
  for (const line of lines) {
    const acc = line.account_code || REVENUE_ACCOUNT_FALLBACK;
    revenueByAccount.set(acc, (revenueByAccount.get(acc) ?? 0) + line.subtotal_cents);
  }

  const totalVat = lines.reduce((s, l) => s + l.vat_cents, 0);
  const totalGross = inv.total_cents;

  const pending: PendingLine[] = [];
  if (isCreditNote) {
    pending.push({
      account_code: RECEIVABLE_ACCOUNT,
      description: `Credit ${inv.number}`,
      debit_cents: 0,
      credit_cents: totalGross,
    });
    for (const [acc, amount] of revenueByAccount) {
      pending.push({
        account_code: acc,
        description: `Revenue reversal ${inv.number}`,
        debit_cents: amount,
        credit_cents: 0,
      });
    }
    if (totalVat > 0) {
      pending.push({
        account_code: VAT_PAYABLE_ACCOUNT,
        description: `VAT reversal ${inv.number}`,
        debit_cents: totalVat,
        credit_cents: 0,
      });
    }
  } else {
    pending.push({
      account_code: RECEIVABLE_ACCOUNT,
      description: `Invoice ${inv.number}`,
      debit_cents: totalGross,
      credit_cents: 0,
    });
    for (const [acc, amount] of revenueByAccount) {
      pending.push({
        account_code: acc,
        description: `Revenue ${inv.number}`,
        debit_cents: 0,
        credit_cents: amount,
      });
    }
    if (totalVat > 0) {
      pending.push({
        account_code: VAT_PAYABLE_ACCOUNT,
        description: `VAT payable ${inv.number}`,
        debit_cents: 0,
        credit_cents: totalVat,
      });
    }
  }

  const totalDebit = pending.reduce((s, l) => s + l.debit_cents, 0);
  const totalCredit = pending.reduce((s, l) => s + l.credit_cents, 0);
  if (totalDebit !== totalCredit) {
    throw new Error(`Journal entry would not balance: debit ${totalDebit} ≠ credit ${totalCredit}`);
  }

  const date = inv.issue_date ?? today();
  await assertPeriodOpen(date, `${isCreditNote ? "Credit note" : "Invoice"} ${inv.number}`);

  // Re-posting reverses what was there before rather than deleting it, so the
  // superseded entry stays visible next to its replacement. Done last, after
  // every check that can still refuse this call -- a refusal here would
  // otherwise leave the old entry reversed with nothing posted to replace it.
  await reverseEntriesForInvoice(invoiceId, actor);

  const description = isCreditNote
    ? `Credit note ${inv.number}`
    : `Invoice ${inv.number}`;

  const result = await run(
    `INSERT INTO journal_entries (reference, description, date, source_type, source_id, status)
     VALUES (?, ?, ?, ?, ?, 'posted')`,
    [inv.number, description, date, inv.type, inv.id],
  );
  const entryId = result.lastInsertRowid;

  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    await run(
      `INSERT INTO journal_lines (entry_id, position, account_code, description, debit_cents, credit_cents)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entryId, i + 1, p.account_code, p.description, p.debit_cents, p.credit_cents],
    );
  }

  const entry = await get<JournalEntry>("SELECT * FROM journal_entries WHERE id = ?", [entryId]);
  await record(actor, "journal.post", "journal_entry", entryId, null, entry);
  return entry;
}

export async function backfillFromInvoices(actor: Actor = SYSTEM_ACTOR): Promise<{ created: number }> {
  const candidates = await query<{ id: number }>(
    `SELECT i.id FROM invoices i
      LEFT JOIN journal_entries j
        ON j.source_id = i.id AND j.source_type IN ('invoice','credit_note')
     WHERE i.number IS NOT NULL
       AND i.status IN ('issued','sent','paid')
       AND j.id IS NULL`,
  );
  let created = 0;
  for (const row of candidates) {
    const entry = await createFromInvoice(row.id, actor);
    if (entry) created++;
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
