import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, test } from "node:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { initDB } from "../src/server/db";
import { setStatus } from "../src/server/domain/invoices";
import { trialBalance } from "../src/server/domain/journals";
import api from "../src/server/routes";

const actor = { actor: "regression-test", actor_kind: "user" as const };
let db: DatabaseSync;
let beforeQuery: ((sql: string) => void) | undefined;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../src/server/schema.sql", import.meta.url), "utf8"));
  beforeQuery = undefined;
  initDB({
    STORAGE: {
      async query(sql: string, params: (string | number | null)[] = []) {
        beforeQuery?.(sql);
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
  beforeQuery = (sql) => {
    if (sql.includes("UPDATE journal_entries SET reversed_by_entry_id")) {
      throw new Error("crash before backlink");
    }
  };
  await assert.rejects(setStatus(1, "cancelled", actor), /crash before backlink/);
  assert.equal(db.prepare("SELECT status FROM journal_entries WHERE id = 2").get()?.status, "posted");
  assert.equal(db.prepare("SELECT reversed_by_entry_id FROM journal_entries WHERE id = 1").get()?.reversed_by_entry_id, null);
  beforeQuery = undefined;
  await setStatus(1, "cancelled", actor);
  await assertCancelledBooks();
  await setStatus(1, "cancelled", actor);
  await assertCancelledBooks();
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
