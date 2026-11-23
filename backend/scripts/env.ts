// Carga backend/.env.local sin imprimir nada y ofrece un redactor para que ningún valor secreto
// llegue a la consola, a los logs ni a los errores.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const ENV_PATH = join(import.meta.dirname, "..", ".env.local");
const SECRET_KEYS = ["DATABASE_URL", "TMDB_API_READ_TOKEN", "YOUTUBE_API_KEY", "SUPABASE_PUBLISHABLE_KEY"];

export function loadLocalEnv(): Record<string, string> {
  const mode = statSync(ENV_PATH).mode & 0o777;
  if (mode & 0o077) throw new Error(`backend/.env.local debe tener permiso 600 (tiene ${mode.toString(8)}).`);
  const env: Record<string, string> = {};
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v;
  return env;
}

/** Reemplaza cualquier valor secreto (y su forma codificada en URL) por ***. */
export function redactor(env: Record<string, string>) {
  const values = SECRET_KEYS.map((k) => env[k]).filter((v): v is string => !!v && v.length >= 8);
  const password = (() => { try { return decodeURIComponent(new URL(env.DATABASE_URL).password); } catch { return ""; } })();
  if (password.length >= 6) values.push(password);
  const all = values.flatMap((v) => [v, encodeURIComponent(v)]);
  return (text: unknown) => all.reduce((t, v) => t.split(v).join("***"), String(text));
}
