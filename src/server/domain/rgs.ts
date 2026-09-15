import { get, query, run } from "../db";
import starter from "./rgs-starter.json";

export interface Account {
  rgs_code: string;
  reknr: string | null;
  parent_code: string | null;
  nivo: number;
  omskort: string;
  omslang: string | null;
  dc: "D" | "C" | null;
  bw: "B" | "W";
  sortimentcode: string | null;
  is_leaf: number;
  created_at?: string;
}

export interface AccountNode extends Account {
  children: AccountNode[];
}

interface StarterEntry {
  rgs_code: string;
  reknr?: string | null;
  parent_code: string | null;
  nivo: number;
  omskort: string;
  omslang?: string | null;
  dc?: "D" | "C" | null;
  bw: "B" | "W";
  sortimentcode?: string | null;
}

export async function listAccounts(filters: { bw?: string; nivo?: number; parent?: string } = {}): Promise<Account[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.bw) { where.push("bw = ?"); params.push(filters.bw); }
  if (filters.nivo !== undefined) { where.push("nivo = ?"); params.push(filters.nivo); }
  if (filters.parent !== undefined) { where.push("parent_code IS ?"); params.push(filters.parent || null); }
  const sql = `SELECT * FROM accounts ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY rgs_code`;
  return query<Account>(sql, params);
}

export async function getAccount(code: string): Promise<Account | undefined> {
  return get<Account>("SELECT * FROM accounts WHERE rgs_code = ?", [code]);
}

export async function getTree(): Promise<AccountNode[]> {
  const rows = await query<Account>("SELECT * FROM accounts ORDER BY rgs_code");
  const byCode = new Map<string, AccountNode>();
  for (const r of rows) byCode.set(r.rgs_code, { ...r, children: [] });
  const roots: AccountNode[] = [];
  for (const node of byCode.values()) {
    if (node.parent_code && byCode.has(node.parent_code)) {
      byCode.get(node.parent_code)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export async function loadStarter(): Promise<{ inserted: number; total: number }> {
  const entries = (starter as { accounts: StarterEntry[] }).accounts;
  let inserted = 0;
  for (const a of entries) {
    const rows = await query<{ rgs_code: string }>(
      `INSERT OR REPLACE INTO accounts
        (rgs_code, reknr, parent_code, nivo, omskort, omslang, dc, bw, sortimentcode, is_leaf)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING rgs_code`,
      [
        a.rgs_code,
        a.reknr ?? null,
        a.parent_code,
        a.nivo,
        a.omskort,
        a.omslang ?? null,
        a.dc ?? null,
        a.bw,
        a.sortimentcode ?? null,
        a.reknr ? 1 : 0,
      ],
    );
    inserted += rows.length;
  }
  const total = (await get<{ c: number }>("SELECT COUNT(*) AS c FROM accounts"))?.c ?? 0;
  return { inserted, total };
}

export async function clearAccounts(): Promise<void> {
  await run("DELETE FROM accounts");
}
