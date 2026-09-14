import { get, query, run } from "../db";

export type ProductKind = "good" | "service";

export interface Product {
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
  expense_account: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export type ProductInput = Partial<Omit<Product, "id" | "created_at" | "updated_at">> & {
  name: string;
};

const COLUMNS = [
  "kind", "sku", "name", "description", "price_cents", "currency",
  "vat_rate", "unit", "income_account", "expense_account", "active",
] as const;

export async function listProducts(filters: { active?: boolean; q?: string } = {}): Promise<Product[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.active !== undefined) {
    where.push("active = ?");
    params.push(filters.active ? 1 : 0);
  }
  if (filters.q) {
    where.push("(name LIKE ? OR sku LIKE ? OR description LIKE ?)");
    const q = `%${filters.q}%`;
    params.push(q, q, q);
  }
  const sql = `SELECT * FROM products ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY name`;
  return query<Product>(sql, params);
}

export async function getProduct(id: number): Promise<Product | undefined> {
  return get<Product>("SELECT * FROM products WHERE id = ?", [id]);
}

export async function createProduct(input: ProductInput): Promise<Product> {
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
    `INSERT INTO products (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
    params,
  );
  const created = await getProduct(inserted[0].id);
  if (!created) throw new Error("Failed to load created product");
  return created;
}

export async function updateProduct(id: number, input: Partial<ProductInput>): Promise<Product | undefined> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const col of COLUMNS) {
    const value = (input as Record<string, unknown>)[col];
    if (value !== undefined) {
      sets.push(`${col} = ?`);
      params.push(value);
    }
  }
  if (sets.length === 0) return getProduct(id);
  sets.push("updated_at = datetime('now')");
  params.push(id);
  await run(`UPDATE products SET ${sets.join(", ")} WHERE id = ?`, params);
  return getProduct(id);
}

export async function deleteProduct(id: number): Promise<void> {
  await run("DELETE FROM products WHERE id = ?", [id]);
}
