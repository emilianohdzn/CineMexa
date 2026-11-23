// Conector de festivales en Wikidata (datos abiertos, CC0). Tres pasos, todos con evidencia:
// 1. Identidad: vincula cada festival del directorio con su elemento de Wikidata sólo si la web oficial (P856)
//    coincide por dominio y hay un único candidato.
// 2. Ediciones: crea ediciones con fecha de inicio (P580) publicada en Wikidata cuando todavía no existen en la base.
//    Las ediciones capturadas con fuente propia (seed) nunca se sobrescriben.
// 3. Actividad verificada: premios (P166) y nominaciones (P1411) de películas mexicanas cuyo premio pertenece al festival
//    (P1027 "otorgado por" o P361 "parte de"), SÓLO si la declaración tiene referencia. Se ligan a la edición del año.
//    Si no hay edición para ese año, no se crea nada: no se deduce la participación.
// Uso: node collectors/wikidata/festivals.ts [--from-year 2024]
import { fileURLToPath } from "node:url";
import { fetchJson, type FetchOptions } from "../lib/http.ts";
import { openPostgres, type Db } from "../lib/db.ts";
import { finishRun, linkSourceRecord, recordSource, startRun, type RunStatus } from "../lib/runs.ts";
import { WIKIDATA_ENDPOINT } from "./sparql.ts";

type Binding = Record<string, { value: string } | undefined>;
interface SparqlJson { results: { bindings: Binding[] } }

const qid = (iri?: string) => iri?.match(/(Q\d+)$/)?.[1] ?? null;
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };
const sparqlUrl = (q: string) => `${WIKIDATA_ENDPOINT}?format=json&query=${encodeURIComponent(q)}`;

export function festivalIdentityQuery(domains: string[]): string {
  const filters = domains.map((d) => `CONTAINS(LCASE(STR(?site)), "${d.replace(/[^a-z0-9.-]/g, "")}")`).join(" || ");
  return `SELECT ?fest ?site WHERE {
  ?fest wdt:P31/wdt:P279* wd:Q220505 ; wdt:P856 ?site .
  FILTER NOT EXISTS { ?fest wdt:P179 ?serie . }   # una edición comparte el dominio del festival: se excluye
  FILTER(${filters})
}`;
}

export function editionsQuery(festQids: string[], fromYear: number): string {
  return `SELECT ?fest ?ed ?start ?end ?num WHERE {
  VALUES ?fest { ${festQids.map((q) => `wd:${q}`).join(" ")} }
  ?ed (wdt:P179|wdt:P361) ?fest ; wdt:P580 ?start .
  OPTIONAL { ?ed wdt:P582 ?end . }
  OPTIONAL { ?ed wdt:P393 ?num . }
  FILTER(YEAR(?start) >= ${fromYear})
}`;
}

export function activityQuery(festQids: string[], fromYear: number): string {
  // Parte de los premios del festival (pocos) y con el optimizador apagado: en el orden contrario (todas las películas
  // mexicanas primero) WDQS pasa de sus 60 s y responde 504.
  return `SELECT ?st ?film ?kind ?award ?awardLabel ?fest ?time ?ref WHERE {
  hint:Query hint:optimizer "None" .
  VALUES ?fest { ${festQids.map((q) => `wd:${q}`).join(" ")} }
  ?award (wdt:P1027|wdt:P361) ?fest .
  { ?st ps:P166 ?award . ?film p:P166 ?st . BIND("award" AS ?kind) }
  UNION
  { ?st ps:P1411 ?award . ?film p:P1411 ?st . BIND("nomination" AS ?kind) }
  ?film wdt:P495 wd:Q96 .
  ?st pq:P585 ?time .
  FILTER(YEAR(?time) >= ${fromYear})
  ?st prov:wasDerivedFrom ?r .
  OPTIONAL { ?r pr:P854 ?ref . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
}`;
}

export interface FestivalActivity { statement: string; filmQid: string; kind: "award" | "nomination"; awardLabel: string; festQid: string; year: number; ref: string | null }
export interface WikidataEdition { festQid: string; edQid: string; start: string; end: string | null; num: string | null }

