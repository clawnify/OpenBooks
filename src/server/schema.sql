CREATE TABLE IF NOT EXISTS accounts (
  rgs_code TEXT PRIMARY KEY,
  reknr TEXT,
  parent_code TEXT,
  nivo INTEGER NOT NULL,
  omskort TEXT NOT NULL,
  omslang TEXT,
  dc TEXT,
  bw TEXT NOT NULL,
  sortimentcode TEXT,
  is_leaf INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_code);
CREATE INDEX IF NOT EXISTS idx_accounts_nivo ON accounts(nivo);
CREATE INDEX IF NOT EXISTS idx_accounts_bw ON accounts(bw);

CREATE TABLE IF NOT EXISTS parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('customer','supplier','both')),
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  vat_number TEXT,
  chamber_number TEXT,
  country TEXT NOT NULL DEFAULT 'NL',
  address_line1 TEXT,
  address_line2 TEXT,
  postal_code TEXT,
  city TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  iban TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_parties_kind ON parties(kind);
CREATE INDEX IF NOT EXISTS idx_parties_country ON parties(country);
CREATE INDEX IF NOT EXISTS idx_parties_name ON parties(name);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('good','service')) DEFAULT 'service',
  sku TEXT,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  vat_rate REAL NOT NULL DEFAULT 21,
  unit TEXT NOT NULL DEFAULT 'unit',
  income_account TEXT,
  expense_account TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (income_account) REFERENCES accounts(rgs_code),
  FOREIGN KEY (expense_account) REFERENCES accounts(rgs_code)
);

CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
CREATE INDEX IF NOT EXISTS idx_products_kind ON products(kind);

CREATE TABLE IF NOT EXISTS numbering_sequences (
  scope TEXT NOT NULL,
  year INTEGER NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1,
  prefix TEXT NOT NULL,
  PRIMARY KEY (scope, year)
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('invoice','credit_note','quote')) DEFAULT 'invoice',
  status TEXT NOT NULL CHECK (status IN ('draft','issued','sent','paid','cancelled')) DEFAULT 'draft',
  party_id INTEGER NOT NULL,
  issue_date TEXT,
  due_date TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  fx_rate REAL NOT NULL DEFAULT 1,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  vat_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  reverse_charge INTEGER NOT NULL DEFAULT 0,
  mutation_actor TEXT,
  mutation_actor_kind TEXT,
  reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (party_id) REFERENCES parties(id)
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  product_id INTEGER,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'unit',
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 21,
  account_code TEXT,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  vat_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (account_code) REFERENCES accounts(rgs_code)
);

