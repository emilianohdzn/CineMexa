import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./helpers/db.ts";
import { checkUrls, posterCoverage } from "../audit/posters.ts";

async function seed(db: Awaited<ReturnType<typeof freshDb>>) {
  await db.query(`insert into sources (id, name, kind) values ('tmdb', 'TMDB', 'api') on conflict do nothing`);
  const film = async (slug: string, published = true) =>
    (await db.query<{ id: string }>(`insert into films (slug, title, year, kind, published, verification)
      values ($1, $1, 2025, 'feature', $2, 'automatic') returning id::text`, [slug, published])).rows[0].id;
  const a = await film("con-poster"), b = await film("sin-poster-en-tmdb"), c = await film("sin-id"), d = await film("id-sin-enriquecer");
  await film("borrador", false);
  for (const [f, id] of [[a, "1"], [b, "2"], [d, "4"]]) {
    await db.query(`insert into film_external_ids (film_id, provider, external_id, source_id) values ($1, 'tmdb', $2, 'tmdb')`, [f, id]);
  }
  await db.query(`insert into film_external_ids (film_id, provider, external_id) values ($1, 'imdb', 'tt0000003')`, [c]);
  for (const [f, id, poster] of [[a, "1", { url: "https://image.tmdb.org/t/p/w780/a.jpg", path: "/a.jpg" }], [b, "2", null]] as const) {
    await db.query(`insert into source_records (source_id, external_id, entity_type, entity_id, payload, payload_hash)
      values ('tmdb', $2, 'film', $1, $3, 'h')`, [f, id, JSON.stringify({ poster })]);
  }
  await db.query(`insert into film_images (film_id, kind, url, source_id, is_primary) values ($1, 'poster', 'https://image.tmdb.org/t/p/w780/a.jpg', 'tmdb', true)`, [a]);
}

test("la auditoría mide cada etapa de la cobertura de pósters", async () => {
  const db = await freshDb();
  await seed(db);
  const c = await posterCoverage(db);
  assert.equal(c.publicadas, 4);
  assert.equal(c.con_tmdb_id, 3);
  assert.equal(c.sin_tmdb_id, 1);
  assert.equal(c.sin_tmdb_con_imdb, 1);
  assert.equal(c.enriquecidas, 2);
  assert.equal(c.con_id_sin_enriquecer, 1);
  assert.equal(c.con_poster_en_tmdb, 1);
  assert.equal(c.enriquecidas_sin_poster_en_tmdb, 1);
  assert.equal(c.con_poster_primario, 1);
  assert.equal(c.visibles_anon, 4);
  assert.equal(c.visibles_anon_con_poster, 1);
  assert.equal(c.primarios_duplicados, 0);
});

test("checkUrls reintenta errores transitorios y reporta el estado final", async () => {
  const calls = new Map<string, number>();
  const fetchImpl = (async (url: string) => {
    const n = (calls.get(url) ?? 0) + 1;
    calls.set(url, n);
    if (url.endsWith("ok.jpg")) return new Response(null, { status: n === 1 ? 503 : 200 });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const out = await checkUrls([{ title: "a", url: "https://x/ok.jpg" }, { title: "b", url: "https://x/missing.jpg" }], { fetchImpl });
  assert.deepEqual(out.map((o) => o.status).sort(), [200, 404]);
  assert.equal(calls.get("https://x/ok.jpg"), 2);
});
