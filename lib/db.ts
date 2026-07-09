import { Pool } from "pg";

// One shared pool across serverless invocations.
const globalForPg = globalThis as unknown as { _pgPool?: Pool };
const pool =
  globalForPg._pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
    max: 3,
  });
if (!globalForPg._pgPool) globalForPg._pgPool = pool;

export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}
