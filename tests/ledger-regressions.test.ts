import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, test } from "node:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { initDB } from "../src/server/db";
import { setStatus } from "../src/server/domain/invoices";
import { backfillFromInvoices, createFromInvoice, trialBalance } from "../src/server/domain/journals";
import { lockPeriod } from "../src/server/domain/periods";
import { LedgerError } from "../src/server/domain/errors";
import api from "../src/server/routes";

const actor = { actor: "regression-test", actor_kind: "user" as const };
let db: DatabaseSync;
let beforeQuery: ((sql: string) => void | Promise<void>) | undefined;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../src/server/schema.sql", import.meta.url), "utf8"));
  beforeQuery = undefined;
  initDB({
    STORAGE: {
      async query(sql: string, params: (string | number | null)[] = []) {
        await beforeQuery?.(sql);
        const statement = db.prepare(sql);
        if (statement.columns().length) return { rows: statement.all(...params), meta: {} };
        const result = statement.run(...params);
        return { rows: [], meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
      },
    },
  });
  db.exec(`
    INSERT INTO parties(id, kind, name) VALUES(1, 'customer', 'Test');
    INSERT INTO accounts(rgs_code, nivo, omskort, bw)
      VALUES('BVor', 1, 'Receivables', 'B'), ('WOmz', 1, 'Sales', 'W');
    INSERT INTO invoices(id, number, status, party_id, issue_date, subtotal_cents, total_cents)
      VALUES(1, 'INV-TEST', 'issued', 1, '2025-01-10', 10000, 10000);
    INSERT INTO journal_entries(id, reference, date, source_type, source_id)
      VALUES(1, 'INV-TEST', '2025-01-10', 'invoice', 1);
    INSERT INTO journal_lines(entry_id, position, account_code, debit_cents, credit_cents)
      VALUES(1, 1, 'BVor', 10000, 0), (1, 2, 'WOmz', 0, 10000);
  `);
});

afterEach(() => db.close());

async function assertCancelledBooks() {
  const balances = await trialBalance();
  assert.equal(balances.find((row) => row.account_code === "BVor")?.balance_cents, 0);
  assert.equal(balances.find((row) => row.account_code === "WOmz")?.balance_cents, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get()?.n, 2);
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id = 1").get()?.status, "cancelled");
  assert.equal(db.prepare("SELECT reversed_by_entry_id FROM journal_entries WHERE id = 1").get()?.reversed_by_entry_id, 2);
}

test("repeated cancellation keeps the original and a single reversal netted to zero", async () => {
  await setStatus(1, "cancelled", actor);
  await assertCancelledBooks();
  await setStatus(1, "cancelled", actor);
  await assertCancelledBooks();
});

test("retry after a posted reversal repairs the backlink without reversing the reversal", async () => {
  // Legacy data from before reversal publication and its backlink were atomic.
  db.exec(`INSERT INTO journal_entries(id, reference, date, source_type, source_id, reverses_entry_id)
    VALUES(2, 'INV-TEST', '2025-01-10', 'invoice', 1, 1);
    INSERT INTO journal_lines(entry_id, position, account_code, debit_cents, credit_cents)
      VALUES(2, 1, 'BVor', 0, 10000), (2, 2, 'WOmz', 10000, 0);`);
  assert.equal(db.prepare("SELECT status FROM journal_entries WHERE id = 2").get()?.status, "posted");
  assert.equal(db.prepare("SELECT reversed_by_entry_id FROM journal_entries WHERE id = 1").get()?.reversed_by_entry_id, null);
  beforeQuery = undefined;
  await setStatus(1, "cancelled", actor);
  await assertCancelledBooks();
  await setStatus(1, "cancelled", actor);
  await assertCancelledBooks();
});

test("20 concurrent cancellations produce one reversal and retain the winning actor", async () => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => setStatus(1, "cancelled", {
    actor: `actor-${i}`, actor_kind: i % 2 ? "agent" : "user",
  })));
  await assertCancelledBooks();
  const audit = db.prepare("SELECT actor, actor_kind, action FROM audit_log ORDER BY id").all();
  assert.equal(audit.length, 2);
  assert.deepEqual(audit.map((row) => row.action), ["journal.reverse", "invoice.status"]);
  assert.equal(audit[0].actor, audit[1].actor);
  assert.equal(audit[0].actor_kind, audit[1].actor_kind);
});

for (const fault of [
  "BEFORE INSERT ON journal_entries WHEN NEW.reverses_entry_id IS NOT NULL",
  "BEFORE INSERT ON journal_lines WHEN NEW.entry_id <> 1",
  "BEFORE UPDATE OF status ON journal_entries WHEN NEW.status = 'posted'",
  "BEFORE UPDATE OF reversed_by_entry_id ON journal_entries",
  "BEFORE INSERT ON audit_log WHEN NEW.action = 'journal.reverse'",
  "BEFORE INSERT ON audit_log WHEN NEW.action = 'invoice.status'",
]) {
  test(`cancellation rolls back all effects on ${fault}`, async () => {
    db.exec(`CREATE TRIGGER inject_fault ${fault} BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`);
    await assert.rejects(setStatus(1, "cancelled", actor), /injected failure/);
    assert.equal(db.prepare("SELECT status FROM invoices WHERE id = 1").get()?.status, "issued");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get()?.n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM journal_lines").get()?.n, 2);
    assert.equal(db.prepare("SELECT reversed_by_entry_id FROM journal_entries WHERE id = 1").get()?.reversed_by_entry_id, null);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log").get()?.n, 0);
    db.exec("DROP TRIGGER inject_fault");
    await setStatus(1, "cancelled", actor);
    await assertCancelledBooks();
  });
}

