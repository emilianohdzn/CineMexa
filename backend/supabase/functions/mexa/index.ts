// Edge Function `mexa` (Supabase, Deno): preguntas sobre el catálogo, Fase A sin modelo de lenguaje (costo $0).
// POST /functions/v1/mexa {"question": "..."} o GET ?q=... Lee como rol `anon` (RLS), como `catalog`.
// La lógica vive en backend/mexa y se empaqueta antes de desplegar: `npm run build:catalog`.
import postgres from "npm:postgres@3.4.5";
// @ts-ignore: módulo generado
import { handleMexa } from "./_bundle/handler.js";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, prepare: false });

Deno.serve(async (req: Request) => {
  const conn = await sql.reserve();
  try {
    return await handleMexa(req, {
      db: { query: async (q: string, params: unknown[] = []) => ({ rows: await conn.unsafe(q, params as never[]) }) },
    });
  } finally {
    conn.release();
  }
});
