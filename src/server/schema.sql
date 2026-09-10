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
  -- 'posted' counts towards the books. 'pending' is the brief window while a
  -- Storno is being written; there is no transaction primitive, so the entry
  -- is flipped to 'posted' only once its lines are in.
  status TEXT NOT NULL DEFAULT 'posted',
  reverses_entry_id INTEGER,
  reversed_by_entry_id INTEGER,
  posted_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (reverses_entry_id) REFERENCES journal_entries(id),
  FOREIGN KEY (reversed_by_entry_id) REFERENCES journal_entries(id)
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
