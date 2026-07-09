// One-time DB setup: creates the tables from db/schema.sql.
// Usage: DATABASE_URL=... node scripts/init-db.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, "..", "db", "schema.sql"), "utf8");

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});
await client.connect();
await client.query(sql);
await client.end();
console.log("✅ schema applied");
