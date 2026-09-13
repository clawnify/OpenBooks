import { caller, user, type Caller, type RequestLike } from "@clawnify/app";
import { query } from "../db";

/**
 * Who is making a change, as recorded in the books.
 *
 * `kind` is the platform's own caller classification, so the log distinguishes
 * a person from the org's agent without the app having to guess.
 */
export interface Actor {
  actor: string | null;
  actor_kind: Caller;
}

/**
 * Read the actor off a request.
 *
 * Off-platform (a local `pnpm dev`) there are no identity headers, so this
 * yields `{ actor: null, actor_kind: "public" }` rather than inventing a user.
 */
export function actorOf(c: RequestLike): Actor {
  const u = user(c);
  return { actor: u?.email ?? u?.id ?? null, actor_kind: caller(c) };
}

/** An actor for writes with no request behind them (backfills, scripts). */
export const SYSTEM_ACTOR: Actor = { actor: null, actor_kind: "system" };

export interface AuditRow {
  id: number;
  at: string;
  actor: string | null;
  actor_kind: string;
  action: string;
  entity: string;
  entity_id: number | null;
  before_json: string | null;
  after_json: string | null;
}

export async function listAudit(filters: { entity?: string; entity_id?: number; limit?: number } = {}): Promise<AuditRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.entity) { where.push("entity = ?"); params.push(filters.entity); }
  if (filters.entity_id) { where.push("entity_id = ?"); params.push(filters.entity_id); }
  // ?? only falls back on null/undefined, so an unparsable `limit` (Number("abc")
  // is NaN, not undefined) would otherwise reach the query below as `LIMIT NaN`.
  const requested = Number.isFinite(filters.limit) ? (filters.limit as number) : 200;
  const limit = Math.min(Math.max(Math.trunc(requested), 1), 1000);
  return query<AuditRow>(
    `SELECT * FROM audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ${limit}`,
    params,
  );
}
