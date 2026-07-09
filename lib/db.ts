import { Pool } from "pg";

// Works with whatever Vercel/Neon names the connection string.
const CONN =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  "";

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
