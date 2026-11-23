// Manejador HTTP de Mexa (Fase A, sin modelo). POST {"question": "..."} o GET ?q=... → MexaAnswer.
// Lee lo mismo que el catálogo, como `anon` (RLS), así que sólo responde con datos publicables.
import type { Db } from "../collectors/lib/db.ts";
import { loadCatalogRows } from "../catalog/queries.ts";
import { answerQuestion } from "./answer.ts";

export interface MexaDeps { db: Db; now?: () => Date }

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
  try {
    const rows = await loadCatalogRows(deps.db, { now, trendHistory: 1, reviewsLimit: 1000, newsLimit: 0 });
    return json(200, { api_version: "mexa-a1", generated_at: now.toISOString(), ...answerQuestion(question.trim(), rows, now) });
  } catch (error) {
    console.error("mexa: fallo al consultar", error);
    return json(503, { error: "unavailable", message: "Mexa no pudo consultar el catálogo. Intenta de nuevo." });
  }
}
