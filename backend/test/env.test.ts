import { test } from "node:test";
import assert from "node:assert/strict";
import { redactor } from "../scripts/env.ts";

test("el redactor oculta secretos, también codificados en URL y la contraseña de la base", () => {
  const env = {
    DATABASE_URL: "postgresql://postgres.abcdefghijklmnopqrst:p%40ss-w0rd-x@aws-0-ca-central-1.pooler.supabase.com:5432/postgres",
    TMDB_API_READ_TOKEN: "eyJhbGciOi.prueba.firma",
    YOUTUBE_API_KEY: "AIzaPRUEBA_0123456789abcdefghijklmnopq",
    SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  };
  const r = redactor(env);
  const leaked = r(`fallo en https://x?key=${encodeURIComponent(env.YOUTUBE_API_KEY)} con ${env.TMDB_API_READ_TOKEN}; pass p@ss-w0rd-x; ${env.DATABASE_URL}`);
  for (const v of [env.YOUTUBE_API_KEY, env.TMDB_API_READ_TOKEN, "p@ss-w0rd-x", env.DATABASE_URL]) assert.ok(!leaked.includes(v));
  assert.ok(r(env.SUPABASE_URL).includes("supabase.co"), "la URL pública no es secreta");
});