export function parseIdentity(json: SparqlJson): Array<{ festQid: string; host: string }> {
  return json.results.bindings.flatMap((b) => {
    const festQid = qid(b.fest?.value), host = b.site ? hostOf(b.site.value) : null;
    return festQid && host ? [{ festQid, host }] : [];
  });
}

export function parseEditions(json: SparqlJson): WikidataEdition[] {
  return json.results.bindings.flatMap((b) => {
    const festQid = qid(b.fest?.value), edQid = qid(b.ed?.value), start = b.start?.value?.slice(0, 10);
    if (!festQid || !edQid || !start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return [];
    const end = b.end?.value?.slice(0, 10) ?? null;
    return [{ festQid, edQid, start, end: end && end >= start ? end : null, num: b.num?.value ?? null }];
  });
}

export function parseActivity(json: SparqlJson): FestivalActivity[] {
  const seen = new Set<string>();
  return json.results.bindings.flatMap((b) => {
    const statement = b.st?.value?.split("/").pop() ?? "";
    const filmQid = qid(b.film?.value), festQid = qid(b.fest?.value), year = Number(b.time?.value?.slice(0, 4));
    const kind = b.kind?.value === "award" ? "award" : b.kind?.value === "nomination" ? "nomination" : null;
    const awardLabel = b.awardLabel?.value ?? "";
    // Sin etiqueta legible (sólo el Q-id) no se publica: no sabríamos cómo se llama el premio.
    if (!statement || !filmQid || !festQid || !kind || !Number.isInteger(year) || !awardLabel || /^Q\d+$/.test(awardLabel)) return [];
    const key = `${statement}|${festQid}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ statement, filmQid, kind, awardLabel, festQid, year, ref: b.ref?.value ?? null }];
  });
}

export interface FestivalRunOptions { userAgent: string; fromYear?: number; http?: Omit<FetchOptions, "headers"> }

export async function runWikidataFestivals(db: Db, opts: FestivalRunOptions) {
  if (!opts.userAgent || /definir/i.test(opts.userAgent)) throw new Error("WIKIDATA_USER_AGENT debe identificar el proyecto y un contacto.");
  const { fromYear = 2024, http = {} } = opts;
  const get = (q: string) => fetchJson<SparqlJson>(sparqlUrl(q), { ...http, headers: { "User-Agent": opts.userAgent, Accept: "application/sparql-results+json" } });
  const runId = await startRun(db, "wikidata", "festival_activity", { fromYear });
  const counts = { linked: 0, editions: 0, events: 0, skippedNoEdition: 0, skippedNoFilm: 0 };
  const errors: string[] = [];
  const warnings: string[] = [];
  try {
    // 1) Identidad por dominio oficial.
    const { rows: fests } = await db.query<{ id: string; slug: string; website_url: string | null; wikidata_id: string | null }>(
      "select id::text, slug, website_url, wikidata_id from festivals");
    const byHost = new Map(fests.flatMap((f) => { const h = f.website_url ? hostOf(f.website_url) : null; return h ? [[h, f] as const] : []; }));
    const candidates = parseIdentity(await get(festivalIdentityQuery([...byHost.keys()])));
    const qidsByFest = new Map<string, Set<string>>();
    for (const c of candidates) {
      const f = byHost.get(c.host);
      if (f) (qidsByFest.get(f.id) ?? qidsByFest.set(f.id, new Set()).get(f.id)!).add(c.festQid);
    }
    for (const f of fests) {
      const set = qidsByFest.get(f.id);
      if (!f.wikidata_id && set?.size === 1) {
        const [q] = [...set];
        const { rows } = await db.query("update festivals set wikidata_id = $2 where id = $1 and wikidata_id is null and not exists (select 1 from festivals where wikidata_id = $2) returning id", [f.id, q]);
        if (rows.length) { f.wikidata_id = q; counts.linked++; }
      }
    }
    const festByQid = new Map(fests.filter((f) => f.wikidata_id).map((f) => [f.wikidata_id!, f]));
    if (festByQid.size === 0) warnings.push("Ningún festival del directorio tiene elemento de Wikidata identificado.");
    else await collectEditionsAndActivity(festByQid);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  async function collectEditionsAndActivity(festByQid: Map<string, { id: string }>) {

    // 2) Ediciones con fecha.
    for (const e of parseEditions(await get(editionsQuery([...festByQid.keys()], fromYear)))) {
      const fest = festByQid.get(e.festQid)!;
      const year = Number(e.start.slice(0, 4));
      const { rows: existing } = await db.query("select 1 from festival_editions where festival_id = $1 and year = $2", [fest.id, year]);
      if (existing.length) continue;
      await db.query(
        `insert into festival_editions (festival_id, edition_label, year, starts_on, ends_on, source_id, source_url, verification)
         values ($1, $2, $3, $4, $5, 'wikidata', $6, 'automatic') on conflict do nothing`,
        [fest.id, e.num ? `${e.num}ª edición` : String(year), year, e.start, e.end, `https://www.wikidata.org/wiki/${e.edQid}`]);
      counts.editions++;
    }

    // 3) Actividad con referencia. Si esta consulta falla, la identidad y las ediciones ya quedaron guardadas.
    let activity: FestivalActivity[];
    try {
      activity = parseActivity(await get(activityQuery([...festByQid.keys()], fromYear)));
    } catch (error) {
      warnings.push(`Actividad no consultada: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    for (const a of activity) {
      const fest = festByQid.get(a.festQid)!;
      const { rows: [film] } = await db.query<{ film_id: string }>(
        "select film_id::text from film_external_ids where provider = 'wikidata' and external_id = $1", [a.filmQid]);
      if (!film) { counts.skippedNoFilm++; continue; }
      const { rows: [edition] } = await db.query<{ id: string }>(
        "select id::text from festival_editions where festival_id = $1 and year = $2 order by starts_on nulls last limit 1", [fest.id, a.year]);
      if (!edition) { counts.skippedNoEdition++; continue; }
      const sourceUrl = a.ref ?? `https://www.wikidata.org/wiki/${a.filmQid}`;
      const { changed, entityId } = await recordSource(db, {
        sourceId: "wikidata", entityType: "festival_event", externalId: a.statement, sourceUrl, payload: a, runId,
      });
      if (!changed && entityId) continue;
      const kind = a.kind === "award" ? "award" : "selection";
      if (entityId) {
        await db.query(`update festival_events set edition_id = $2, kind = $3, award_name = $4, section = $5, source_url = $6, updated_at = now() where id = $1`,
          [entityId, edition.id, kind, a.kind === "award" ? a.awardLabel : null, a.kind === "nomination" ? `En competencia por ${a.awardLabel}` : null, sourceUrl]);
      } else {
        const { rows: [ev] } = await db.query<{ id: string }>(
          `insert into festival_events (edition_id, film_id, kind, section, award_name, source_id, source_url, verification, confidence)
           values ($1, $2, $3, $4, $5, 'wikidata', $6, 'automatic', 0.9) returning id::text`,
          [edition.id, film.film_id, kind, a.kind === "nomination" ? `En competencia por ${a.awardLabel}` : null,
           a.kind === "award" ? a.awardLabel : null, sourceUrl]);
        await linkSourceRecord(db, "wikidata", "festival_event", a.statement, ev.id);
      }
      counts.events++;
    }
  }

  const status: RunStatus = errors.length ? "failed" : warnings.length ? "partial" : "succeeded";
  await finishRun(db, runId, { status, seen: counts.events + counts.skippedNoEdition + counts.skippedNoFilm, upserted: counts.events + counts.editions, error: [...errors, ...warnings].join("\n") || null, meta: { counts } });
  return { status, counts, errors, warnings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const fromYear = args.includes("--from-year") ? Number(args[args.indexOf("--from-year") + 1]) : 2024;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL (conexión del rol de servicio).");
  const { db, end } = await openPostgres(url);
  console.log(JSON.stringify(await runWikidataFestivals(db, { userAgent: process.env.WIKIDATA_USER_AGENT ?? "", fromYear }), null, 2));
  await end();
}
