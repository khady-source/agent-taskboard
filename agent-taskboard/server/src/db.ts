import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

export type Db = pg.Pool;

export function createPool(connectionString = process.env.DATABASE_URL): Db {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set (see .env.example)");
  }
  return new pg.Pool({ connectionString, max: 10 });
}

/** Creates tables if they don't exist yet. */
export async function migrate(db: Db): Promise<void> {
  const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));
  const sql = await readFile(schemaPath, "utf8");
  await db.query(sql);
}
