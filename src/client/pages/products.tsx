import { useEffect, useState } from "react";
import { ConfirmButton } from "../notice";

type ProductKind = "good" | "service";

interface Product {
  id: number;
  kind: ProductKind;
  sku: string | null;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  vat_rate: number;
  unit: string;
  income_account: string | null;
  active: number;
}

interface Account {
  rgs_code: string;
  omskort: string;
  bw: "B" | "W";
}

const CURRENCIES = ["EUR", "USD", "GBP", "CHF"];
const UNITS = ["unit", "hour", "day", "kg", "m", "m²", "month", "license"];

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [q, setQ] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);

  async function load() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const res = await fetch(`/api/products?${params}`);
    setProducts(await res.json());
  }

  async function loadAccounts() {
    const res = await fetch("/api/accounts");
    const all: Account[] = await res.json();
    setAccounts(all.filter((a) => a.bw === "W"));
  }

  useEffect(() => { loadAccounts(); }, []);
  useEffect(() => { load(); }, [q]);

  async function remove(id: number) {
    await fetch(`/api/products/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-xl font-semibold">Products & Services</h2>
        <span className="text-xs text-gray-400">{products.length} {products.length === 1 ? "item" : "items"}</span>
      </div>
      <p className="text-sm text-gray-500 mb-6">Catalogue of what you sell.</p>

      <div className="flex gap-2 mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, SKU, description…"
          className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
        <button
          onClick={() => { setEditing(null); setShowForm(!showForm); }}
          className="px-3 py-1.5 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-800"
        >
          {showForm && !editing ? "Cancel" : "Add product"}
        </button>
      </div>

      {(showForm || editing) && (
        <ProductForm
          initial={editing}
          accounts={accounts}
          onSave={() => { setShowForm(false); setEditing(null); load(); }}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {products.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gray-200 rounded-lg">
          <p className="text-sm text-gray-500">No products yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
          {products.map((p) => (
            <li key={p.id} className="px-4 py-3 hover:bg-gray-50 flex items-center gap-4">
              <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${p.kind === "service" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>
                {p.kind}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-sm text-gray-800 truncate">{p.name}</span>
                  {p.sku && <span className="text-xs font-mono text-gray-400">{p.sku}</span>}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                  <span>{formatMoney(p.price_cents, p.currency)} / {p.unit}</span>
                  <span>{p.vat_rate}% VAT</span>
                  {p.income_account && <span className="font-mono">{p.income_account}</span>}
                </div>
              </div>
              <button
                onClick={() => { setEditing(p); setShowForm(false); }}
                className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1"
              >
                Edit
              </button>
              <ConfirmButton
                prompt="Delete this product?"
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

function ProductForm({
  initial,
  accounts,
  onSave,
  onCancel,
}: {
  initial: Product | null;
  accounts: Account[];
  onSave: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(() => ({
    kind: (initial?.kind ?? "service") as ProductKind,
    sku: initial?.sku ?? "",
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    price: initial ? (initial.price_cents / 100).toFixed(2) : "0.00",
    currency: initial?.currency ?? "EUR",
    vat_rate: String(initial?.vat_rate ?? 21),
    unit: initial?.unit ?? "unit",
    income_account: initial?.income_account ?? "",
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
    const payload = {
      ...form,
      sku: form.sku || null,
      description: form.description || null,
      income_account: form.income_account || null,
      price_cents: Math.round(parseFloat(form.price || "0") * 100),
      vat_rate: parseFloat(form.vat_rate || "0"),
    };
    const url = initial ? `/api/products/${initial.id}` : "/api/products";
    const method = initial ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
          <select value={form.kind} onChange={(e) => update("kind", e.target.value as ProductKind)} className={inputCls}>
            <option value="service">Service</option>
            <option value="good">Good</option>
          </select>
        </Field>
        <Field label="SKU">
          <input value={form.sku} onChange={(e) => update("sku", e.target.value)} className={`${inputCls} font-mono`} />
        </Field>
        <Field label="Description" full>
          <textarea value={form.description} onChange={(e) => update("description", e.target.value)} className={`${inputCls} h-16 resize-y`} />
        </Field>
        <Field label="Unit price">
          <input type="number" step="0.01" value={form.price} onChange={(e) => update("price", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Currency">
          <select value={form.currency} onChange={(e) => update("currency", e.target.value)} className={inputCls}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="VAT rate (%)">
          <input type="number" step="0.1" value={form.vat_rate} onChange={(e) => update("vat_rate", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Unit">
          <select value={form.unit} onChange={(e) => update("unit", e.target.value)} className={inputCls}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
        <Field label="Income account (RGS)" full>
          <select value={form.income_account} onChange={(e) => update("income_account", e.target.value)} className={inputCls}>
            <option value="">(none)</option>
            {accounts.map((a) => (
              <option key={a.rgs_code} value={a.rgs_code}>{a.rgs_code} — {a.omskort}</option>
            ))}
          </select>
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

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
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
