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

export async function handleCatalog(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return json(405, { error: "method_not_allowed" }, { allow: "GET, HEAD" });
  }
  const version = new URL(req.url).searchParams.get("v") ?? "1";
  if (version !== "1") return json(400, { error: "unsupported_api_version", supported: ["1"] });

  const now = (deps.now ?? (() => new Date()))();
  let body: string;
  try {
    const snapshot = buildSnapshot(await loadCatalogRows(deps.db, { now }), now);
    // El ETag ignora generated_at para que el mismo contenido dé 304.
    const { meta, ...content } = snapshot as { meta: Record<string, unknown> };
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
