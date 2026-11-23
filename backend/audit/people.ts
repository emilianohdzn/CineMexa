// Personas duplicadas por el orden de enriquecimiento (antes de la corrección de resolvePerson): en una misma película,
// dos registros con el mismo nombre normalizado y el mismo papel, uno de Wikidata sin tmdb_id y otro creado por TMDB
// sin wikidata_id. Se fusionan en el de Wikidata. Nunca se fusiona por nombre entre películas distintas.
import { inTransaction, type Db } from "../collectors/lib/db.ts";

export interface DuplicatePair { keep: string; drop: string; tmdb_id: number; name: string; film_id: string }

export async function findDuplicatePeople(db: Db): Promise<DuplicatePair[]> {
  const { rows } = await db.query<DuplicatePair>(`
    select distinct on (w.id, t.id) w.id::text as keep, t.id::text as drop, t.tmdb_id, w.name, cw.film_id::text
    from film_credits cw
    join people w on w.id = cw.person_id and w.wikidata_id is not null and w.tmdb_id is null
    join film_credits ct on ct.film_id = cw.film_id and ct.role = cw.role and ct.person_id <> cw.person_id
    join people t on t.id = ct.person_id and t.wikidata_id is null and t.tmdb_id is not null and t.name_key = w.name_key
    order by w.id, t.id`);
  return rows;
}

export async function mergeDuplicatePeople(db: Db, pairs: DuplicatePair[]): Promise<number> {
  let merged = 0;
  const done = new Set<string>();
  for (const p of pairs) {
    if (done.has(p.drop) || done.has(p.keep)) continue; // un registro de TMDB se fusiona una sola vez
    await inTransaction(db, async () => {
      await db.query(`insert into film_credits (film_id, person_id, role, character, ord, source_id)
        select film_id, $2, role, character, ord, source_id from film_credits where person_id = $1 on conflict do nothing`, [p.drop, p.keep]);
      await db.query("delete from film_credits where person_id = $1", [p.drop]);
      await db.query("delete from people where id = $1", [p.drop]);
      await db.query("update people set tmdb_id = $2 where id = $1", [p.keep, p.tmdb_id]);
    });
    done.add(p.drop); done.add(p.keep);
    merged++;
  }
  return merged;
}
