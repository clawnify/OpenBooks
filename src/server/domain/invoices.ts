import { get, query, run } from "../db";
import { record, type Actor } from "./audit";
import { getCompany } from "./company";
import { LedgerError } from "./errors";
import { assertPeriodOpen } from "./periods";
import { createFromInvoice as createJournalFromInvoice, reverseEntriesForInvoice } from "./journals";
import { getParty } from "./parties";
import { nextNumber, type NumberingScope } from "./numbering";
import { computeVat } from "./vat";

export type InvoiceType = "invoice" | "credit_note" | "quote";
export type InvoiceStatus = "draft" | "issued" | "sent" | "paid" | "cancelled";

export interface Invoice {
  id: number;
  number: string | null;
  type: InvoiceType;
  status: InvoiceStatus;
  party_id: number;
  issue_date: string | null;
  due_date: string | null;
  currency: string;
  fx_rate: number;
  subtotal_cents: number;
  vat_cents: number;
  total_cents: number;
  reverse_charge: number;
  reference: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLine {
  id: number;
  invoice_id: number;
  position: number;
  product_id: number | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price_cents: number;
  vat_rate: number;
  account_code: string | null;
  subtotal_cents: number;
  vat_cents: number;
  total_cents: number;
}

export interface InvoiceWithParty extends Invoice {
  party_name: string;
  party_country: string;
}

export async function listInvoices(filters: { type?: InvoiceType; status?: InvoiceStatus; party_id?: number } = {}): Promise<InvoiceWithParty[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.type) { where.push("i.type = ?"); params.push(filters.type); }
  if (filters.status) { where.push("i.status = ?"); params.push(filters.status); }
  if (filters.party_id) { where.push("i.party_id = ?"); params.push(filters.party_id); }
  return query<InvoiceWithParty>(
    `SELECT i.*, p.name AS party_name, p.country AS party_country
       FROM invoices i
       JOIN parties p ON p.id = i.party_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY COALESCE(i.issue_date, i.created_at) DESC, i.id DESC`,
    params,
  );
}

export async function getInvoice(id: number): Promise<Invoice | undefined> {
  return get<Invoice>("SELECT * FROM invoices WHERE id = ?", [id]);
}

export async function getLines(invoiceId: number): Promise<InvoiceLine[]> {
  return query<InvoiceLine>(
    "SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY position",
    [invoiceId],
  );
}

export interface CreateDraftInput {
  type?: InvoiceType;
  party_id: number;
  currency?: string;
  reference?: string;
  notes?: string;
}

export async function createDraft(input: CreateDraftInput): Promise<Invoice> {
  const result = await run(
    `INSERT INTO invoices (type, party_id, currency, reference, notes)
     VALUES (?, ?, ?, ?, ?)`,
    [
      input.type ?? "invoice",
      input.party_id,
      input.currency ?? "EUR",
      input.reference ?? null,
      input.notes ?? null,
    ],
  );
  const created = await getInvoice(result.lastInsertRowid);
  if (!created) throw new Error("Failed to load created invoice");
  return created;
}

/**
 * Refuse to change a document that has already been posted.
 *
 * The UI hides these controls on a non-draft invoice, but the API is a public
 * surface that the org's agent calls directly, so the rule has to live here
 * too. Without it an issued invoice could be silently rewritten while its
 * journal entry stood unchanged, and the books would drift from the documents
 * behind them.
 */
function assertEditable(inv: Invoice): void {
  if (inv.status !== "draft") {
    throw new LedgerError(
      `Invoice ${inv.number ?? inv.id} is ${inv.status} and can no longer be edited. ` +
        `Cancel it or raise a credit note -- a posted document stays as it was issued.`,
    );
  }
}

