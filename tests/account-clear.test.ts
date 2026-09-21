import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, test } from "node:test";
import app from "../src/server/index";

let db: DatabaseSync;
let env: unknown;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(readFileSync(new URL("../src/server/schema.sql", import.meta.url), "utf8"));
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

async function seedAccounts() {
  assert.equal((await call("/api/accounts/seed", { method: "POST" })).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get()!.n, 25);
}

async function assertClearRefused() {
  const response = await call("/api/accounts", { method: "DELETE" });
  assert.equal(response.status, 409);
  assert.match(((await response.json()) as { error: string }).error, /products, invoice lines, or posted journal entries/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get()!.n, 25);
}

test("account clear succeeds when the chart is unused", async () => {
  await seedAccounts();
  assert.equal((await call("/api/accounts", { method: "DELETE" })).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get()!.n, 0);
});

test("account clear returns 409 when a product uses the chart", async () => {
  await seedAccounts();
  assert.equal((await call("/api/products", {
    method: "POST",
    body: JSON.stringify({ name: "Consulting", income_account: "WOmz" }),
  })).status, 201);
  await assertClearRefused();
});

test("account clear returns 409 when a draft invoice line uses the chart", async () => {
  await seedAccounts();
  const party = await (await call("/api/parties", {
    method: "POST",
    body: JSON.stringify({ name: "Example customer", kind: "customer" }),
  })).json() as { id: number };
  const invoice = await (await call("/api/invoices", {
    method: "POST",
    body: JSON.stringify({ party_id: party.id }),
  })).json() as { id: number };
  assert.equal((await call(`/api/invoices/${invoice.id}/lines`, {
    method: "POST",
    body: JSON.stringify({ description: "Consulting", account_code: "WOmz" }),
  })).status, 201);
  await assertClearRefused();
});