CREATE INDEX IF NOT EXISTS idx_invoices_party ON invoices(party_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_type ON invoices(type);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_lines_invoice ON invoice_lines(invoice_id);

CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'My Company',
  vat_number TEXT,
  chamber_number TEXT,
  country TEXT NOT NULL DEFAULT 'NL',
  address_line1 TEXT,
  postal_code TEXT,
  city TEXT,
  email TEXT,
  iban TEXT,
  default_currency TEXT NOT NULL DEFAULT 'EUR',
  default_due_days INTEGER NOT NULL DEFAULT 30,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The singleton company row is created by the app (ensureCompanyRow in
-- src/server/domain/company.ts): a deploy applies this file as DDL only.

-- A posted entry is never deleted or edited. A correction is a second,
-- mirror-image entry (a Storno): both stay `posted` and net to zero, so the
-- trial balance stays right while the history stays complete. The pair is
-- linked by reverses_entry_id / reversed_by_entry_id -- there is deliberately
-- no 'reversed' status, because dropping the original out of the
-- `status = 'posted'` reports would subtract the same amount twice.
CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL,
  description TEXT,
  date TEXT NOT NULL,
  source_type TEXT,
  source_id INTEGER,
  -- Triggers publish pending entries with their lines and audit in one statement.
  status TEXT NOT NULL DEFAULT 'posted',
  reverses_entry_id INTEGER REFERENCES journal_entries(id),
  reversed_by_entry_id INTEGER REFERENCES journal_entries(id),
  mutation_actor TEXT,
  mutation_actor_kind TEXT,
  posted_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  account_code TEXT NOT NULL,
  description TEXT,
  debit_cents INTEGER NOT NULL DEFAULT 0,
  credit_cents INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (account_code) REFERENCES accounts(rgs_code)
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON journal_entries(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_code);

CREATE INDEX IF NOT EXISTS idx_journal_entries_reverses ON journal_entries(reverses_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_reversed_by ON journal_entries(reversed_by_entry_id);

-- A locked period is closed for good: nothing may be posted into it again.
-- Locking is one-way on purpose -- an "unlock" would make every lock a
-- suggestion, and the point of the lock is that it is not one.
CREATE TABLE IF NOT EXISTS periods (
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  locked_at TEXT NOT NULL DEFAULT (datetime('now')),
  locked_by TEXT,
  locked_by_kind TEXT,
  PRIMARY KEY (year, month)
);

-- Append-only record of everything that touched the books, and who did it.
-- actor_kind comes straight from the platform's caller() -- 'user' and 'api'
-- are a person, 'agent' and 'agent-browser' are the org's agent acting on its
-- own, which is exactly the distinction an auditor asks about.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT,
  actor_kind TEXT NOT NULL DEFAULT 'public',
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  before_json TEXT,
  after_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity, entity_id);

-- These constraints deliberately refuse a migration over duplicate historical
-- postings; repairing those books requires an explicit accounting decision.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_posted_reversal_v1
  ON journal_entries(reverses_entry_id)
  WHERE status = 'posted' AND reverses_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_active_original_v1
  ON journal_entries(source_type, source_id)
  WHERE status = 'posted' AND reverses_entry_id IS NULL
    AND reversed_by_entry_id IS NULL AND source_type IN ('invoice','credit_note');

-- SQLite runs each initiating statement and its trigger effects atomically,
-- including through the platform's single-query Storage binding. Date and lock
-- checks belong here so a concurrent lock cannot pass a stale application check.
CREATE TRIGGER IF NOT EXISTS ledger_entry_insert_guard_v1
BEFORE INSERT ON journal_entries
BEGIN
  SELECT RAISE(ABORT, 'ledger:invalid-date')
    WHERE NEW.date IS NULL
       OR NEW.date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
       OR NEW.date < '1900-01-01' OR date(NEW.date, '+0 days') IS NOT NEW.date;
  SELECT RAISE(ABORT, 'ledger:period-locked') WHERE EXISTS (
    SELECT 1 FROM periods
    WHERE year = CAST(substr(NEW.date, 1, 4) AS INTEGER)
      AND month = CAST(substr(NEW.date, 6, 2) AS INTEGER)
  );
END;

CREATE TRIGGER IF NOT EXISTS ledger_entry_publish_guard_v1
BEFORE UPDATE OF status ON journal_entries
WHEN NEW.status = 'posted' AND OLD.status <> 'posted'
BEGIN
  SELECT RAISE(ABORT, 'ledger:invalid-date')
    WHERE NEW.date IS NULL
       OR NEW.date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
       OR NEW.date < '1900-01-01' OR date(NEW.date, '+0 days') IS NOT NEW.date;
  SELECT RAISE(ABORT, 'ledger:period-locked') WHERE EXISTS (
    SELECT 1 FROM periods
    WHERE year = CAST(substr(NEW.date, 1, 4) AS INTEGER)
      AND month = CAST(substr(NEW.date, 6, 2) AS INTEGER)
  );
  SELECT RAISE(ABORT, 'ledger:unbalanced-entry')
    WHERE NOT EXISTS (SELECT 1 FROM journal_lines WHERE entry_id = NEW.id)
       OR (SELECT SUM(debit_cents - credit_cents) FROM journal_lines WHERE entry_id = NEW.id) <> 0;
  SELECT RAISE(ABORT, 'ledger:invalid-source')
    WHERE NEW.reverses_entry_id IS NULL AND NEW.source_type IN ('invoice','credit_note')
      AND NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW.source_id AND type = NEW.source_type
        AND number = NEW.reference AND COALESCE(issue_date, date('now')) = NEW.date
        AND status IN ('issued','sent','paid'));