export async function deleteInvoice(id: number, actor: Actor): Promise<void> {
  const inv = await getInvoice(id);
  if (!inv) return;
  if (inv.status !== "draft") {
    throw new LedgerError(
      `Invoice ${inv.number ?? id} is ${inv.status} and cannot be deleted. ` +
        `Cancel it instead -- that reverses its journal entry and leaves both on the record.`,
    );
  }
  // A draft was never posted, so there is nothing in the ledger to reverse.
  await run("DELETE FROM invoice_lines WHERE invoice_id = ?", [id]);
  await run("DELETE FROM invoices WHERE id = ?", [id]);
  await record(actor, "invoice.delete", "invoice", id, inv, null);
}

const SCOPE_FOR_TYPE: Record<InvoiceType, NumberingScope> = {
  invoice: "invoice",
  credit_note: "credit_note",
  quote: "quote",
};

export async function issueInvoice(id: number, actor: Actor): Promise<Invoice | undefined> {
  const inv = await getInvoice(id);
  if (!inv) return undefined;
  if (inv.status !== "draft") return inv;
  const today = new Date().toISOString().slice(0, 10);
  // Check the period before anything is written. Issuing assigns a number from
  // a gap-free sequence and posts to the ledger; if the posting were refused
  // afterwards the invoice would be left issued, numbered and unposted.
  await assertPeriodOpen(inv.issue_date ?? today, `Invoice ${id}`);
  const number = await nextNumber(SCOPE_FOR_TYPE[inv.type]);
  await run(
    `UPDATE invoices
       SET number = ?,
           status = 'issued',
           issue_date = COALESCE(issue_date, ?),
           updated_at = datetime('now')
     WHERE id = ?`,
    [number, today, id],
  );
  await createJournalFromInvoice(id, actor);
  const issued = await getInvoice(id);
  await record(actor, "invoice.issue", "invoice", id, { status: inv.status }, issued);
  return issued;
}

const SETTABLE_STATUSES = new Set<InvoiceStatus>(["sent", "paid", "cancelled"]);

export async function setStatus(id: number, status: InvoiceStatus, actor: Actor): Promise<Invoice | undefined> {
  const before = await getInvoice(id);
  if (!before) return undefined;
  // This is a public API surface, not just the three buttons the UI shows.
  // Without these checks an agent (or a stray request) could set an issued
  // invoice back to 'draft', which reopens editing on a document whose
  // journal entry has already been posted -- the exact drift assertEditable
  // exists to prevent.
  if (before.status === "draft") {
    throw new LedgerError(`Invoice ${before.number ?? id} is still a draft -- issue it first.`);
  }
  if (!SETTABLE_STATUSES.has(status)) {
    throw new LedgerError(`Cannot set an invoice to '${status}'. Valid transitions are sent, paid, or cancelled.`);
  }
  // Reverse first: it is the step that can be refused (a locked period), and
  // doing it before the status write means a refusal leaves nothing changed.
  if (status === "cancelled") {
    await reverseEntriesForInvoice(id, actor);
  }
  await run(
    `UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE id = ?`,
    [status, id],
  );
  const after = await getInvoice(id);
  await record(actor, "invoice.status", "invoice", id, { status: before.status }, { status });
  return after;
}

export async function updateInvoice(
  id: number,
  input: Partial<Pick<Invoice, "party_id" | "currency" | "issue_date" | "due_date" | "reference" | "notes">>,
): Promise<Invoice | undefined> {
  const inv = await getInvoice(id);
  if (!inv) return undefined;
  assertEditable(inv);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const col of ["party_id", "currency", "issue_date", "due_date", "reference", "notes"] as const) {
    const value = (input as Record<string, unknown>)[col];
    if (value !== undefined) {
      sets.push(`${col} = ?`);
      params.push(value);
    }
  }
  if (sets.length === 0) return getInvoice(id);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  await run(`UPDATE invoices SET ${sets.join(", ")} WHERE id = ?`, params);
  await recomputeTotals(id);
  return getInvoice(id);
}

export interface LineInput {
  description?: string;
  quantity?: number;
  unit?: string;
  unit_price_cents?: number;
  vat_rate?: number;
  account_code?: string | null;
  product_id?: number | null;
  position?: number;
}

