import { get, run } from "../db";

export interface Company {
  id: number;
  name: string;
  vat_number: string | null;
  chamber_number: string | null;
  country: string;
  address_line1: string | null;
  postal_code: string | null;
  city: string | null;
  email: string | null;
  iban: string | null;
  default_currency: string;
  default_due_days: number;
  updated_at: string;
}

const COLUMNS = [
  "name", "vat_number", "chamber_number", "country", "address_line1",
  "postal_code", "city", "email", "iban", "default_currency", "default_due_days",
] as const;

/**
 * Create the singleton company row if it is not there yet.
 *
 * It used to be seeded from `schema.sql`, but a deploy applies that file as
 * DDL only and refuses anything else, so the seed failed the whole build.
 * Every column the row needs has a DDL default, so an id-only insert is the
 * whole row. `INSERT OR IGNORE` keeps it idempotent, and the per-isolate flag
 * keeps it to one statement per worker rather than one per request.
 */
let companyRowEnsured = false;

async function ensureCompanyRow(): Promise<void> {
  if (companyRowEnsured) return;
  await run("INSERT OR IGNORE INTO company (id) VALUES (1)");
  companyRowEnsured = true;
}

export async function getCompany(): Promise<Company> {
  await ensureCompanyRow();
  const c = await get<Company>("SELECT * FROM company WHERE id = 1");
  if (!c) throw new Error("Company row missing — schema not initialised");
  return c;
}

export async function updateCompany(input: Partial<Company>): Promise<Company> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const col of COLUMNS) {
    const value = (input as Record<string, unknown>)[col];
    if (value !== undefined) {
      sets.push(`${col} = ?`);
      params.push(value);
    }
  }
  if (sets.length > 0) {
    // Without the row this UPDATE matches nothing and the save silently does
    // nothing, which is exactly how this class of bug hides.
    await ensureCompanyRow();
    sets.push("updated_at = datetime('now')");
    await run(`UPDATE company SET ${sets.join(", ")} WHERE id = 1`, params);
  }
  return getCompany();
}
