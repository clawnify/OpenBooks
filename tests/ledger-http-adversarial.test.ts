import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import app from "../src/server/index";

const schema = readFileSync(
  new URL("../src/server/schema.sql", import.meta.url),
  "utf8",
);

// Exercise actual HTTP handlers against the metadata-less STORAGE contract.
// Production Facet query() returns rows but not lastInsertRowid metadata.
function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  const q = async (sql: string, params: any[] = []) => {
    const statement = db.prepare(sql);
    if (statement.columns().length) return statement.all(...params) as any[];
    statement.run(...params);
    return [];
  };
  const env = {
    STORAGE: {
      query: async (sql: string, params: any[] = []) => ({
        rows: await q(sql, params),
      }),
    },
  };
  db.exec(
    "INSERT INTO accounts(rgs_code,nivo,omskort,bw) VALUES('BVor',1,'AR','B'),('WOmz',1,'Sales','W'),('BKas',1,'VAT','B'); INSERT INTO parties(id,kind,name) VALUES(1,'customer','Fixture'); INSERT INTO company(id,name,country) VALUES(1,'Fixture','NL');",
  );
  const req = async (
    path,
    method = "POST",
    data: any = undefined,
    actor = "user",
  ) => {
    const r = await app.request(
      path,
      {
        method,
        headers: {
          "content-type": "application/json",
          "X-Clawnify-Caller": actor,
          "X-Clawnify-User-Id": actor === "agent" ? "agent-id" : "user-id",
          "X-Clawnify-User-Email": actor + "@test.invalid",
        },
        ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
      },
      env,
    );
    const text = await r.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: r.status, body };
  };
  const draft = async ({
    id = 1,
    type = "invoice",
    date = "2025-01-10",
    amount = 10000,
    vat = 0,
  } = {}) => {
    await q(
      "INSERT INTO invoices(id,type,status,party_id,issue_date,subtotal_cents,vat_cents,total_cents) VALUES(?,?,'draft',1,?,?,?,?)",
      [id, type, date, amount, vat, amount + vat],
    );
    await q(
      "INSERT INTO invoice_lines(invoice_id,position,description,quantity,unit_price_cents,vat_rate,account_code,subtotal_cents,vat_cents,total_cents) VALUES(?,1,'Work',1,?,0,'WOmz',?,?,?)",
      [id, amount, amount, vat, amount + vat],
    );
  };
  const issue = (id = 1, actor = "user") =>
    req(`/api/invoices/${id}/issue`, "POST", undefined, actor);
  const cancel = (id = 1, actor = "user") =>
    req(`/api/invoices/${id}/status`, "POST", { status: "cancelled" }, actor);
  const ar = async (from = "", to = "9999-12-31") =>
    (
      await q(
        "SELECT COALESCE(SUM(l.debit_cents-l.credit_cents),0) n FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE e.status='posted' AND l.account_code='BVor' AND e.date>=? AND e.date<=?",
        [from, to],
      )
    )[0].n;
  const snapshot = async () => {
    const out = {};
    for (const t of [
      "invoices",
      "invoice_lines",
      "journal_entries",
      "journal_lines",
      "periods",
      "audit_log",
      "numbering_sequences",
    ])
      out[t] = await q("SELECT * FROM " + t);
    return out;
  };
  const fault = async (condition = "1") =>
    q(
      `CREATE TRIGGER review_fault BEFORE INSERT ON audit_log WHEN ${condition} BEGIN SELECT RAISE(ABORT,'review:fault'); END`,
    );
  return {
    q,
    req,
    draft,
    issue,
    cancel,
    ar,
    snapshot,
    fault,
    env,
    close: () => db.close(),
  };
}
function check(
  name: string,
  run: (fixture: ReturnType<typeof setup>) => Promise<void>,
) {
  test(name, async () => {
    const fixture = setup();
    try {
      await run(fixture);
    } finally {
      fixture.close();
    }
  });
}
check("invoice issue has balanced complete ledger and audits", async (t) => {
  await t.draft();
  const r = await t.issue();
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(await t.ar(), 10000);
  assert.equal(
    (await t.q("SELECT SUM(debit_cents-credit_cents) n FROM journal_lines"))[0]
      .n,
    0,
  );
  assert.equal(
    (
      await t.q("SELECT COUNT(*) n FROM journal_entries WHERE status='posted'")
    )[0].n,
    1,
  );
  for (const action of ["invoice.issue", "journal.post"])
    assert.equal(
      (
        await t.q("SELECT COUNT(*) n FROM audit_log WHERE action=?", [action])
      )[0].n,
      1,
    );
});
check("credit note and quote have correct financial scope", async (t) => {
  await t.draft({ type: "credit_note" });
  assert.equal((await t.issue()).status, 200);
  assert.equal(await t.ar(), -10000);
  await t.draft({ id: 2, type: "quote" });
  assert.equal((await t.issue(2)).status, 200);
  assert.equal(
    (await t.q("SELECT COUNT(*) n FROM journal_entries WHERE source_id=2"))[0]
      .n,
    0,
  );
});
check("sequential cancellation retry is a true no-op", async (t) => {
  await t.draft();
  assert.equal((await t.issue()).status, 200);
  assert.equal((await t.cancel()).status, 200);
  assert.equal(await t.ar(), 0);
  const s = await t.snapshot();
  assert.equal((await t.cancel()).status, 200);
  assert.deepEqual(await t.snapshot(), s);
});
check(
  "20 parallel cancellations have one winner and consistent audit actor",
  async (t) => {
    await t.draft();
    await t.issue();
    const rs = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        t.cancel(1, i % 2 ? "agent" : "user"),
      ),
    );
    assert.ok(
      rs.every((r) => r.status === 200),
      JSON.stringify(rs),
    );
    assert.equal(await t.ar(), 0);
    assert.equal(
      (
        await t.q(
          "SELECT COUNT(*) n FROM journal_entries WHERE reverses_entry_id IS NOT NULL",
        )
      )[0].n,
      1,
    );
    const a = await t.q(
      "SELECT actor,actor_kind FROM audit_log WHERE action IN ('journal.reverse','invoice.status')",
    );
    assert.equal(a.length, 2);
    assert.equal(a[0].actor, a[1].actor);
    assert.equal(a[0].actor_kind, a[1].actor_kind);
  },
);
check(
  "journal reversal audit failure rolls back entire cancellation",
  async (t) => {
    await t.draft();
    await t.issue();
    await t.fault("NEW.action='journal.reverse'");
    const s = await t.snapshot();
    assert.equal((await t.cancel()).status, 500);
    assert.deepEqual(await t.snapshot(), s);
  },
);
check(
  "final invoice audit failure rolls back earlier journal effects/audits",
  async (t) => {
    await t.draft();
    await t.issue();
    await t.fault("NEW.action='invoice.status'");
    const s = await t.snapshot();
    assert.equal((await t.cancel()).status, 500);
    assert.deepEqual(await t.snapshot(), s);
  },
);
check("mirror-line fault rolls back cancellation", async (t) => {
  await t.draft();
  await t.issue();
  await t.q(
    "CREATE TRIGGER review_line_fault BEFORE INSERT ON journal_lines WHEN NEW.entry_id<>(SELECT MIN(id) FROM journal_entries) BEGIN SELECT RAISE(ABORT,'review:line'); END",
  );
  const s = await t.snapshot();
  assert.equal((await t.cancel()).status, 500);
  assert.deepEqual(await t.snapshot(), s);
});
check("cancelled document cannot return to paid/sent", async (t) => {
  await t.draft();
  await t.issue();
  await t.cancel();
  const s = await t.snapshot();
  for (const status of ["sent", "paid", "issued", "draft"])
    assert.equal(
      (await t.req("/api/invoices/1/status", "POST", { status })).status,
      409,
    );
  assert.deepEqual(await t.snapshot(), s);
});
check(
  "locking old month moves reversal to today without changing old balances",
  async (t) => {
    await t.draft();
    await t.issue();
    assert.equal((await t.req("/api/periods/2025/1/lock")).status, 200);
    const old = await t.ar("2025-01-01", "2025-01-31");
    assert.equal((await t.cancel()).status, 200);
    assert.equal(await t.ar("2025-01-01", "2025-01-31"), old);
    assert.equal(await t.ar(), 0);
  },
);
check(
  "parallel lock/cancel leaves closed period stable after both complete",
  async (t) => {
    await t.draft();
    await t.issue();
    const rs = await Promise.all([
      t.req("/api/periods/2025/1/lock"),
      t.cancel(),
    ]);
    assert.ok(
      rs.every((r) => r.status === 200),
      JSON.stringify(rs),
    );
    const old = await t.ar("2025-01-01", "2025-01-31");
    assert.ok([0, 10000].includes(old));
    await t.cancel();
    assert.equal(await t.ar("2025-01-01", "2025-01-31"), old);
    assert.equal(await t.ar(), 0);
  },
);
check("lock audit failure does not leave lock behind", async (t) => {
  await t.fault("NEW.action='period.lock'");
  const s = await t.snapshot();
  assert.equal((await t.req("/api/periods/2025/1/lock")).status, 500);
  assert.deepEqual(await t.snapshot(), s);
});
check("20 concurrent locks are idempotent and have one audit", async (t) => {
  const rs = await Promise.all(
    Array.from({ length: 20 }, () => t.req("/api/periods/2025/1/lock")),
  );
  assert.ok(
    rs.every((r) => r.status === 200),
    JSON.stringify(rs),
  );
  assert.equal((await t.q("SELECT COUNT(*) n FROM periods"))[0].n, 1);
  assert.equal(
    (
      await t.q("SELECT COUNT(*) n FROM audit_log WHERE action='period.lock'")
    )[0].n,
    1,
  );
});
check(
  "closed period refuses issue without numbering or status effects",
  async (t) => {
    await t.draft();
    await t.req("/api/periods/2025/1/lock");
    const s = await t.snapshot();
    assert.equal((await t.issue()).status, 409);
    assert.deepEqual(await t.snapshot(), s);
  },
);
check("invalid raw dates cannot issue or bypass period lock", async (t) => {
  await t.req("/api/periods/2025/1/lock");
  for (const [i, date] of [
    "2025-1-10",
    "2025-02-30",
    "2025-01-10T00:00:00",
    "junk",
    "0000-01-01",
    "2025-13-01",
  ].entries()) {
    await t.draft({ id: i + 1, date });
    const s = await t.snapshot();
    assert.equal((await t.issue(i + 1)).status, 409, date);
    assert.deepEqual(await t.snapshot(), s, date);
  }
});
check("journal-post audit failure restores draft and numbering", async (t) => {
  await t.draft();
  await t.fault("NEW.action='journal.post'");
  const s = await t.snapshot();
  assert.equal((await t.issue()).status, 500);
  assert.deepEqual(await t.snapshot(), s);
});
check("final issue audit failure restores all issue effects", async (t) => {
  await t.draft();
  await t.fault("NEW.action='invoice.issue'");
  const s = await t.snapshot();
  assert.equal((await t.issue()).status, 500);
  assert.deepEqual(await t.snapshot(), s);
});
check(
  "20 parallel issues publish one entry and one invoice number",
  async (t) => {
    await t.draft();
    const rs = await Promise.all(Array.from({ length: 20 }, () => t.issue()));
    assert.ok(
      rs.every((r) => r.status === 200),
      JSON.stringify(rs),
    );
    assert.equal(
      (
        await t.q(
          "SELECT COUNT(*) n FROM journal_entries WHERE status='posted' AND reverses_entry_id IS NULL",
        )
      )[0].n,
      1,
    );
    assert.equal(
      (await t.q("SELECT next_number FROM numbering_sequences"))[0].next_number,
      2,
    );
  },
);
check(
  "issued deletion refuses with JSON 409 and draft deletion audit failure rolls back",
  async (t) => {
    await t.draft();
    await t.issue();
    const r = await t.req("/api/invoices/1", "DELETE");
    assert.equal(r.status, 409);
    assert.equal(typeof r.body.error, "string");
    await t.draft({ id: 2 });
    await t.fault("NEW.action='invoice.delete'");
    const s = await t.snapshot();
    assert.equal((await t.req("/api/invoices/2", "DELETE")).status, 500);
    assert.deepEqual(await t.snapshot(), s);
  },
);
check("status audit failure preserves old status", async (t) => {
  await t.draft();
  await t.issue();
  await t.fault("NEW.action='invoice.status'");
  const s = await t.snapshot();
  assert.equal(
    (await t.req("/api/invoices/1/status", "POST", { status: "paid" })).status,
    500,
  );
  assert.deepEqual(await t.snapshot(), s);
});
check(
  "backfill concurrent retries publish a legacy issued invoice once",
  async (t) => {
    await t.draft();
    /* Seed legacy issued fixture without firing issue trigger. */ const issueTriggers =
      await t.q(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='invoices'",
      );
    for (const x of issueTriggers)
      await t.q("DROP TRIGGER " + JSON.stringify(x.name));
    await t.q(
      "UPDATE invoices SET status='issued',number='INV-LEGACY' WHERE id=1",
    );
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => t.req("/api/journals/backfill")),
    );
    assert.ok(
      rs.every((r) => r.status === 200),
      JSON.stringify(rs),
    );
    assert.equal(
      (
        await t.q(
          "SELECT COUNT(*) n FROM journal_entries WHERE status='posted' AND reverses_entry_id IS NULL",
        )
      )[0].n,
      1,
    );
    assert.equal(await t.ar(), 10000);
  },
);

