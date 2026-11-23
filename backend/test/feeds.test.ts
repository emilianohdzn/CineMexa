// Crítica y noticias desde feeds: sólo metadatos, vinculación con evidencia y cola de revisión.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { freshDb, type TestDb } from "./helpers/db.ts";
import { parseFeed } from "../collectors/feeds/parse.ts";
import { classifyArticle, filmKey, matchArticle, newsKind } from "../collectors/feeds/match.ts";
import { runFeeds } from "../collectors/feeds/run.ts";
import { decide, listPending } from "../collectors/lib/review-queue.ts";

const UA = "CineMexaBot/0.1 (https://github.com/emilianohdzn/CineMexa)";
const RSS = readFileSync(join(import.meta.dirname, "fixtures", "feed-critica.xml"), "utf8");
const NOW = new Date("2026-11-23T12:00:00Z");

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
  <entry><title type="html">Noticia &amp; algo</title><link rel="alternate" href="https://otro.example/n/1"/>
    <id>tag:otro,1</id><published>2026-11-21T08:00:00Z</published><author><name>Equipo</name></author><category term="FICM"/></entry>
  <entry><title>Sin enlace</title><published>2026-11-21T08:00:00Z</published></entry>
</feed>`;

test("lee RSS y Atom sin guardar el contenido del artículo", () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 4);
  assert.deepEqual(items[0], {
    url: "https://medio.example/critica/sombra-mezquite", title: "Crítica de «La sombra del mezquite»: el desierto como herida",
    author: "Ana Crítica", publishedAt: "2026-11-22T15:00:00.000Z", categories: ["Cine mexicano"],
  });
  assert.ok(!JSON.stringify(items).includes("NO debe guardarse"));
  const atom = parseFeed(ATOM);
  assert.deepEqual(atom, [{ url: "https://otro.example/n/1", title: "Noticia & algo", author: "Equipo", publishedAt: "2026-11-21T08:00:00.000Z", categories: ["FICM"] }]);
});

test("un título parecido no basta para vincular", () => {
  const films = [
    filmKey({ id: "a", title: "La sombra del mezquite", year: 2024, directors: ["Laura Ríos"] }),
    filmKey({ id: "b", title: "Mácula", year: 2025, directors: ["Pedro Gómez"] }),
    filmKey({ id: "c", title: "Familia", year: 2024 }),
    filmKey({ id: "d", title: "Familia de medianoche", year: 2025 }),
  ];
  const [quoted, plain] = parseFeed(RSS);
  const q = matchArticle(quoted, films);
  assert.equal(q.kind, "linked");
  assert.equal(q.kind === "linked" && q.film.id, "a");
  assert.equal(matchArticle(plain, films).kind, "ambiguous", "Mácula sin comillas ni director: a revisión");
  const withDirector = { ...plain, title: "Mácula, de Pedro Gómez, un retrato en blanco y negro" };
  assert.equal(matchArticle(withDirector, films).kind, "linked");
  const nested = { ...plain, title: "«Familia de medianoche» llega a cines" };
  const n = matchArticle(nested, films);
  assert.equal(n.kind === "linked" && n.film.id, "d", "cuenta el título más largo");
  assert.equal(matchArticle({ ...plain, title: "Las películas más esperadas" }, films).kind, "none");
  assert.equal(classifyArticle(quoted, "mixed"), "review");
  assert.equal(classifyArticle({ ...plain, title: "Abre la convocatoria" }, "mixed"), "news");
  assert.equal(newsKind("«Familia» gana el premio del público"), "award");
});

async function setup(db: TestDb, scope: "mx" | "general") {
  const { rows: [a] } = await db.query<{ id: string }>("insert into films (slug, title, year, published) values ('sombra', 'La sombra del mezquite', 2024, true) returning id::text");
  const { rows: [b] } = await db.query<{ id: string }>("insert into films (slug, title, year, published) values ('macula', 'Mácula', 2025, true) returning id::text");
  await db.query(`insert into sources (id, name, kind, homepage_url, enabled, feed_url, feed_kind, feed_scope)
    values ('feed-prueba', 'Medio de prueba', 'feed', 'https://medio.example', true, 'https://medio.example/feed', 'mixed', $1)`, [scope]);
  return { sombra: a.id, macula: b.id };
}

const fetchImpl = (async () => new Response(RSS, { headers: { "content-type": "application/rss+xml" } })) as typeof fetch;

test("publica la crítica con evidencia, manda la ambigua a revisión y no duplica", async () => {
  const db = await freshDb();
  const ids = await setup(db, "general");
  const r = await runFeeds(db, { userAgent: UA, now: NOW, http: { fetchImpl, retries: 0 } });
  assert.equal(r.status, "succeeded", r.errors.join());
  assert.deepEqual(r.counts, { feeds: 1, items: 4, unchanged: 0, reviews: 1, news: 0, pending: 1, discarded: 1, old: 1 });

  const { rows: reviews } = await db.query<{ film_id: string; outlet: string; critic_name: string; url: string; excerpt: string | null; score: string | null }>(
    "select film_id::text, outlet, critic_name, url, excerpt, score from reviews");
  assert.deepEqual(reviews, [{ film_id: ids.sombra, outlet: "Medio de prueba", critic_name: "Ana Crítica", url: "https://medio.example/critica/sombra-mezquite", excerpt: null, score: null }]);

  const pending = await listPending(db);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].candidate_id, ids.macula);
  assert.match(pending[0].subject ?? "", /Mácula/);

  const again = await runFeeds(db, { userAgent: UA, now: NOW, http: { fetchImpl, retries: 0 } });
  assert.equal(again.counts.unchanged, 3);
  assert.equal(again.counts.reviews, 0);

  // Decisión editorial: aceptar crea la crítica vinculada, con verificación editorial.
  assert.match(await decide(db, pending[0].id, "aceptar"), /crítica vinculada/);
  const { rows: [m] } = await db.query<{ verification: string }>("select verification::text from reviews where film_id = $1", [ids.macula]);
  assert.equal(m.verification, "editorial");
  await assert.rejects(decide(db, pending[0].id, "aceptar"), /ya está en estado accepted/);
});

test("en un medio de cine mexicano la noticia se conserva aunque no tenga película", async () => {
  const db = await freshDb();
  await setup(db, "mx");
  const r = await runFeeds(db, { userAgent: UA, now: NOW, http: { fetchImpl, retries: 0 } });
  assert.equal(r.counts.news, 1);
  const { rows } = await db.query<{ title: string; film_id: string | null; kind: string }>("select title, film_id::text, kind::text from news_items");
  assert.deepEqual(rows, [{ title: "Las películas más esperadas del año", film_id: null, kind: "publication" }]);
});

test("aceptar un id de TMDB pendiente lo vincula y rechaza a los demás candidatos", async () => {
  const db = await freshDb();
  const ids = await setup(db, "general");
  for (const [cand, score] of [["111", 0.4], ["222", 0.4]] as const) {
    await db.query(`insert into match_reviews (entity_type, entity_id, provider, candidate_id, candidate_label, method, status, score)
      values ('film', $1, 'tmdb', $2, 'Mácula', 'title_year_director', 'pending', $3)`, [ids.macula, cand, score]);
  }
  const pending = await listPending(db);
  const pick = pending.find((p) => p.candidate_id === "222")!;
  await decide(db, pick.id, "aceptar");
  const { rows: ext } = await db.query<{ external_id: string }>("select external_id from film_external_ids where film_id = $1 and provider = 'tmdb'", [ids.macula]);
  assert.deepEqual(ext, [{ external_id: "222" }]);
  assert.equal((await listPending(db)).length, 0);
});

test("sin feeds activados no hace nada", async () => {
  const db = await freshDb();
  const r = await runFeeds(db, { userAgent: UA, now: NOW });
  assert.deepEqual(r.counts, { feeds: 0, items: 0, unchanged: 0, reviews: 0, news: 0, pending: 0, discarded: 0, old: 0 });
});