END;

CREATE TRIGGER IF NOT EXISTS ledger_reverse_insert_v1
AFTER INSERT ON journal_entries
WHEN NEW.reverses_entry_id IS NOT NULL AND NEW.status = 'pending'
BEGIN
  SELECT RAISE(ABORT, 'ledger:invalid-original') WHERE NOT EXISTS (
    SELECT 1 FROM journal_entries WHERE id = NEW.reverses_entry_id
      AND status = 'posted' AND reverses_entry_id IS NULL AND reversed_by_entry_id IS NULL
      AND source_type = NEW.source_type AND source_id = NEW.source_id
      AND date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date >= '1900-01-01' AND date(date, '+0 days') IS date
  );
  INSERT INTO journal_lines(entry_id, position, account_code, description, debit_cents, credit_cents)
    SELECT NEW.id, position, account_code, trim('Reversal ' || COALESCE(description, '')),
      credit_cents, debit_cents FROM journal_lines WHERE entry_id = NEW.reverses_entry_id;
  UPDATE journal_entries SET status = 'posted' WHERE id = NEW.id;
  UPDATE journal_entries SET reversed_by_entry_id = NEW.id WHERE id = NEW.reverses_entry_id;
  INSERT INTO audit_log(actor, actor_kind, action, entity, entity_id, after_json)
    VALUES(NEW.mutation_actor, COALESCE(NEW.mutation_actor_kind, 'system'),
      'journal.reverse', 'journal_entry', NEW.reverses_entry_id,
      json_object('reversed_by_entry_id', NEW.id, 'date', NEW.date));
END;

-- Ordinary posting is idempotent. Issuing/backfill insert a pending header only
-- when no posted original exists; the trigger derives every line from the same
-- database snapshot and publishes only a complete, balanced entry.
CREATE TRIGGER IF NOT EXISTS ledger_original_insert_v1
AFTER INSERT ON journal_entries
WHEN NEW.reverses_entry_id IS NULL AND NEW.status = 'pending'
  AND NEW.source_type IN ('invoice','credit_note')