test("a lock committed while cancellation waits keeps the closed month's balance", async () => {
  let entered!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const resume = new Promise<void>((resolve) => { release = resolve; });
  beforeQuery = async (sql) => {
    if (sql.includes("UPDATE invoices SET status")) {
      entered();
      await resume;
    }
  };
  const cancelling = setStatus(1, "cancelled", actor);
  await ready;
  await lockPeriod(2025, 1, actor);
  const locked = await trialBalance({ from: "2025-01-01", to: "2025-01-31" });
  release();
  await cancelling;
  assert.deepEqual(await trialBalance({ from: "2025-01-01", to: "2025-01-31" }), locked);
  assert.equal(db.prepare("SELECT date FROM journal_entries WHERE id = 2").get()?.date, new Date().toISOString().slice(0, 10));
  await assertCancelledBooks();
});

test("lock audit failure rolls back the lock, and concurrent retries audit once", async () => {
  db.exec("CREATE TRIGGER inject_fault BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
  await assert.rejects(lockPeriod(2025, 1, actor), /injected failure/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM periods").get()?.n, 0);
  db.exec("DROP TRIGGER inject_fault");
  await Promise.all(Array.from({ length: 20 }, () => lockPeriod(2025, 1, actor)));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM periods").get()?.n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log").get()?.n, 1);
});

test("cancelled invoices cannot become sent or paid, including a stale concurrent request", async () => {
  await Promise.all([setStatus(1, "cancelled", actor), assert.rejects(setStatus(1, "paid", actor), LedgerError)]);
  await assert.rejects(setStatus(1, "sent", actor), LedgerError);
  await assert.rejects(setStatus(1, "paid", actor), LedgerError);
  await assertCancelledBooks();
});

function unpostedInvoice() {
  db.exec(`DELETE FROM journal_lines; DELETE FROM journal_entries;
    INSERT INTO invoice_lines(invoice_id, position, description, subtotal_cents, total_cents, vat_cents)
      VALUES(1, 1, 'Work', 10000, 10000, 0);`);
}

test("concurrent backfill publishes one complete original and one audit", async () => {
  unpostedInvoice();
  await Promise.all(Array.from({ length: 20 }, () => backfillFromInvoices(actor)));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get()?.n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM journal_lines").get()?.n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log").get()?.n, 1);
  assert.equal((await trialBalance()).find((row) => row.account_code === "BVor")?.balance_cents, 10000);
  assert.equal(await createFromInvoice(1, actor), undefined);
});

for (const action of ["BEFORE INSERT ON journal_lines", "BEFORE INSERT ON audit_log"]) {
  test(`original publication rolls back on ${action}`, async () => {
    unpostedInvoice();
    db.exec(`CREATE TRIGGER inject_fault ${action} BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`);
    await assert.rejects(createFromInvoice(1, actor), /injected failure/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get()?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM journal_lines").get()?.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log").get()?.n, 0);
    db.exec("DROP TRIGGER inject_fault");
    assert.equal((await createFromInvoice(1, actor))?.status, "posted");
  });
}

for (const date of ["2025-02-29", "2024-02-30", "2025-13-01", "2025-1-01", "2025-01-01T00:00:00Z", "1899-12-31"]) {
  test(`publication refuses invalid accounting date ${date}`, async () => {
    unpostedInvoice();
    db.prepare("UPDATE invoices SET issue_date = ? WHERE id = 1").run(date);
    await assert.rejects(createFromInvoice(1, actor), LedgerError);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get()?.n, 0);
  });
}

test("a lock committed while posting waits prevents any publication", async () => {
  unpostedInvoice();
  let entered!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const resume = new Promise<void>((resolve) => { release = resolve; });
  beforeQuery = async (sql) => {
    if (sql.includes("INSERT INTO journal_entries")) { entered(); await resume; }
  };
  const posting = createFromInvoice(1, actor);
  await ready;
  await lockPeriod(2025, 1, actor);
  release();
  await assert.rejects(posting, LedgerError);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get()?.n, 0);
});

for (const mounted of [false, true]) {
  test(`DELETE issued invoice returns 409 JSON (${mounted ? "mounted" : "direct"} API)`, async () => {
    const app = mounted ? new Hono().route("/", api) : api;
    const response = await app.request("/api/invoices/1", { method: "DELETE" });
    assert.equal(response.status, 409);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await response.json(), {
      error: "Invoice INV-TEST is issued and cannot be deleted. Cancel it instead -- that reverses its journal entry and leaves both on the record.",
    });
    assert.equal(db.prepare("SELECT status FROM invoices WHERE id = 1").get()?.status, "issued");
  });

  test(`unexpected errors retain generic 500 response (${mounted ? "mounted" : "direct"} API)`, async () => {
    beforeQuery = () => { throw new Error("private storage failure"); };
    const app = mounted ? new Hono().route("/", api) : api;
    const response = await app.request("/api/invoices/1", { method: "DELETE" });
    assert.equal(response.status, 500);
    assert.equal(await response.text(), "Internal Server Error");
  });

  test(`HTTPException retains its response (${mounted ? "mounted" : "direct"} API)`, async () => {
    beforeQuery = () => {
      throw new HTTPException(503, {
        res: new Response("Storage unavailable", { status: 503, headers: { "Retry-After": "30" } }),
      });
    };
    const app = mounted ? new Hono().route("/", api) : api;
    const response = await app.request("/api/invoices/1", { method: "DELETE" });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "30");
    assert.equal(await response.text(), "Storage unavailable");
  });
}
