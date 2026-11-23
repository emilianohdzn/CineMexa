// Edge Function `catalog` (Supabase, Deno): GET /functions/v1/catalog?v=1 → CatalogSnapshot.
// Lee con la conexión directa a Postgres que Supabase inyecta (SUPABASE_DB_URL) pero cada consulta
// corre como rol `anon`, así que sólo sale lo que RLS permite publicar. No usa ni expone service_role.
import postgres from "npm:postgres@3.4.5";
import { handleCatalog } from "../../../catalog/handler.ts";
import type { Db } from "../../../collectors/lib/db.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, prepare: false });
// Una conexión reservada por petición para que begin / set local role / commit vayan juntos.
async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const conn = await sql.reserve();
  try {
    return await fn({ query: async (q, params = []) => ({ rows: await conn.unsafe(q, params as never[]) as never[] }) });
  } finally {
    conn.release();
  }
}

Deno.serve((req) => withDb((db) => handleCatalog(req, { db })));
