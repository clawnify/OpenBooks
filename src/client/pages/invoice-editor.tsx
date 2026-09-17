import { useEffect, useState } from "react";
import { ConfirmButton, notify } from "../notice";
import { refused } from "../refusal";
import { Link, navigate } from "../router";

type InvoiceStatus = "draft" | "issued" | "sent" | "paid" | "cancelled";
type InvoiceType = "invoice" | "credit_note" | "quote";

interface InvoiceLine {
  id: number;
  invoice_id: number;
  position: number;
  product_id: number | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price_cents: number;
  vat_rate: number;
  account_code: string | null;
  subtotal_cents: number;
  vat_cents: number;
  total_cents: number;
}

interface Invoice {
  id: number;
  number: string | null;
  type: InvoiceType;
  status: InvoiceStatus;
  party_id: number;
  issue_date: string | null;
  due_date: string | null;
  currency: string;
  subtotal_cents: number;
  vat_cents: number;
  total_cents: number;
  reverse_charge: number;
  reference: string | null;
  notes: string | null;
  lines: InvoiceLine[];
}

interface Party {
  id: number;
  name: string;
  country: string;
  vat_number: string | null;
  currency: string;
}

interface Product {
  id: number;
  name: string;
  price_cents: number;
  vat_rate: number;
  unit: string;
  income_account: string | null;
  currency: string;
}

interface Account {
  rgs_code: string;
  omskort: string;
  bw: "B" | "W";
}

interface Company {
  name: string;
  country: string;
  vat_number: string | null;
}

const STATUS_TONE: Record<InvoiceStatus, string> = {
  draft: "bg-gray-100 text-gray-600",
  issued: "bg-blue-50 text-blue-700",
  sent: "bg-indigo-50 text-indigo-700",
  paid: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
};

