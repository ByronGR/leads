import { Pool } from "pg";

// Works with whatever Vercel/Neon names the connection string.
// Falls back to scanning env for any *_URL that looks like a Postgres DSN,
// so a custom prefix (e.g. STORAGE_URL) still works without code changes.
function resolveConn(): string {
  const named =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.STORAGE_URL ||
    process.env.STORAGE_POSTGRES_URL ||
    "";
  if (named) return named;
  for (const [k, v] of Object.entries(process.env)) {
    if (
      typeof v === "string" &&
      /_URL$/.test(k) &&
      /^postgres(ql)?:\/\//.test(v)
    ) {
      return v;
    }
  }
  return "";
}
const CONN = resolveConn();

// One shared pool across serverless invocations.
const globalForPg = globalThis as unknown as { _pgPool?: Pool };
const pool =
  globalForPg._pgPool ??
  new Pool({
    connectionString: CONN,
    ssl: CONN.includes("localhost") ? false : { rejectUnauthorized: false },
    max: 3,
  });
if (!globalForPg._pgPool) globalForPg._pgPool = pool;

export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}
