// Pruebas de conexión reales y limitadas. Imprime sólo OK/FALLA, códigos y conteos; nunca valores.
// Uso: node backend/scripts/verificar-conexiones.ts
import { loadLocalEnv, redactor } from "./env.ts";

const env = loadLocalEnv();
const redact = redactor(env);
const results: Array<{ servicio: string; ok: boolean; detalle: string }> = [];

async function check(servicio: string, fn: () => Promise<string>) {
  try {
    results.push({ servicio, ok: true, detalle: await fn() });
  } catch (error) {
    results.push({ servicio, ok: false, detalle: redact(error instanceof Error ? error.message : error).slice(0, 300) });
  }
}

async function get(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<any>;
}

await check("Wikidata (SPARQL, 3 filas)", async () => {
  const q = "SELECT ?film WHERE { ?film wdt:P495 wd:Q96 ; wdt:P31 wd:Q11424 . } LIMIT 3";
  const json = await get(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`,
    { "User-Agent": env.WIKIDATA_USER_AGENT, Accept: "application/sparql-results+json" });
  return `${json.results.bindings.length} películas mexicanas de muestra`;
});

await check("TMDB (autenticación)", async () => {
  const json = await get("https://api.themoviedb.org/3/authentication", { Authorization: `Bearer ${env.TMDB_API_READ_TOKEN}` });
  if (!json.success) throw new Error("TMDB rechazó el token");
  return "token válido";
});

await check("YouTube Data API (1 unidad de cuota)", async () => {
  const json = await get(`https://www.googleapis.com/youtube/v3/i18nRegions?part=snippet&hl=es&key=${encodeURIComponent(env.YOUTUBE_API_KEY)}`);
  return `clave válida (${json.items?.length ?? 0} regiones)`;
});

await check("Supabase Postgres (sólo lectura)", async () => {
  const { default: postgres } = await import("postgres");
  const sql = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 20, prepare: false });
  try {
    const [v] = await sql`select current_setting('server_version') as version`;
    const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`;
    const hasSchema = tables.some((t) => t.table_name === "films");
    return `Postgres ${v.version}; ${tables.length} tablas en public; esquema de Cine Mexa ${hasSchema ? "presente" : "aún no aplicado"}`;
  } finally {
    await sql.end();
  }
});

await check("Supabase API pública (Publishable Key)", async () => {
  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/catalog?v=1`, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404) return "proyecto accesible; la función catalog todavía no está desplegada";
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return `catalog responde: modo ${body.meta?.mode}, ${body.films?.length ?? 0} películas`;
});

for (const r of results) console.log(`${r.ok ? "OK   " : "FALLA"}  ${r.servicio}: ${r.detalle}`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