export function InvoiceEditorPage({ id }: { id: number }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [party, setParty] = useState<Party | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const res = await fetch(`/api/invoices/${id}`);
    if (!res.ok) {
      setError("Invoice not found");
      return;
    }
    const inv: Invoice = await res.json();
    setInvoice(inv);
    const partyRes = await fetch(`/api/parties/${inv.party_id}`);
    if (partyRes.ok) setParty(await partyRes.json());
  }

  useEffect(() => {
    reload();
    fetch("/api/company").then((r) => r.json()).then(setCompany);
    fetch("/api/products?active=true").then((r) => r.json()).then(setProducts);
    fetch("/api/accounts").then((r) => r.json()).then((a: Account[]) => setAccounts(a.filter((x) => x.bw === "W")));
  }, [id]);

  if (error) return (
    <div className="text-center py-16">
      <p className="text-sm text-gray-500">{error}</p>
      <Link to="/invoices" className="text-sm text-blue-600 hover:underline mt-2 inline-block">Back to invoices</Link>
    </div>
  );
  if (!invoice) return <div className="text-sm text-gray-400">Loading…</div>;

  const editable = invoice.status === "draft";

  async function patchInvoice(body: Partial<Invoice>) {
    const res = await fetch(`/api/invoices/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) reload();
  }

  async function addBlankLine() {
    await fetch(`/api/invoices/${id}/lines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "", quantity: 1, unit_price_cents: 0, vat_rate: 21 }),
    });
    reload();
  }

  async function addLineFromProduct(productId: number) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    await fetch(`/api/invoices/${id}/lines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: product.id,
        description: product.name,
        quantity: 1,
        unit: product.unit,
        unit_price_cents: product.price_cents,
        vat_rate: product.vat_rate,
        account_code: product.income_account,
      }),
    });
    reload();
  }

  async function patchLine(lineId: number, body: Partial<InvoiceLine>) {
    await fetch(`/api/lines/${lineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    reload();
  }

  async function removeLine(lineId: number) {
    const res = await fetch(`/api/lines/${lineId}`, { method: "DELETE" });
    if (await refused(res)) return;
    reload();
  }

  async function issue() {
    if (invoice!.lines.length === 0) {
      notify("Add at least one line before issuing.");
      return;
    }
    const res = await fetch(`/api/invoices/${id}/issue`, { method: "POST" });
    if (await refused(res)) return;
    reload();
  }

  async function setStatus(status: InvoiceStatus) {
    const res = await fetch(`/api/invoices/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (await refused(res)) return;
    reload();
  }

  async function remove() {
    const res = await fetch(`/api/invoices/${id}`, { method: "DELETE" });
    if (await refused(res)) return;
    navigate("/invoices");
  }

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-1">
        <Link to="/invoices" className="text-xs text-gray-500 hover:text-gray-800">← Invoices</Link>
        <h2 className="text-xl font-semibold flex-1">
          {invoice.number ?? <span className="text-gray-400">Draft invoice #{invoice.id}</span>}
        </h2>
        <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_TONE[invoice.status]}`}>
          {invoice.status}
        </span>
      </div>
      <p className="text-sm text-gray-500 mb-6 capitalize">{invoice.type.replace("_", " ")}</p>

      <section className="grid grid-cols-2 gap-4 mb-6 text-xs">
        <div className="border border-gray-200 rounded-lg p-3">
          <div className="text-gray-400 mb-1">From</div>
          {company ? (
            <>
              <div className="text-sm font-medium text-gray-800">{company.name}</div>
              <div className="text-gray-500">{company.country}{company.vat_number ? ` · ${company.vat_number}` : ""}</div>
            </>
          ) : <span className="text-gray-400">…</span>}
        </div>
        <div className="border border-gray-200 rounded-lg p-3">
          <div className="text-gray-400 mb-1">To</div>
          {party ? (
            <>
              <div className="text-sm font-medium text-gray-800">{party.name}</div>
              <div className="text-gray-500">{party.country}{party.vat_number ? ` · ${party.vat_number}` : ""}</div>
            </>
          ) : <span className="text-gray-400">…</span>}
        </div>
      </section>

      <section className="grid grid-cols-3 gap-3 mb-6">
        <Field label="Issue date">
          <input
            type="date"
            value={invoice.issue_date ?? ""}
            disabled={!editable}
            onChange={(e) => setInvoice({ ...invoice, issue_date: e.target.value })}
            onBlur={(e) => patchInvoice({ issue_date: e.target.value || null } as Partial<Invoice>)}
            className={inputCls}
          />
        </Field>
        <Field label="Due date">
          <input
            type="date"
            value={invoice.due_date ?? ""}
            disabled={!editable}
            onChange={(e) => setInvoice({ ...invoice, due_date: e.target.value })}
            onBlur={(e) => patchInvoice({ due_date: e.target.value || null } as Partial<Invoice>)}
            className={inputCls}
          />
        </Field>
        <Field label="Reference">
          <input
            value={invoice.reference ?? ""}
            disabled={!editable}
            onChange={(e) => setInvoice({ ...invoice, reference: e.target.value })}
            onBlur={(e) => patchInvoice({ reference: e.target.value || null } as Partial<Invoice>)}
            placeholder="PO-1234"
            className={inputCls}
          />
        </Field>
      </section>

      <section className="mb-4">
        <div className="text-xs text-gray-500 mb-2 flex items-center gap-2">
          <span>Lines</span>
          {editable && products.length > 0 && (
            <select
              onChange={(e) => { if (e.target.value) { addLineFromProduct(Number(e.target.value)); e.target.value = ""; } }}
              className="text-xs px-2 py-1 rounded border border-gray-200 bg-white ml-auto"
            >
              <option value="">+ Add from product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {formatMoney(p.price_cents, p.currency)}</option>
              ))}
            </select>
          )}
          {editable && (
            <button onClick={addBlankLine} className="text-xs text-blue-600 hover:underline">+ Blank line</button>
          )}
        </div>
        {invoice.lines.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-gray-200 rounded-lg text-sm text-gray-400">
            No lines yet.
          </div>
        ) : (
          <div className="border border-gray-100 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left font-normal px-2 py-2 w-7/12">Description</th>
                  <th className="text-right font-normal px-2 py-2">Qty</th>
                  <th className="text-right font-normal px-2 py-2">Price</th>
                  <th className="text-right font-normal px-2 py-2">VAT %</th>
                  <th className="text-right font-normal px-2 py-2">Total</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((line) => (
                  <LineRow
                    key={line.id}
                    line={line}
                    currency={invoice.currency}
                    accounts={accounts}
                    editable={editable}
                    onPatch={(body) => patchLine(line.id, body)}
                    onDelete={() => removeLine(line.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="border-t border-gray-100 pt-4 mb-6">
        <div className="ml-auto w-72 text-sm space-y-1">
          <Row label="Subtotal" value={formatMoney(invoice.subtotal_cents, invoice.currency)} />
          <Row label="VAT" value={formatMoney(invoice.vat_cents, invoice.currency)} />
          <Row label="Total" value={formatMoney(invoice.total_cents, invoice.currency)} bold />
          {invoice.reverse_charge ? (
            <p className="text-xs text-amber-700 mt-2">
              Reverse charge applies — VAT to be accounted for by recipient (Art. 196 EU VAT Directive).
            </p>
          ) : null}
        </div>
      </section>

      <section className="mb-6">
        <Field label="Notes" full>
          <textarea
            value={invoice.notes ?? ""}
            disabled={!editable}
            onChange={(e) => setInvoice({ ...invoice, notes: e.target.value })}
            onBlur={(e) => patchInvoice({ notes: e.target.value || null } as Partial<Invoice>)}
            className={`${inputCls} h-20 resize-y`}
          />
        </Field>
      </section>

      <section className="flex gap-2 flex-wrap">
        <a
          href={`/api/invoices/${invoice.id}/preview`}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
        >
          Preview
        </a>
        <a
          href={`/api/invoices/${invoice.id}/pdf`}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
        >
          Download PDF
        </a>
        {invoice.type !== "quote" && (
          <a
            href={`/api/invoices/${invoice.id}/ubl`}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50"
            title="Peppol BIS Billing 3.0 UBL XML"
          >
            Download UBL
          </a>
        )}
        {invoice.status === "draft" && (
          <button onClick={issue} className="px-3 py-1.5 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-800">
            Issue invoice
          </button>
        )}
        {invoice.status === "issued" && (
          <>
            <button onClick={() => setStatus("sent")} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">Mark sent</button>
            <button onClick={() => setStatus("paid")} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">Mark paid</button>
          </>
        )}
        {invoice.status === "sent" && (
          <button onClick={() => setStatus("paid")} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">Mark paid</button>
        )}
        {invoice.status !== "cancelled" && invoice.status !== "paid" && invoice.status !== "draft" && (
          <button onClick={() => setStatus("cancelled")} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
        )}
        {invoice.status === "draft" && (
          <span className="ml-auto"><ConfirmButton prompt="Delete this draft?" onConfirm={remove} className="px-3 py-1.5 rounded-lg border border-red-200 text-sm text-red-600 hover:bg-red-50">Delete</ConfirmButton></span>
        )}
      </section>
    </div>
  );
}

function LineRow({
  line,
  currency,
  accounts,
  editable,
  onPatch,
  onDelete,
}: {
  line: InvoiceLine;
  currency: string;
  accounts: Account[];
  editable: boolean;
  onPatch: (body: Partial<InvoiceLine>) => void;
  onDelete: () => void;
}) {
  const [local, setLocal] = useState(line);
  useEffect(() => setLocal(line), [line]);
  const reverseCharge = line.subtotal_cents > 0 && line.vat_cents === 0 && line.vat_rate > 0;

  return (
    <tr className="border-t border-gray-100">
      <td className="px-2 py-1 align-top">
        <input
          value={local.description}
          disabled={!editable}
          onChange={(e) => setLocal({ ...local, description: e.target.value })}
          onBlur={() => local.description !== line.description && onPatch({ description: local.description })}
          className={cellCls}
        />
        {editable && (
          <select
            value={local.account_code ?? ""}
            onChange={(e) => { const v = e.target.value || null; setLocal({ ...local, account_code: v }); onPatch({ account_code: v }); }}
            className="text-[10px] mt-1 w-full px-1 py-0.5 rounded border border-transparent hover:border-gray-200 bg-transparent text-gray-500"
          >
            <option value="">no account</option>
            {accounts.map((a) => (
              <option key={a.rgs_code} value={a.rgs_code}>{a.rgs_code} — {a.omskort}</option>
            ))}
          </select>
        )}
      </td>
      <td className="px-2 py-1 align-top text-right">
        <input
          type="number"
          step="0.01"
          value={local.quantity}
          disabled={!editable}
          onChange={(e) => setLocal({ ...local, quantity: Number(e.target.value) })}
          onBlur={() => local.quantity !== line.quantity && onPatch({ quantity: local.quantity })}
          className={`${cellCls} text-right w-16`}
        />
      </td>
      <td className="px-2 py-1 align-top text-right">
        <input
          type="number"
          step="0.01"
          value={(local.unit_price_cents / 100).toFixed(2)}
          disabled={!editable}
          onChange={(e) => setLocal({ ...local, unit_price_cents: Math.round(Number(e.target.value) * 100) })}
          onBlur={() => local.unit_price_cents !== line.unit_price_cents && onPatch({ unit_price_cents: local.unit_price_cents })}
          className={`${cellCls} text-right w-24`}
        />
      </td>
      <td className="px-2 py-1 align-top text-right">
        <input
          type="number"
          step="0.1"
          value={local.vat_rate}
          disabled={!editable}
          onChange={(e) => setLocal({ ...local, vat_rate: Number(e.target.value) })}
          onBlur={() => local.vat_rate !== line.vat_rate && onPatch({ vat_rate: local.vat_rate })}
          className={`${cellCls} text-right w-16`}
        />
        {reverseCharge && <div className="text-[10px] text-amber-700 mt-0.5">(reverse)</div>}
      </td>
      <td className="px-2 py-1 align-top text-right font-mono whitespace-nowrap">
        {formatMoney(line.total_cents, currency)}
      </td>
      <td className="px-1 py-1 align-top text-right">
        {editable && (
          <button onClick={onDelete} className="text-gray-300 hover:text-red-600 text-sm leading-none">×</button>
        )}
      </td>
    </tr>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold text-gray-900 pt-1 border-t border-gray-100" : "text-gray-600"}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`text-xs text-gray-500 ${full ? "col-span-3" : ""}`}>
      <span className="block mb-1">{label}</span>
      {children}
    </label>
  );
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(cents / 100);
}

const inputCls = "w-full px-2 py-1.5 rounded-md border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black disabled:bg-gray-50 disabled:text-gray-500";
const cellCls = "w-full px-1 py-0.5 rounded border border-transparent hover:border-gray-200 focus:border-gray-400 focus:outline-none bg-transparent text-sm disabled:text-gray-500";
