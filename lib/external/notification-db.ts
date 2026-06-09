import mysql from "mysql2/promise";

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

export async function readNotificationRows(limit = 5000) {
  const table = quoteIdentifier(requireEnv("NOTIFY_DB_TABLE"));
  const connection = await createNotificationConnection();

  try {
    const [countRows] = await connection.query(`select count(*) as total from ${table}`);
    const [rows] = await connection.query(`select * from ${table} limit ?`, [limit]);
    const total = Array.isArray(countRows) ? Number((countRows[0] as any)?.total ?? 0) : 0;

    return {
      total,
      limit,
      rows: rows as Array<Record<string, unknown>>
    };
  } finally {
    await connection.end();
  }
}
