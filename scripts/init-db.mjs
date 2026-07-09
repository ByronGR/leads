// One-time DB setup: creates the tables from db/schema.sql.
// Usage: DATABASE_URL=... node scripts/init-db.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, "..", "db", "schema.sql"), "utf8");

const CONN = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL_UNPOOLED || "";
const client = new pg.Client({
  connectionString: CONN,
  ssl: CONN.includes("localhost") ? false : { rejectUnauthorized: false },
});
await client.connect();
await client.query(sql);
await client.end();
console.log("✅ schema applied");