BEGIN
  SELECT RAISE(ABORT, 'ledger:invalid-source') WHERE NOT EXISTS (
    SELECT 1 FROM invoices WHERE id = NEW.source_id AND type = NEW.source_type
      AND number = NEW.reference AND COALESCE(issue_date, date('now')) = NEW.date
      AND status IN ('issued','sent','paid')
  );
  SELECT RAISE(ABORT, 'ledger:empty-invoice')
    WHERE NOT EXISTS (SELECT 1 FROM invoice_lines WHERE invoice_id = NEW.source_id);
  INSERT INTO journal_lines(entry_id, position, account_code, description, debit_cents, credit_cents)
    SELECT NEW.id, 1, 'BVor', 'Invoice ' || number, total_cents, 0
      FROM invoices WHERE id = NEW.source_id AND type = 'invoice'
    UNION ALL SELECT NEW.id, 1, 'BVor', 'Credit ' || number, 0, total_cents
      FROM invoices WHERE id = NEW.source_id AND type = 'credit_note';
  INSERT INTO journal_lines(entry_id, position, account_code, description, debit_cents, credit_cents)
    SELECT NEW.id, 1 + ROW_NUMBER() OVER (ORDER BY COALESCE(NULLIF(account_code, ''), 'WOmz')),
      COALESCE(NULLIF(account_code, ''), 'WOmz'), 'Revenue ' || NEW.reference, 0, SUM(subtotal_cents)
      FROM invoice_lines WHERE invoice_id = NEW.source_id AND NEW.source_type = 'invoice'
      GROUP BY COALESCE(NULLIF(account_code, ''), 'WOmz')
    UNION ALL
    SELECT NEW.id, 1 + ROW_NUMBER() OVER (ORDER BY COALESCE(NULLIF(account_code, ''), 'WOmz')),
      COALESCE(NULLIF(account_code, ''), 'WOmz'), 'Revenue reversal ' || NEW.reference, SUM(subtotal_cents), 0
      FROM invoice_lines WHERE invoice_id = NEW.source_id AND NEW.source_type = 'credit_note'
      GROUP BY COALESCE(NULLIF(account_code, ''), 'WOmz');
  INSERT INTO journal_lines(entry_id, position, account_code, description, debit_cents, credit_cents)
    SELECT NEW.id, (SELECT COUNT(*) + 1 FROM journal_lines WHERE entry_id = NEW.id),
      'BKas', 'VAT payable ' || NEW.reference, 0, SUM(vat_cents)
      FROM invoice_lines WHERE invoice_id = NEW.source_id AND NEW.source_type = 'invoice'
      HAVING SUM(vat_cents) > 0
    UNION ALL
    SELECT NEW.id, (SELECT COUNT(*) + 1 FROM journal_lines WHERE entry_id = NEW.id),
      'BKas', 'VAT reversal ' || NEW.reference, SUM(vat_cents), 0
      FROM invoice_lines WHERE invoice_id = NEW.source_id AND NEW.source_type = 'credit_note'
      HAVING SUM(vat_cents) > 0;
  UPDATE journal_entries SET status = 'posted' WHERE id = NEW.id;
  INSERT INTO audit_log(actor, actor_kind, action, entity, entity_id, after_json)
    VALUES(NEW.mutation_actor, COALESCE(NEW.mutation_actor_kind, 'system'),
      'journal.post', 'journal_entry', NEW.id,
      json_object('reference', NEW.reference, 'date', NEW.date, 'source_type', NEW.source_type, 'source_id', NEW.source_id));
END;

CREATE TRIGGER IF NOT EXISTS ledger_invoice_status_guard_v1
BEFORE UPDATE OF status ON invoices
WHEN OLD.status <> NEW.status
BEGIN
  SELECT RAISE(ABORT, 'ledger:invalid-transition')
    WHERE OLD.status = 'cancelled'
      OR (OLD.status <> 'draft' AND NEW.status NOT IN ('sent','paid','cancelled'))
      OR (OLD.status = 'draft' AND NEW.status <> 'issued');
END;

CREATE TRIGGER IF NOT EXISTS ledger_invoice_cancel_v1
AFTER UPDATE OF status ON invoices
WHEN NEW.status = 'cancelled' AND OLD.status <> 'cancelled'
BEGIN
  -- Repair the legacy crash window without fabricating a historical actor or
  -- reversal timestamp: this event records who repaired the backlink now.
  INSERT INTO audit_log(actor, actor_kind, action, entity, entity_id, after_json)
    SELECT NEW.mutation_actor, COALESCE(NEW.mutation_actor_kind, 'system'),
      'journal.recovery', 'journal_entry', e.id, json_object('reversed_by_entry_id', r.id)
      FROM journal_entries e JOIN journal_entries r ON r.reverses_entry_id = e.id AND r.status = 'posted'
      WHERE e.source_id = NEW.id AND e.source_type IN ('invoice','credit_note')
        AND e.status = 'posted' AND e.reverses_entry_id IS NULL AND e.reversed_by_entry_id IS NULL;
  UPDATE journal_entries SET reversed_by_entry_id = (
    SELECT r.id FROM journal_entries r WHERE r.reverses_entry_id = journal_entries.id AND r.status = 'posted'
  ) WHERE source_id = NEW.id AND source_type IN ('invoice','credit_note')
      AND status = 'posted' AND reverses_entry_id IS NULL AND reversed_by_entry_id IS NULL
      AND EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = journal_entries.id AND r.status = 'posted');
  INSERT INTO journal_entries(reference, description, date, source_type, source_id, status,
      reverses_entry_id, mutation_actor, mutation_actor_kind)
    SELECT reference, 'Reversal of ' || COALESCE(description, reference),
      COALESCE((SELECT date('now') FROM periods
        WHERE year = CAST(substr(e.date, 1, 4) AS INTEGER)
          AND month = CAST(substr(e.date, 6, 2) AS INTEGER)), e.date),
      source_type, source_id, 'pending', id, NEW.mutation_actor, NEW.mutation_actor_kind
      FROM journal_entries e WHERE source_id = NEW.id AND source_type IN ('invoice','credit_note')
        AND status = 'posted' AND reverses_entry_id IS NULL AND reversed_by_entry_id IS NULL;
  INSERT INTO audit_log(actor, actor_kind, action, entity, entity_id, before_json, after_json)
    VALUES(NEW.mutation_actor, COALESCE(NEW.mutation_actor_kind, 'system'), 'invoice.status', 'invoice', NEW.id,
      json_object('status', OLD.status), json_object('status', NEW.status));
