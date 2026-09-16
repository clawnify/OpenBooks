import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, test } from "node:test";
import app from "../src/server/index";

// demo/seed.sql is loaded after schema.sql for the public demo workspace. It
// issues its invoices through the ledger triggers, so it must stay consistent
// with them and with the totals the app computes.
let db: DatabaseSync;
let env: unknown;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../src/server/schema.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../demo/seed.sql", import.meta.url), "utf8"));
  env = { STORAGE: { query: async (sql: string, params: (string | number | null)[] = []) => {
    const statement = db.prepare(sql);
    if (statement.columns().length) return { rows: statement.all(...params), meta: {} };
    const result = statement.run(...params);
    return { rows: [], meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
  } } };
});

afterEach(() => db.close());

const call = (path: string, init?: RequestInit) =>
  app.request(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } }, env as any);

test("seed satisfies foreign keys and posts balanced entries for issued invoices", async () => {
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  const year = new Date().getUTCFullYear();
  assert.deepEqual(
    db.prepare("SELECT number, status FROM invoices ORDER BY id").all().map((r) => ({ ...r })),
    [
      { number: `INV-${year}-0001`, status: "paid" },
      { number: `INV-${year}-0002`, status: "sent" },
      { number: null, status: "draft" },
    ],
  );
  const trial = await (await call("/api/reports/trial-balance")).json() as { debit_cents: number; credit_cents: number }[];
  assert.equal(trial.reduce((s, r) => s + r.debit_cents, 0), trial.reduce((s, r) => s + r.credit_cents, 0));
  assert.ok(trial.length > 0);
});

test("seeded totals match what the app computes", async () => {
  const before = db.prepare("SELECT subtotal_cents, vat_cents, total_cents, reverse_charge FROM invoices WHERE id = 3").get();
  // Any edit to the draft recomputes its totals from its lines.
  assert.equal((await call("/api/invoices/3", { method: "PATCH", body: JSON.stringify({ notes: "Recomputed" }) })).status, 200);
  assert.deepEqual(
    { ...db.prepare("SELECT subtotal_cents, vat_cents, total_cents, reverse_charge FROM invoices WHERE id = 3").get() },
    { ...before },
  );
  // The issued invoices are frozen, so check them against the same rule directly.
  for (const [id, party, reverseCharge] of [[1, 1, 0], [2, 2, 1]] as const) {
    const vat = await (await call(`/api/vat/compute?seller=NL&buyer=${party === 2 ? "BE" : "NL"}&buyer_vat=${party === 2 ? 1 : 0}&rate=21`)).json() as { effectiveRate: number };
    const lines = db.prepare("SELECT subtotal_cents, vat_cents FROM invoice_lines WHERE invoice_id = ?").all(id) as { subtotal_cents: number; vat_cents: number }[];
    for (const line of lines) assert.equal(line.vat_cents, Math.round((line.subtotal_cents * vat.effectiveRate) / 100));
    assert.equal(db.prepare("SELECT reverse_charge FROM invoices WHERE id = ?").get(id)!.reverse_charge, reverseCharge);
  }
});

test("the primary workflows work on the seeded books", async () => {
  const year = new Date().getUTCFullYear();
  const issued = await (await call("/api/invoices/3/issue", { method: "POST" })).json() as { number: string };
  assert.equal(issued.number, `INV-${year}-0003`);

  assert.equal((await call("/api/invoices/2/status", { method: "POST", body: JSON.stringify({ status: "cancelled" }) })).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE reverses_entry_id IS NOT NULL").get()!.n, 1);

  const draft = await (await call("/api/invoices", { method: "POST", body: JSON.stringify({ party_id: 1 }) })).json() as { id: number };
  assert.equal((await call(`/api/invoices/${draft.id}`, { method: "DELETE" })).status, 200);

  const cleared = await call("/api/accounts", { method: "DELETE" });
  assert.equal(cleared.status, 409);
  assert.match(((await cleared.json()) as { error: string }).error, /posted journal entries/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get()!.n, 25);
});
