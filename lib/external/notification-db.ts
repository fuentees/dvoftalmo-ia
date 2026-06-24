import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { createAdminClient } from "@/lib/supabase/admin";

const identifierPattern = /^[a-zA-Z0-9_]+$/;

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Variavel ${name} nao configurada.`);
  return value;
}

function quoteIdentifier(value: string) {
  if (!identifierPattern.test(value)) throw new Error(`Identificador invalido: ${value}`);
  return `\`${value}\``;
}

export function getNotificationTableName() {
  return requireEnv("NOTIFY_DB_TABLE");
}

export async function createNotificationConnection() {
  return mysql.createConnection({
    host: requireEnv("NOTIFY_DB_HOST"),
    port: Number(process.env.NOTIFY_DB_PORT ?? 3306),
    database: requireEnv("NOTIFY_DB_NAME"),
    user: requireEnv("NOTIFY_DB_USER"),
    password: requireEnv("NOTIFY_DB_PASSWORD"),
    charset: "utf8mb4",
    connectTimeout: 10000,
    supportBigNumbers: true,
    bigNumberStrings: true
  });
}

export function isNotificationConnectionError(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|fetch failed|connect/i.test(msg);
}

export interface NotificationRowsFilter {
  ano?: number;
  gve?: string;
  municipio?: string;
  seInicio?: number;
  seFim?: number;
  limit?: number;
}

async function readNotificationRowsFromCache(filter: NotificationRowsFilter = {}) {
  const { ano, gve, municipio, seInicio, seFim, limit } = filter;
  const supabase = createAdminClient();
  let q = supabase.from("cevesp_notificacoes").select("id", { count: "exact", head: true });
  if (ano) q = q.eq('"ANO"', ano) as typeof q;
  if (gve) q = q.eq('"GVE_NOME"', gve) as typeof q;
  if (municipio) q = q.ilike('"MunicipioNotificacao"', `%${municipio}%`) as typeof q;
  if (seInicio != null) q = q.gte('"SemEpidemio"', seInicio) as typeof q;
  if (seFim != null) q = q.lte('"SemEpidemio"', seFim) as typeof q;
  const { count, error: countError } = await q;
  if (countError) throw new Error(`Erro ao consultar cache CEVESP: ${countError.message}`);

  const pageSize = 1000;
  const maxRows = limit ?? count ?? 0;
  const rows: Array<Record<string, unknown>> = [];

  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize - 1, maxRows - 1);
    let dq = supabase.from("cevesp_notificacoes").select("*").range(from, to);
    if (ano) dq = dq.eq('"ANO"', ano) as typeof dq;
    if (gve) dq = dq.eq('"GVE_NOME"', gve) as typeof dq;
    if (municipio) dq = dq.ilike('"MunicipioNotificacao"', `%${municipio}%`) as typeof dq;
    if (seInicio != null) dq = dq.gte('"SemEpidemio"', seInicio) as typeof dq;
    if (seFim != null) dq = dq.lte('"SemEpidemio"', seFim) as typeof dq;
    const { data, error } = await dq;
    if (error) throw new Error(`Erro ao ler cache CEVESP: ${error.message}`);
    rows.push(...((data ?? []) as Array<Record<string, unknown>>));
    if (!data || data.length < pageSize) break;
  }

  return {
    total: count ?? rows.length,
    limit: limit ?? null,
    rows,
    source: "cache" as const
  };
}

export async function readNotificationRows(filter: NotificationRowsFilter = {}) {
  const { ano, gve, municipio, seInicio, seFim, limit } = filter;

  let table: string;
  let connection: Awaited<ReturnType<typeof createNotificationConnection>>;
  try {
    table = quoteIdentifier(requireEnv("NOTIFY_DB_TABLE"));
    connection = await createNotificationConnection();
  } catch (error) {
    if (isNotificationConnectionError(error) || !process.env.NOTIFY_DB_HOST) {
      return readNotificationRowsFromCache(filter);
    }
    throw error;
  }

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (ano) { conditions.push("ANO = ?"); params.push(ano); }
  if (gve) { conditions.push("GVE_NOME = ?"); params.push(gve); }
  if (municipio) { conditions.push("MunicipioNotificacao LIKE ?"); params.push(`%${municipio}%`); }
  if (seInicio != null) { conditions.push("SemEpidemio >= ?"); params.push(seInicio); }
  if (seFim != null) { conditions.push("SemEpidemio <= ?"); params.push(seFim); }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const [countRows] = await connection.query<Array<RowDataPacket & { total: number }>>(
      `SELECT count(*) as total FROM ${table} ${whereClause}`, params
    );
    const [rows] = limit
      ? await connection.query(`SELECT * FROM ${table} ${whereClause} LIMIT ?`, [...params, limit])
      : await connection.query(`SELECT * FROM ${table} ${whereClause}`, params);
    const total = Number(countRows[0]?.total ?? 0);

    return {
      total,
      limit,
      rows: rows as Array<Record<string, unknown>>,
      source: "mysql" as const
    };
  } catch (error) {
    if (isNotificationConnectionError(error)) {
      return readNotificationRowsFromCache(filter);
    }
    throw error;
  } finally {
    await connection.end();
  }
}