for (const race of [
  {
    name: "document update",
    path: "/api/invoices/1",
    method: "PATCH",
    body: { notes: "late edit" },
    sql: "UPDATE invoices SET notes =",
  },
  {
    name: "line insert",
    path: "/api/invoices/1/lines",
    method: "POST",
    body: { description: "late line", unit_price_cents: 5000 },
    sql: "INSERT INTO invoice_lines",
  },
  {
    name: "line update",
    path: "/api/lines/1",
    method: "PATCH",
    body: { description: "late edit" },
    sql: "UPDATE invoice_lines SET description =",
  },
  {
    name: "line delete",
    path: "/api/lines/1",
    method: "DELETE",
    body: undefined,
    sql: "DELETE FROM invoice_lines WHERE id =",
  },
]) {
  check(
    `a ${race.name} that passed its draft check cannot write after issue`,
    async (t) => {
      await t.draft();
      let release!: () => void;
      let signal!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        signal = resolve;
      });
      let once = true;
      const original = t.env.STORAGE.query;
      t.env.STORAGE.query = async (sql, params = []) => {
        if (once && sql.trimStart().startsWith(race.sql)) {
          once = false;
          signal();
          await held;
        }
        return original(sql, params);
      };
      const editing = t.req(race.path, race.method, race.body);
      await entered;
      let issuedState;
      try {
        assert.equal((await t.issue()).status, 200);
        issuedState = await t.snapshot();
      } finally {
        release();
      }
      const refusal = await editing;
      assert.equal(refusal.status, 409, JSON.stringify(refusal));
      assert.deepEqual(await t.snapshot(), issuedState);
    },
  );
}
