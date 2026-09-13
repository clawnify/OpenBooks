import { useEffect, useState } from "react";
import { refused } from "../refusal";
import { Link, navigate } from "../router";

type InvoiceStatus = "draft" | "issued" | "sent" | "paid" | "cancelled";
type InvoiceType = "invoice" | "credit_note" | "quote";

interface InvoiceRow {
  id: number;
  number: string | null;
  type: InvoiceType;
  status: InvoiceStatus;
  party_id: number;
  party_name: string;
  party_country: string;
  issue_date: string | null;
  due_date: string | null;
  currency: string;
  total_cents: number;
  reverse_charge: number;
  reference: string | null;
}

interface Party {
  id: number;
  name: string;
  country: string;
  currency: string;
}

const STATUS_TONE: Record<InvoiceStatus, string> = {
  draft: "bg-gray-100 text-gray-600",
  issued: "bg-blue-50 text-blue-700",
  sent: "bg-indigo-50 text-indigo-700",
  paid: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
};

export function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "">("");
  const [typeFilter, setTypeFilter] = useState<InvoiceType | "">("");

  async function load() {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (typeFilter) params.set("type", typeFilter);
    const res = await fetch(`/api/invoices?${params}`);
    setInvoices(await res.json());
  }

  async function loadParties() {
    const res = await fetch("/api/parties?kind=customer");
    setParties(await res.json());
  }

  useEffect(() => { loadParties(); }, []);
  useEffect(() => { load(); }, [statusFilter, typeFilter]);

  async function issue(id: number) {
    await fetch(`/api/invoices/${id}/issue`, { method: "POST" });
    load();
  }

  async function setStatus(id: number, status: InvoiceStatus) {
    await fetch(`/api/invoices/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  }

  async function remove(id: number) {
    if (!confirm("Delete this draft (and all lines)?")) return;
    const res = await fetch(`/api/invoices/${id}`, { method: "DELETE" });
    if (await refused(res)) return;
    load();
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-xl font-semibold">Invoices</h2>
        <span className="text-xs text-gray-400">{invoices.length} {invoices.length === 1 ? "invoice" : "invoices"}</span>
      </div>
      <p className="text-sm text-gray-500 mb-6">Drafts, issued, paid. Editor lands next round; this is the list view.</p>

      <div className="flex gap-2 mb-4 flex-wrap">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as InvoiceType | "")} className={selectCls}>
          <option value="">All types</option>
          <option value="invoice">Invoice</option>
          <option value="credit_note">Credit note</option>
          <option value="quote">Quote</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | "")} className={selectCls}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="issued">Issued</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button
          onClick={() => setShowNew(!showNew)}
          disabled={parties.length === 0}
          className="ml-auto px-3 py-1.5 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
          title={parties.length === 0 ? "Add a customer first" : ""}
        >
          {showNew ? "Cancel" : "Create draft"}
        </button>
      </div>

      {showNew && (
        <NewDraftForm
          parties={parties}
          onCancel={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); }}
        />
      )}

      {parties.length === 0 && (
        <div className="text-center py-8 mb-4 border border-dashed border-amber-200 bg-amber-50/50 rounded-lg">
          <p className="text-sm text-amber-800">
            No customers yet. <Link to="/customers" className="underline">Add one</Link> before creating an invoice.
          </p>
        </div>
      )}

      {invoices.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gray-200 rounded-lg">
          <p className="text-sm text-gray-500">No invoices yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
          {invoices.map((inv) => (
            <li key={inv.id} className="px-4 py-3 hover:bg-gray-50 flex items-center gap-3">
              <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_TONE[inv.status]}`}>
                {inv.status}
              </span>
              <Link to={`/invoices/${inv.id}`} className="font-mono text-xs text-gray-500 w-32 truncate hover:text-gray-900">
                {inv.number ?? <span className="italic text-gray-300">draft #{inv.id}</span>}
              </Link>
              <Link to={`/invoices/${inv.id}`} className="flex-1 min-w-0 hover:no-underline">
                <div className="text-sm text-gray-800 truncate">
                  {inv.party_name}
                  <span className="text-gray-400 ml-1">· {inv.party_country}</span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                  {inv.type !== "invoice" && <span className="capitalize">{inv.type.replace("_", " ")}</span>}
                  {inv.issue_date && <span>Issued {inv.issue_date}</span>}
                  {inv.reference && <span>Ref {inv.reference}</span>}
                  {inv.reverse_charge ? <span className="text-amber-700">Reverse charge</span> : null}
                </div>
              </Link>
              <div className="text-sm font-mono text-gray-700">
                {formatMoney(inv.total_cents, inv.currency)}
              </div>
              <div className="flex items-center gap-1">
                {inv.status === "draft" && (
                  <button onClick={() => issue(inv.id)} className="text-xs text-blue-600 hover:underline px-2 py-1">
                    Issue
                  </button>
                )}
                {inv.status === "issued" && (
                  <button onClick={() => setStatus(inv.id, "paid")} className="text-xs text-emerald-700 hover:underline px-2 py-1">
                    Mark paid
                  </button>
                )}
                {inv.status === "draft" && (
                  <button onClick={() => remove(inv.id)} className="text-gray-300 hover:text-red-600 text-lg leading-none px-1" title="Delete draft">×</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewDraftForm({
  parties,
  onCancel,
  onCreated,
}: {
  parties: Party[];
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [partyId, setPartyId] = useState(String(parties[0]?.id ?? ""));
  const [type, setType] = useState<InvoiceType>("invoice");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedParty = parties.find((p) => String(p.id) === partyId);
  const currency = selectedParty?.currency ?? "EUR";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!partyId) return;
    setSaving(true);
    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        party_id: Number(partyId),
        currency,
        reference: reference || null,
      }),
    });
    setSaving(false);
    const created = await res.json();
    if (created?.id) {
      navigate(`/invoices/${created.id}`);
    } else {
      onCreated();
    }
  }

  return (
    <form onSubmit={submit} className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50/50">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-gray-500 col-span-2">
          <span className="block mb-1">Customer</span>
          <select value={partyId} onChange={(e) => setPartyId(e.target.value)} className={selectCls}>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {p.country}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-500">
          <span className="block mb-1">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as InvoiceType)} className={selectCls}>
            <option value="invoice">Invoice</option>
            <option value="credit_note">Credit note</option>
            <option value="quote">Quote</option>
          </select>
        </label>
        <label className="text-xs text-gray-500">
          <span className="block mb-1">Reference (optional)</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} className={selectCls} placeholder="PO-1234" />
        </label>
      </div>
      <div className="flex gap-2 mt-4">
        <button type="submit" disabled={saving} className="px-3 py-1.5 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50">
          {saving ? "Creating…" : "Create draft"}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  );
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
}

const selectCls = "px-2 py-1.5 rounded-md border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black";
