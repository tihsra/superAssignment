import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import fs from "fs";
import path from "path";
import { config } from "../config";

/** text-embedding-004 produces 768-dimensional vectors. */
export const EMBEDDING_DIM = 768;

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Loads the sqlite-vec extension so `vec0` virtual tables and vector
  // distance functions are available on this connection.
  sqliteVec.load(db);

  const schemaSql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  db.exec(schemaSql);

  // distance_metric=cosine so nearest-neighbor queries return cosine distance
  // directly; the matching layer converts this to similarity = 1 - distance.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_facts USING vec0(
      embedding float[${EMBEDDING_DIM}] distance_metric=cosine
    );
  `);

  dbInstance = db;
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
