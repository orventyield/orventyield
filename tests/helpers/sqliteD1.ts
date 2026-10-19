import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { D1Like } from "../../src/lib/identity/d1";

/** A real SQLite database exposed through the D1 API surface, loaded with the production migration. */
export function sqliteD1(): { db: D1Like; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(readFileSync(new URL("../../worker/migrations/0001_init.sql", import.meta.url), "utf8"));
  const db: D1Like = {
    prepare: (sql) => ({
      bind: (...v) => ({
        run: async () => raw.prepare(sql).run(...(v as never[])),
        first: async <T>() => ((raw.prepare(sql).get(...(v as never[])) as T | undefined) ?? null),
        all: async <T>() => ({ results: raw.prepare(sql).all(...(v as never[])) as T[] }),
      }),
    }),
  };
  return { db, raw };
}
