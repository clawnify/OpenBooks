import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import app from "../src/server/index";
import starter from "../src/server/domain/rgs-starter.json";

for (const metadata of [false, true]) {
  test(`RGS seed reports inserted and replaced rows ${metadata ? "with" : "without"} storage metadata`, async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync(new URL("../src/server/schema.sql", import.meta.url), "utf8"));
    const env = { STORAGE: { query: async (sql: string, params: any[] = []) => {
      const statement = db.prepare(sql);
      let rows: any[] = [];
      let changes = 0;
      if (statement.columns().length) rows = statement.all(...params);
      else changes = Number(statement.run(...params).changes);
      return { rows, ...(metadata ? { meta: { changes } } : {}) };
    } } };
    const seed = async () => {
      const response = await app.request("/api/accounts/seed", { method: "POST" }, env as any);
      assert.equal(response.status, 200);
      return response.json();
    };
    try {
      const count = starter.accounts.length;
      assert.deepEqual(await seed(), { inserted: count, total: count });
      assert.equal(db.prepare("SELECT COUNT(*) n FROM accounts").get()!.n, count);

      // Reseeding replaces starter rows and leaves unrelated accounts alone.
      const account = starter.accounts[0];
      db.prepare("UPDATE accounts SET omskort = 'Changed' WHERE rgs_code = ?").run(account.rgs_code);
      db.exec("INSERT INTO accounts(rgs_code,nivo,omskort,bw) VALUES('Custom',1,'Custom account','B')");
      assert.deepEqual(await seed(), { inserted: count, total: count + 1 });
      assert.equal(db.prepare("SELECT omskort FROM accounts WHERE rgs_code = ?").get(account.rgs_code)!.omskort, account.omskort);
      assert.equal(db.prepare("SELECT omskort FROM accounts WHERE rgs_code = 'Custom'").get()!.omskort, "Custom account");
      assert.equal(db.prepare("SELECT COUNT(*) n FROM accounts").get()!.n, count + 1);
    } finally {
      db.close();
    }
  });
}