END;

CREATE TRIGGER IF NOT EXISTS ledger_invoice_status_audit_v1
AFTER UPDATE OF status ON invoices
WHEN NEW.status IN ('sent','paid') AND OLD.status <> NEW.status
BEGIN
  INSERT INTO audit_log(actor, actor_kind, action, entity, entity_id, before_json, after_json)
    VALUES(NEW.mutation_actor, COALESCE(NEW.mutation_actor_kind, 'system'), 'invoice.status', 'invoice', NEW.id,
      json_object('status', OLD.status), json_object('status', NEW.status));
END;

CREATE TRIGGER IF NOT EXISTS ledger_period_guard_v1
BEFORE INSERT ON periods
BEGIN
  SELECT RAISE(ABORT, 'ledger:invalid-period')
    WHERE NEW.year < 1900 OR NEW.year > 9999 OR NEW.year <> CAST(NEW.year AS INTEGER)
      OR NEW.month NOT BETWEEN 1 AND 12 OR NEW.month <> CAST(NEW.month AS INTEGER);
  SELECT RAISE(ABORT, 'ledger:period-not-ended')
    WHERE printf('%04d-%02d', NEW.year, NEW.month) >= strftime('%Y-%m', 'now');
END;

CREATE TRIGGER IF NOT EXISTS ledger_period_audit_v1
AFTER INSERT ON periods
BEGIN
  INSERT INTO audit_log(actor, actor_kind, action, entity, after_json)
    VALUES(NEW.locked_by, COALESCE(NEW.locked_by_kind, 'system'), 'period.lock', 'period',
      json_object('year', NEW.year, 'month', NEW.month, 'locked_at', NEW.locked_at,
        'locked_by', NEW.locked_by, 'locked_by_kind', NEW.locked_by_kind));
END;

CREATE TRIGGER IF NOT EXISTS ledger_invoice_issue_v1
AFTER UPDATE OF status ON invoices
WHEN OLD.status = 'draft' AND NEW.status = 'issued'
BEGIN
  SELECT RAISE(ABORT, 'ledger:invalid-date')
    WHERE COALESCE(NEW.issue_date, date('now')) NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
       OR COALESCE(NEW.issue_date, date('now')) < '1900-01-01'
       OR date(COALESCE(NEW.issue_date, date('now')), '+0 days') IS NOT COALESCE(NEW.issue_date, date('now'));
  -- Numbering uses the current UTC year, including for a backdated document.
  INSERT INTO numbering_sequences(scope, year, next_number, prefix)
    SELECT NEW.type, CAST(strftime('%Y', 'now') AS INTEGER), 1, prefix FROM (
      SELECT 'invoice' AS scope, 'INV' AS prefix
      UNION ALL SELECT 'credit_note', 'CN'
      UNION ALL SELECT 'quote', 'Q'
    ) WHERE scope = NEW.type
    ON CONFLICT(scope, year) DO NOTHING;
  UPDATE numbering_sequences SET next_number = next_number + 1
    WHERE scope = NEW.type AND year = CAST(strftime('%Y', 'now') AS INTEGER);
  UPDATE invoices SET number = (SELECT prefix || '-' || year || '-' || printf('%04d', next_number - 1)
      FROM numbering_sequences WHERE scope = NEW.type AND year = CAST(strftime('%Y', 'now') AS INTEGER))
    WHERE id = NEW.id;
  INSERT INTO journal_entries(reference, description, date, source_type, source_id, status,
      mutation_actor, mutation_actor_kind)
    SELECT number, type || ' ' || number, issue_date, type, id, 'pending',
      NEW.mutation_actor, NEW.mutation_actor_kind
      FROM invoices WHERE id = NEW.id AND type IN ('invoice','credit_note');
  INSERT INTO audit_log(actor, actor_kind, action, entity, entity_id, before_json, after_json)
    SELECT NEW.mutation_actor, COALESCE(NEW.mutation_actor_kind, 'system'),
      'invoice.issue', 'invoice', id, json_object('status', OLD.status),
      json_object('id', id, 'number', number, 'type', type, 'status', status,
        'party_id', party_id, 'issue_date', issue_date, 'due_date', due_date,
        'currency', currency, 'fx_rate', fx_rate, 'subtotal_cents', subtotal_cents,
        'vat_cents', vat_cents, 'total_cents', total_cents, 'reverse_charge', reverse_charge,
        'reference', reference, 'notes', notes, 'created_at', created_at, 'updated_at', updated_at)
      FROM invoices WHERE id = NEW.id;
