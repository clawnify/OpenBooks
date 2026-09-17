import { useEffect, useState } from "react";
import { ConfirmButton } from "../notice";

type PartyKind = "customer" | "supplier" | "both";

interface Party {
  id: number;
  kind: PartyKind;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  vat_number: string | null;
  chamber_number: string | null;
  country: string;
  address_line1: string | null;
  postal_code: string | null;
  city: string | null;
  currency: string;
  iban: string | null;
}

const COUNTRIES = ["NL", "BE", "DE", "FR", "IT", "ES", "PT", "AT", "DK", "SE", "FI", "IE", "PL", "GB"];
const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "DKK", "NOK", "PLN"];

export function PartiesPage({ kind }: { kind: "customer" | "supplier" }) {
  const [parties, setParties] = useState<Party[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Party | null>(null);
  const [q, setQ] = useState("");

  async function load() {
    const params = new URLSearchParams({ kind });
    if (q) params.set("q", q);
    const res = await fetch(`/api/parties?${params}`);
    setParties(await res.json());
  }

  useEffect(() => { load(); }, [kind, q]);

  async function remove(id: number) {
    await fetch(`/api/parties/${id}`, { method: "DELETE" });
    load();
  }

  const heading = kind === "customer" ? "Customers" : "Suppliers";
  const addLabel = kind === "customer" ? "Add customer" : "Add supplier";

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-xl font-semibold">{heading}</h2>
        <span className="text-xs text-gray-400">{parties.length} {parties.length === 1 ? "party" : "parties"}</span>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        {kind === "customer" ? "People and businesses you invoice." : "Vendors who invoice you."}
      </p>

      <div className="flex gap-2 mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, email, VAT…"
          className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
        <button
          onClick={() => { setEditing(null); setShowForm(!showForm); }}
          className="px-3 py-1.5 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-800"
        >
          {showForm && !editing ? "Cancel" : addLabel}
        </button>
      </div>

      {(showForm || editing) && (
        <PartyForm
          kind={kind}
          initial={editing}
          onSave={() => { setShowForm(false); setEditing(null); load(); }}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {parties.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gray-200 rounded-lg">
          <p className="text-sm text-gray-500">
            No {kind === "customer" ? "customers" : "suppliers"} yet.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
          {parties.map((p) => (
            <li key={p.id} className="px-4 py-3 hover:bg-gray-50 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-sm text-gray-800 truncate">{p.name}</span>
                  {p.kind === "both" && (
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">customer + supplier</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                  {p.email && <span>{p.email}</span>}
                  {p.vat_number && <span className="font-mono">{p.vat_number}</span>}
                  {p.city && <span>{p.city}, {p.country}</span>}
                </div>
              </div>
              <button
                onClick={() => { setEditing(p); setShowForm(false); }}
                className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1"
              >
                Edit
              </button>
              <ConfirmButton
                prompt="Delete this party?"
                onConfirm={() => remove(p.id)}
                className="text-gray-300 hover:text-red-600 text-lg leading-none px-1"
                title="Delete"
              >
                ×
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PartyForm({
  kind,
  initial,
  onSave,
  onCancel,
}: {
  kind: "customer" | "supplier";
  initial: Party | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(() => ({
    kind: (initial?.kind ?? kind) as PartyKind,
    name: initial?.name ?? "",
    contact_name: initial?.contact_name ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    vat_number: initial?.vat_number ?? "",
    chamber_number: initial?.chamber_number ?? "",
    country: initial?.country ?? "NL",
    address_line1: initial?.address_line1 ?? "",
    postal_code: initial?.postal_code ?? "",
    city: initial?.city ?? "",
    currency: initial?.currency ?? "EUR",
    iban: initial?.iban ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm({ ...form, [key]: value });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError(null);
    const url = initial ? `/api/parties/${initial.id}` : "/api/parties";
    const method = initial ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Failed to save");
      return;
    }
    onSave();
  }

  return (
    <form onSubmit={submit} className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50/50">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name *" full>
          <input value={form.name} onChange={(e) => update("name", e.target.value)} className={inputCls} required />
        </Field>
        <Field label="Type">
          <select value={form.kind} onChange={(e) => update("kind", e.target.value as PartyKind)} className={inputCls}>
            <option value="customer">Customer</option>
            <option value="supplier">Supplier</option>
            <option value="both">Both</option>
          </select>
        </Field>
        <Field label="Contact name">
          <input value={form.contact_name} onChange={(e) => update("contact_name", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Email">
          <input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Phone">
          <input value={form.phone} onChange={(e) => update("phone", e.target.value)} className={inputCls} />
        </Field>
        <Field label="VAT number">
          <input value={form.vat_number} onChange={(e) => update("vat_number", e.target.value)} className={`${inputCls} font-mono`} placeholder="NL123456789B01" />
        </Field>
        <Field label="Chamber / KVK">
          <input value={form.chamber_number} onChange={(e) => update("chamber_number", e.target.value)} className={`${inputCls} font-mono`} />
        </Field>
        <Field label="Address" full>
          <input value={form.address_line1} onChange={(e) => update("address_line1", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Postal code">
          <input value={form.postal_code} onChange={(e) => update("postal_code", e.target.value)} className={inputCls} />
        </Field>
        <Field label="City">
          <input value={form.city} onChange={(e) => update("city", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Country">
          <select value={form.country} onChange={(e) => update("country", e.target.value)} className={inputCls}>
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Currency">
          <select value={form.currency} onChange={(e) => update("currency", e.target.value)} className={inputCls}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="IBAN" full>
          <input value={form.iban} onChange={(e) => update("iban", e.target.value)} className={`${inputCls} font-mono`} />
        </Field>
      </div>
      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
      <div className="flex gap-2 mt-4">
        <button type="submit" disabled={saving} className="px-3 py-1.5 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50">
          {saving ? "Saving…" : initial ? "Save changes" : "Create"}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  );
}

const inputCls = "w-full px-2 py-1.5 rounded-md border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black";

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`text-xs text-gray-500 ${full ? "col-span-2" : ""}`}>
      <span className="block mb-1">{label}</span>
      {children}
    </label>
  );
}
