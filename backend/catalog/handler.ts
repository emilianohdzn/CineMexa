// Manejador HTTP del catálogo, independiente del runtime (Deno en Supabase, Node en pruebas).
import type { Db } from "../collectors/lib/db.ts";
import { loadCatalogRows } from "./queries.ts";
import { buildSnapshot } from "./snapshot.ts";

export interface HandlerDeps {
  db: Db;
  now?: () => Date;
  /** Segundos de caché en el CDN / cliente. */
  maxAge?: number;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

/** Huella corta y estable del contenido de una película (la usa la sincronización incremental). */
export async function filmHash(film: unknown): Promise<string> {
  return (await sha256(JSON.stringify(film))).slice(0, 16);
}

/**
 * Sincronización incremental (contrato v1, aditivo):
 * - GET devuelve el snapshot completo y, en `meta.film_hashes`, la huella de cada película.
 * - POST ?delta=1 con `{"known_films": [{"id", "hash"}]}` devuelve el mismo snapshot, pero `films` sólo trae las
 *   películas nuevas o cambiadas; `meta.delta.film_ids` es el orden completo vigente (lo que no aparece ahí se
 *   eliminó). Las demás secciones van completas: son pequeñas y así se eliminan sin listas aparte.
 * Por huellas de contenido y no por fecha: funciona igual tras días sin conexión y detecta cambios de pósters o créditos
 * aunque la película no cambie su updated_at. Si algo falla, la app vuelve a pedir el catálogo completo.
 */
async function readKnownFilms(req: Request): Promise<Map<string, string> | null> {
  try {
    const body = (await req.json()) as { known_films?: Array<{ id?: unknown; hash?: unknown }> };
    if (!Array.isArray(body.known_films) || body.known_films.length > 20_000) return null;
    const known = new Map<string, string>();
    for (const k of body.known_films) if (typeof k.id === "string" && typeof k.hash === "string") known.set(k.id, k.hash);
    return known;
  } catch {
    return null;
  }
}

export async function handleCatalog(req: Request, deps: HandlerDeps): Promise<Response> {
  const url = new URL(req.url);
  const isDelta = req.method === "POST" && url.searchParams.get("delta") === "1";
  if (req.method !== "GET" && req.method !== "HEAD" && !isDelta) {
    return json(405, { error: "method_not_allowed" }, { allow: "GET, HEAD, POST ?delta=1" });
  }
  const version = url.searchParams.get("v") ?? "1";
  if (version !== "1") return json(400, { error: "unsupported_api_version", supported: ["1"] });
  const known = isDelta ? await readKnownFilms(req) : null;
  if (isDelta && !known) return json(400, { error: "invalid_delta_request" });

  const now = (deps.now ?? (() => new Date()))();
  let body: string;
  try {
    const snapshot = buildSnapshot(await loadCatalogRows(deps.db, { now }), now) as { meta: Record<string, unknown>; films: Array<{ id: string }> };
    const hashes = await Promise.all(snapshot.films.map(async (f) => ({ id: f.id, hash: await filmHash(f) })));
    if (isDelta) {
      const changed = snapshot.films.filter((_, i) => known!.get(hashes[i].id) !== hashes[i].hash);
      const delta = {
        ...snapshot, films: changed,
        meta: { ...snapshot.meta, film_hashes: hashes, delta: { film_ids: hashes.map((h) => h.id), changed: changed.length, total: hashes.length } },
      };
      return json(200, delta, { "cache-control": "no-store" });
    }
    // El ETag ignora generated_at para que el mismo contenido dé 304.
    const { meta, ...content } = snapshot;
    snapshot.meta = { ...meta, film_hashes: hashes };
    const etag = `"${(await sha256(JSON.stringify({ ...content, sources: meta.sources }))).slice(0, 32)}"`;
    if (req.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { etag } });
    }
    body = JSON.stringify(snapshot);
    const maxAge = deps.maxAge ?? 300;
    return new Response(req.method === "HEAD" ? null : body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 12}`,
        etag,
      },
    });
  } catch (error) {
    // La app conserva su caché y muestra el error; nunca se inventa un catálogo vacío como válido.
    console.error("catalog: fallo al armar el snapshot", error);
    return json(503, { error: "catalog_unavailable" }, { "retry-after": "60" });
  }
}
