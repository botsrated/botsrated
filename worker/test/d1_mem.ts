import { DatabaseSync } from "node:sqlite";
import type { SqlDb } from "../src/ledger.ts";

export interface MemDb extends SqlDb {
  exec(sql: string): void;
  rows(sql: string, ...params: Array<string | number | null>): Array<Record<string, unknown>>;
}

/** In-memory D1-shaped wrapper around node:sqlite. */
export function openMem(): MemDb {
  const db = new DatabaseSync(":memory:");
  return {
    exec(sql: string) {
      db.exec(sql);
    },
    rows(sql: string, ...params: Array<string | number | null>) {
      return db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    },
    prepare(sql: string) {
      return {
        bind(...params: Array<string | number | null>) {
          const stmt = db.prepare(sql);
          return {
            async run() {
              stmt.run(...params);
              return { success: true };
            },
            async all<T>() {
              return { results: stmt.all(...params) as T[] };
            },
            async first<T>() {
              const row = stmt.get(...params) as T | undefined;
              return row ?? null;
            },
          };
        },
      };
    },
  };
}
