// Fusiona personas duplicadas por el orden de enriquecimiento de TMDB. Por defecto sólo muestra (--aplicar para escribir).
// Uso: npm run reparar:personas [-- --aplicar]
import { openPostgres } from "../collectors/lib/db.ts";
import { findDuplicatePeople, mergeDuplicatePeople } from "../audit/people.ts";
import { loadLocalEnv, redactor } from "./env.ts";

const env = loadLocalEnv();
const redact = redactor(env);
const apply = process.argv.includes("--aplicar");
const { db, end } = await openPostgres(env.DATABASE_URL, { max: 1 });
try {
  const pairs = await findDuplicatePeople(db);
  console.log(JSON.stringify({ duplicados: pairs.length, ejemplos: pairs.slice(0, 10).map((p) => p.name) }, null, 2));
  if (apply) console.log(JSON.stringify({ fusionados: await mergeDuplicatePeople(db, pairs) }));
  else console.log("Modo de prueba: nada se escribió. Usa --aplicar para fusionar.");
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : error));
  process.exitCode = 1;
} finally {
  await end();
}