export async function addLine(invoiceId: number, input: LineInput): Promise<InvoiceLine | undefined> {
  const inv = await getInvoice(invoiceId);
  if (!inv) return undefined;
  assertEditable(inv);
  const maxRow = await get<{ max_pos: number | null }>(
    "SELECT MAX(position) AS max_pos FROM invoice_lines WHERE invoice_id = ?",
    [invoiceId],
  );
  const position = input.position ?? ((maxRow?.max_pos ?? 0) + 1);
  const result = await run(
    `INSERT INTO invoice_lines
       (invoice_id, position, product_id, description, quantity, unit, unit_price_cents, vat_rate, account_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      invoiceId,
      position,
      input.product_id ?? null,
      input.description ?? "",
      input.quantity ?? 1,
      input.unit ?? "unit",
      input.unit_price_cents ?? 0,
      input.vat_rate ?? 21,
      input.account_code ?? null,
    ],
  );
  await recomputeTotals(invoiceId);
  return get<InvoiceLine>("SELECT * FROM invoice_lines WHERE id = ?", [result.lastInsertRowid]);
}

export async function updateLine(lineId: number, input: LineInput): Promise<InvoiceLine | undefined> {
  const owner = await get<{ invoice_id: number }>(
    "SELECT invoice_id FROM invoice_lines WHERE id = ?",
    [lineId],
  );
  if (!owner) return undefined;
  const parent = await getInvoice(owner.invoice_id);
  if (!parent) return undefined;
  assertEditable(parent);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const col of ["product_id", "description", "quantity", "unit", "unit_price_cents", "vat_rate", "account_code", "position"] as const) {
    const value = (input as Record<string, unknown>)[col];
    if (value !== undefined) {
      sets.push(`${col} = ?`);
      params.push(value);
    }
  }
  if (sets.length > 0) {
    params.push(lineId);
    await run(`UPDATE invoice_lines SET ${sets.join(", ")} WHERE id = ?`, params);
  }
  await recomputeTotals(owner.invoice_id);
  return get<InvoiceLine>("SELECT * FROM invoice_lines WHERE id = ?", [lineId]);
}

export async function deleteLine(lineId: number): Promise<void> {
  const owner = await get<{ invoice_id: number }>(
    "SELECT invoice_id FROM invoice_lines WHERE id = ?",
    [lineId],
  );
  if (!owner) return;
  const parent = await getInvoice(owner.invoice_id);
  if (!parent) return;
  assertEditable(parent);
  await run("DELETE FROM invoice_lines WHERE id = ?", [lineId]);
  await recomputeTotals(owner.invoice_id);
}

export async function recomputeTotals(invoiceId: number): Promise<void> {
  const inv = await getInvoice(invoiceId);
  if (!inv) return;
  const party = await getParty(inv.party_id);
  const company = await getCompany();
  const sellerCountry = company.country;
  const buyerCountry = party?.country ?? sellerCountry;
  const buyerHasVatId = !!party?.vat_number;

  const lines = await getLines(invoiceId);
  let subtotal = 0;
  let vat = 0;
  let anyReverseCharge = false;

  for (const line of lines) {
    const v = computeVat({
      sellerCountry,
      buyerCountry,
      buyerHasVatId,
      lineRate: line.vat_rate,
    });
    const lineSubtotal = Math.round(line.quantity * line.unit_price_cents);
    const lineVat = Math.round((lineSubtotal * v.effectiveRate) / 100);
    const lineTotal = lineSubtotal + lineVat;
    if (v.reverseCharge) anyReverseCharge = true;
    await run(
      `UPDATE invoice_lines SET subtotal_cents = ?, vat_cents = ?, total_cents = ? WHERE id = ?`,
      [lineSubtotal, lineVat, lineTotal, line.id],
    );
    subtotal += lineSubtotal;
    vat += lineVat;
  }

  await run(
    `UPDATE invoices
       SET subtotal_cents = ?, vat_cents = ?, total_cents = ?, reverse_charge = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [subtotal, vat, subtotal + vat, anyReverseCharge ? 1 : 0, invoiceId],
  );
}