END;

-- An invoice.delete audit INSERT is the deletion command: its actor and
-- before-snapshot cannot be separated from the DELETE by another request.
CREATE TRIGGER IF NOT EXISTS ledger_invoice_delete_v1
AFTER INSERT ON audit_log
WHEN NEW.action = 'invoice.delete' AND NEW.entity = 'invoice'
BEGIN
  SELECT RAISE(ABORT, 'ledger:issued-delete')
    WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW.entity_id AND status = 'draft');
  DELETE FROM invoices WHERE id = NEW.entity_id;
END;

-- A draft edit that passed application validation may race an issue request.
-- Refuse its eventual write against the current status, not the old snapshot.
CREATE TRIGGER IF NOT EXISTS ledger_invoice_freeze_v1
BEFORE UPDATE ON invoices
WHEN OLD.status <> 'draft' AND (
  OLD.type IS NOT NEW.type OR OLD.party_id IS NOT NEW.party_id
  OR OLD.issue_date IS NOT NEW.issue_date OR OLD.due_date IS NOT NEW.due_date
  OR OLD.currency IS NOT NEW.currency OR OLD.fx_rate IS NOT NEW.fx_rate
  OR OLD.subtotal_cents IS NOT NEW.subtotal_cents OR OLD.vat_cents IS NOT NEW.vat_cents
  OR OLD.total_cents IS NOT NEW.total_cents OR OLD.reverse_charge IS NOT NEW.reverse_charge
  OR OLD.reference IS NOT NEW.reference OR OLD.notes IS NOT NEW.notes
)
BEGIN
  SELECT RAISE(ABORT, 'ledger:frozen-invoice');
END;

CREATE TRIGGER IF NOT EXISTS ledger_invoice_line_insert_guard_v1
BEFORE INSERT ON invoice_lines
WHEN EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND status <> 'draft')
BEGIN
  SELECT RAISE(ABORT, 'ledger:frozen-invoice');
END;

CREATE TRIGGER IF NOT EXISTS ledger_invoice_line_update_guard_v1
BEFORE UPDATE ON invoice_lines
WHEN EXISTS (SELECT 1 FROM invoices WHERE id IN (OLD.invoice_id, NEW.invoice_id) AND status <> 'draft')
BEGIN
  SELECT RAISE(ABORT, 'ledger:frozen-invoice');
END;

CREATE TRIGGER IF NOT EXISTS ledger_invoice_line_delete_guard_v1
BEFORE DELETE ON invoice_lines
WHEN EXISTS (SELECT 1 FROM invoices WHERE id = OLD.invoice_id AND status <> 'draft')
BEGIN
  SELECT RAISE(ABORT, 'ledger:frozen-invoice');
END;
