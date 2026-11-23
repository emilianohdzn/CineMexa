// Manejador HTTP de Mexa (Fase A, sin modelo). POST {"question": "..."} o GET ?q=... → MexaAnswer.
// Lee lo mismo que el catálogo, como `anon` (RLS), así que sólo responde con datos publicables.
import type { Db } from "../collectors/lib/db.ts";
import { loadCatalogRows } from "../catalog/queries.ts";
import { answerQuestion } from "./answer.ts";

export interface MexaDeps {
  db: Db;
  now?: () => Date;
  /** Segundos que se reutiliza el catálogo leído entre preguntas (0 = siempre se lee). */
  cacheSeconds?: number;
  /** Preguntas por minuto por cliente (x-forwarded-for); 0 = sin límite. */
  perMinute?: number;
}

// Estado por instancia de la función: caché del catálogo y contador por cliente en ventanas de un minuto.
let cache: { at: number; rows: Awaited<ReturnType<typeof loadCatalogRows>> } | null = null;
const hits = new Map<string, { minute: number; count: number }>();

/** Sólo para pruebas. */
export function resetMexaState() { cache = null; hits.clear(); }

function allowed(key: string, nowMs: number, perMinute: number): boolean {
  if (perMinute <= 0) return true;
  const minute = Math.floor(nowMs / 60_000);
  const h = hits.get(key);
  if (!h || h.minute !== minute) {
    if (hits.size > 5_000) hits.clear();
    hits.set(key, { minute, count: 1 });
    return true;
  }
  h.count++;
  return h.count <= perMinute;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export async function handleMexa(req: Request, deps: MexaDeps): Promise<Response> {
  let question: unknown;
  if (req.method === "GET") question = new URL(req.url).searchParams.get("q");
  else if (req.method === "POST") { try { question = ((await req.json()) as { question?: unknown }).question; } catch { question = null; } }
  else return json(405, { error: "method_not_allowed" });
  if (typeof question !== "string" || question.trim().length < 3 || question.length > 300) {
    return json(400, { error: "invalid_question", message: "Escribe una pregunta de 3 a 300 caracteres." });
  }
  const now = deps.now?.() ?? new Date();
  const client = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "anon";
  if (!allowed(client, now.getTime(), deps.perMinute ?? 20)) {
    return new Response(JSON.stringify({ error: "rate_limited", message: "Demasiadas preguntas seguidas. Espera un minuto." }),
      { status: 429, headers: { "content-type": "application/json; charset=utf-8", "retry-after": "60" } });
  }
  try {
    const ttl = (deps.cacheSeconds ?? 60) * 1000;
    if (!cache || ttl === 0 || now.getTime() - cache.at > ttl) {
      cache = { at: now.getTime(), rows: await loadCatalogRows(deps.db, { now, trendHistory: 1, reviewsLimit: 1000, newsLimit: 0 }) };
    }
    const rows = cache.rows;
    return json(200, { api_version: "mexa-a1", generated_at: now.toISOString(), ...answerQuestion(question.trim(), rows, now) });
  } catch (error) {
    console.error("mexa: fallo al consultar", error);
    return json(503, { error: "unavailable", message: "Mexa no pudo consultar el catálogo. Intenta de nuevo." });
  }
}
