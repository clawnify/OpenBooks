import { useEffect, useState } from "react";

interface JournalLine {
  id: number;
  position: number;
  account_code: string;
  description: string | null;
  debit_cents: number;
  credit_cents: number;
}

interface JournalEntry {
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
  lines: JournalLine[];
  total_debit_cents: number;
  total_credit_cents: number;
}

interface TrialBalanceRow {
  account_code: string;
  debit_cents: number;
  credit_cents: number;
  balance_cents: number;
}

export function JournalsPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [trial, setTrial] = useState<TrialBalanceRow[]>([]);
  const [backfilling, setBackfilling] = useState(false);

  async function load() {
    const [entriesRes, trialRes] = await Promise.all([
      fetch("/api/journals"),
      fetch("/api/reports/trial-balance"),
    ]);
    setEntries(await entriesRes.json());
    setTrial(await trialRes.json());
  }

  useEffect(() => { load(); }, []);

  async function backfill() {
    setBackfilling(true);
    const res = await fetch("/api/journals/backfill", { method: "POST" });
    const data: { created: number } = await res.json();
    setBackfilling(false);
    if (data.created > 0) await load();
    alert(`Backfilled ${data.created} journal ${data.created === 1 ? "entry" : "entries"}.`);
  }

  const totalDebit = trial.reduce((s, r) => s + r.debit_cents, 0);
  const totalCredit = trial.reduce((s, r) => s + r.credit_cents, 0);
  const balanced = totalDebit === totalCredit;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-xl font-semibold">Journal</h2>
        <span className="text-xs text-gray-400">{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Double-entry ledger. Auto-posted from issued invoices and credit notes; debits and credits must balance.
        A posted entry is never edited or deleted &mdash; a correction is a second, mirror-image entry, and both stay on the record.
      </p>

      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={backfill}
          disabled={backfilling}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {backfilling ? "Backfilling…" : "Backfill from invoices"}
        </button>
        <span className="text-xs text-gray-400 ml-auto">
          Posts entries for already-issued invoices that don't yet have one.
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gray-200 rounded-lg">
          <p className="text-sm text-gray-500 mb-1">No journal entries yet.</p>
          <p className="text-xs text-gray-400">Issue an invoice or click Backfill above to post entries.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      <h3 className="text-base font-semibold mt-10 mb-3">Trial balance</h3>
      {trial.length === 0 ? (
        <p className="text-xs text-gray-400">No postings.</p>
      ) : (
        <div className="border border-gray-100 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left font-normal px-3 py-2">Account</th>
                <th className="text-right font-normal px-3 py-2">Debit</th>
                <th className="text-right font-normal px-3 py-2">Credit</th>
                <th className="text-right font-normal px-3 py-2">Balance</th>
              </tr>
            </thead>
            <tbody>
              {trial.map((row) => (
                <tr key={row.account_code} className="border-t border-gray-100">
                  <td className="px-3 py-1.5 font-mono text-gray-700">{row.account_code}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{row.debit_cents > 0 ? formatMoney(row.debit_cents) : ""}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{row.credit_cents > 0 ? formatMoney(row.credit_cents) : ""}</td>
                  <td className={`px-3 py-1.5 text-right font-mono ${row.balance_cents < 0 ? "text-emerald-700" : "text-gray-700"}`}>
                    {formatMoney(Math.abs(row.balance_cents))}{row.balance_cents < 0 ? " Cr" : row.balance_cents > 0 ? " Dr" : ""}
                  </td>
                </tr>
              ))}
              <tr className="bg-gray-50 border-t-2 border-gray-200 font-medium">
                <td className="px-3 py-2 text-gray-600">Total</td>
                <td className="px-3 py-2 text-right font-mono">{formatMoney(totalDebit)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatMoney(totalCredit)}</td>
                <td className={`px-3 py-2 text-right font-mono ${balanced ? "text-emerald-700" : "text-red-600"}`}>
                  {balanced ? "balanced" : `off by ${formatMoney(Math.abs(totalDebit - totalCredit))}`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EntryCard({ entry }: { entry: JournalEntry }) {
  const balanced = entry.total_debit_cents === entry.total_credit_cents;
  const isReversal = entry.reverses_entry_id !== null;
  const wasReversed = entry.reversed_by_entry_id !== null;
  return (
    <div className={`border rounded-lg overflow-hidden ${wasReversed ? "border-amber-200" : "border-gray-100"}`}>
      <div className="flex items-baseline gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100">
        <span className="font-mono text-xs text-gray-500">{entry.date}</span>
        <span className="font-mono text-xs text-gray-700">{entry.reference}</span>
        <span className={`text-sm flex-1 truncate ${wasReversed ? "text-gray-400 line-through" : "text-gray-700"}`}>
          {entry.description ?? ""}
        </span>
        {wasReversed && (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
            reversed by #{entry.reversed_by_entry_id}
          </span>
        )}
        {isReversal && (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
            reverses #{entry.reverses_entry_id}
          </span>
        )}
        <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${balanced ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {balanced ? entry.status : "imbalanced"}
        </span>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {entry.lines.map((line) => (
            <tr key={line.id} className="border-t border-gray-50">
              <td className="px-3 py-1.5 font-mono text-gray-500 w-20">{line.account_code}</td>
              <td className="px-3 py-1.5 text-gray-700">{line.description}</td>
              <td className="px-3 py-1.5 text-right font-mono w-24">{line.debit_cents > 0 ? formatMoney(line.debit_cents) : ""}</td>
              <td className="px-3 py-1.5 text-right font-mono w-24">{line.credit_cents > 0 ? formatMoney(line.credit_cents) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(cents / 100);
}
