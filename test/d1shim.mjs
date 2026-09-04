// Минимальный шим D1 поверх node:sqlite — ровно та часть API, которую использует воркер.
import { DatabaseSync } from "node:sqlite";

export function makeD1(schemaSql) {
  const db = new DatabaseSync(":memory:");
  for (const statement of schemaSql.split(";")) {
    if (statement.trim()) db.exec(statement);
  }
  return {
    prepare(sql) {
      let params = [];
      const api = {
        bind(...args) { params = args; return api; },
        async all() { return { results: db.prepare(sql).all(...params) }; },
        async first() { return db.prepare(sql).get(...params) ?? null; },
        async run() { return db.prepare(sql).run(...params); },
      };
      return api;
    },
  };
}
