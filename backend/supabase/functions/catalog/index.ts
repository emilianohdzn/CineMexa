// Edge Function `catalog` (Supabase, Deno): GET /functions/v1/catalog?v=1 → CatalogSnapshot.
// Lee con la conexión directa a Postgres que Supabase inyecta (SUPABASE_DB_URL), pero cada consulta
// corre como rol `anon`, así que sólo sale lo que RLS permite publicar. No usa ni expone service_role.
// La lógica vive en backend/catalog y se empaqueta antes de desplegar: `npm run build:catalog`.
import postgres from "npm:postgres@3.4.5";
// @ts-ignore: módulo generado
import { handleCatalog } from "./_bundle/handler.js";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, prepare: false });

Deno.serve(async (req: Request) => {
  // Una conexión reservada por petición para que begin / set local role / commit vayan juntos.
  const conn = await sql.reserve();
  try {
    return await handleCatalog(req, {
      db: { query: async (q: string, params: unknown[] = []) => ({ rows: await conn.unsafe(q, params as never[]) }) },
    });
  } finally {
    conn.release();
  }
});
