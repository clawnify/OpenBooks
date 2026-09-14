import { get, query, run } from "../db";

export type PartyKind = "customer" | "supplier" | "both";

export interface Party {
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
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  currency: string;
  iban: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type PartyInput = Partial<Omit<Party, "id" | "created_at" | "updated_at">> & {
  kind: PartyKind;
  name: string;
};

const COLUMNS = [
  "kind", "name", "contact_name", "email", "phone", "vat_number", "chamber_number",
  "country", "address_line1", "address_line2", "postal_code", "city", "currency",
  "iban", "notes",
] as const;

export async function listParties(filters: { kind?: PartyKind; q?: string } = {}): Promise<Party[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.kind) {
    where.push("(kind = ? OR kind = 'both')");
    params.push(filters.kind);
  }
  if (filters.q) {
    where.push("(name LIKE ? OR email LIKE ? OR vat_number LIKE ?)");
    const q = `%${filters.q}%`;
    params.push(q, q, q);
  }
  const sql = `SELECT * FROM parties ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY name`;
  return query<Party>(sql, params);
}

export async function getParty(id: number): Promise<Party | undefined> {
  return get<Party>("SELECT * FROM parties WHERE id = ?", [id]);
}

export async function createParty(input: PartyInput): Promise<Party> {
  const cols: string[] = [];
  const placeholders: string[] = [];
  const params: unknown[] = [];
  for (const col of COLUMNS) {
    const value = (input as Record<string, unknown>)[col];
    if (value !== undefined) {
      cols.push(col);
      placeholders.push("?");
      params.push(value);
    }
  }
  const inserted = await query<{ id: number }>(
    `INSERT INTO parties (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
    params,
  );
  const created = await getParty(inserted[0].id);
  if (!created) throw new Error("Failed to load created party");
  return created;
}

export async function updateParty(id: number, input: Partial<PartyInput>): Promise<Party | undefined> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const col of COLUMNS) {
    const value = (input as Record<string, unknown>)[col];
    if (value !== undefined) {
      sets.push(`${col} = ?`);
      params.push(value);
    }
  }
  if (sets.length === 0) return getParty(id);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  await run(`UPDATE parties SET ${sets.join(", ")} WHERE id = ?`, params);
  return getParty(id);
}

export async function deleteParty(id: number): Promise<void> {
  await run("DELETE FROM parties WHERE id = ?", [id]);
}
