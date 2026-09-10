# OpenBooks

[![Deploy with Clawnify](https://app.clawnify.com/deploy-button.svg)](https://app.clawnify.com/deploy?repo=clawnify/OpenBooks)

EU-compliance-first, agent-native, open source accounting and tax filing.

A Clawnify template app. React + Hono + D1 on Cloudflare Workers. AGPL-3.0.

<img width="1255" height="850" alt="Image" src="https://github.com/user-attachments/assets/95aa80a9-d8a7-45b0-a184-193597fdeaa1" />

> **Status: early — Phase 1 in progress.** Invoicing, double-entry bookkeeping, EU VAT logic, RGS chart of accounts, Peppol BIS Billing 3.0 UBL export, and visual PDFs work end-to-end. SBR/iXBRL for Dutch tax filing and country plugins (BE/FR/DE/IT) come in later phases.

## Why

Mandatory e-invoicing is sweeping the EU. Belgium is mandatory now. France is rolling out. Germany from 2025. Italy has had FatturaPA since 2019. The Netherlands has had SBR since 2018 and from fiscal year 2025 large companies can no longer file annual accounts in PDF — they must use SBR/iXBRL via Digipoort.

Every SMB needs compliant accounting software. The existing open-source options are PHP/Laravel-shaped, feature-thin, or buried inside a giant ERP. `open-books` is fresh code on a modern stack, designed agent-native from day one, with EU-compliance as the wedge into mid-market.

## What it does today

- **Customers, suppliers, products & services** with EU-relevant fields (VAT number, KVK/CoC, country, currency, IBAN).
- **RGS chart of accounts** (Referentie Grootboekschema) — starter dataset of top-level rubrieken and principal level-2 groepen, schema designed for the canonical ~4000-row dataset.
- **Invoices, credit notes, quotes** with gap-free yearly numbering sequences (`INV-2026-0001`, `CN-2026-0001`).
- **EU VAT logic** — domestic standard rates (NL/BE/FR/DE/IT/ES/PT/AT/IE/...), cross-border B2B reverse charge (Art. 196 EU VAT Directive), export-outside-EU zero-rating.
- **Editable invoice editor** with inline line CRUD, product picker, RGS account assignment, server-side recompute on every change.
- **HTML preview + PDF download + Peppol BIS Billing 3.0 UBL export** — including correct `AE` tax category and `VATEX-EU-AE` exemption code for reverse charge invoices.
- **Pluggable PDF backends** — Clawnify-managed (Browser Rendering proxy), direct `BROWSER` binding, or a Gotenberg sidecar.
- **Audit-proof ledger** — a posted entry is never edited or deleted. Corrections are booked as a mirror-image reversal, so the original and its correction both stay on the record and the trial balance still nets out. Posted invoices are frozen against edits, months can be locked closed, and every change to the books is recorded with who made it — a person, or an agent acting on its own.

## What's next

Roughly in order:

- **CI XSD validation** of generated UBL via `libxml2-wasm` against the Peppol BIS Billing 3.0 schema.
- **Settings page** to fill in company name / VAT / KVK / IBAN (currently API-only).
- **Accountant handoff** — export the locked periods to the formats a bookkeeper's software actually ingests, plus a read-only share so they can look without an account.
- **VAT returns + iXBRL** — BTW-aangifte and ICP, generated against the Nederlandse Taxonomie (Phase 3).
- **Country plugins** as separate repos: `open-books-fr`, `open-books-de`, `open-books-it`.
- **FatturaPA** XML for IT.
- **Hybrid Factur-X / ZUGFeRD** PDFs for FR / DE (PDF/A-3 + embedded CII XML — Node-side service).

The Digipoort submission step (filing tax returns to the Dutch government via the SBR gateway) is **deliberately not in scope for the open-source repo** — that requires a PKIoverheid services certificate and is offered as a Clawnify-managed service.

## Stack

| Layer | Choice |
|---|---|
| Server | [Hono](https://hono.dev) on Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| File storage | Cloudflare R2 |
| Client | React 19 + Vite 6 + Tailwind CSS 4 |
| Dev tooling | [`clawnify`](https://www.npmjs.com/package/clawnify) CLI |

## Quick start

```bash
git clone https://github.com/<org>/open-books.git
cd open-books
pnpm install
pnpm dev
```

The app runs at <http://localhost:5173>. The API is at <http://localhost:8787>.

Requires Node.js ≥ 22.

### Optional: PDF rendering in dev

PDF generation works through one of three backends, picked up automatically from env:

| Backend | Env var | Notes |
|---|---|---|
| Clawnify-managed | `CLAWNIFY_TOKEN` | `services.clawnify.com/pdf/render`. Token issued by Clawnify on deploy. |
| Cloudflare Browser Rendering | `BROWSER` binding | Direct Browser Rendering. Requires Workers Paid plan. |
| Gotenberg sidecar | `PDF_RENDERER_URL` | `docker run -p 3000:3000 gotenberg/gotenberg:8` then set `PDF_RENDERER_URL=http://localhost:3000`. |

Without any of the three configured, the **HTML preview** at `/api/invoices/:id/preview` always works (browser-viewable, "Save as PDF" via the browser is a manual fallback).

## Deploying

Designed to deploy as a Clawnify app:

```bash
pnpm deploy
```

This provisions D1, R2, and any Clawnify-managed services declared in `clawnify.json` (e.g., `services.pdf` — auto-injects `CLAWNIFY_TOKEN`).

Self-hosting on your own Cloudflare account is also supported — `clawnify.json` translates cleanly to a hand-written `wrangler.toml` if you prefer.

## License

[AGPL-3.0](./LICENSE) — same as Bigcapital, Akaunting, Invoice Ninja, Crater, Firefly III. Forks must remain AGPL.

## Contributing

This is early. The structural moves (schema shape, RGS taxonomy, country VAT logic) are still in flux. Issues and discussion welcome; PRs that touch the schema should come with a short rationale.
