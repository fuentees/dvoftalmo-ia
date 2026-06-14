import mysql from "mysql2/promise";
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
    connectTimeout: 10000
  });
}

export function isNotificationConnectionError(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|fetch failed|connect/i.test(msg);
}

async function readNotificationRowsFromCache(limit?: number) {
  const supabase = createAdminClient();
  const { count, error: countError } = await supabase
    .from("cevesp_notificacoes")
    .select("id", { count: "exact", head: true });
  if (countError) throw new Error(`Erro ao consultar cache CEVESP: ${countError.message}`);

  const pageSize = 1000;
  const maxRows = limit ?? count ?? 0;
  const rows: Array<Record<string, unknown>> = [];

  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize - 1, maxRows - 1);
    const { data, error } = await supabase
      .from("cevesp_notificacoes")
      .select("*")
      .range(from, to);
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

export async function readNotificationRows(limit?: number) {
  let table: string;
  let connection: Awaited<ReturnType<typeof createNotificationConnection>>;
  try {
    table = quoteIdentifier(requireEnv("NOTIFY_DB_TABLE"));
    connection = await createNotificationConnection();
  } catch (error) {
    if (isNotificationConnectionError(error) || !process.env.NOTIFY_DB_HOST) {
      return readNotificationRowsFromCache(limit);
    }
    throw error;
  }

  try {
    const [countRows] = await connection.query(`select count(*) as total from ${table}`);
    const [rows] = limit
      ? await connection.query(`select * from ${table} limit ?`, [limit])
      : await connection.query(`select * from ${table}`);
    const total = Array.isArray(countRows) ? Number((countRows[0] as any)?.total ?? 0) : 0;

    return {
      total,
      limit,
      rows: rows as Array<Record<string, unknown>>,
      source: "mysql" as const
    };
  } catch (error) {
    if (isNotificationConnectionError(error)) {
      return readNotificationRowsFromCache(limit);
    }
    throw error;
  } finally {
    await connection.end();
  }
}
