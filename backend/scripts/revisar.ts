// Cola de revisión de coincidencias ambiguas (TMDB, crítica, noticias).
// npm run revisar                         → lista lo pendiente
// npm run revisar -- --aceptar <id>       → aplica esa coincidencia (y rechaza los otros candidatos del mismo registro)
// npm run revisar -- --rechazar <id>      → la descarta
import { openPostgres } from "../collectors/lib/db.ts";
import { decide, listPending } from "../collectors/lib/review-queue.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL (conexión del rol de servicio).");
const args = process.argv.slice(2);
const { db, end } = await openPostgres(url);
try {
  const action = args.includes("--aceptar") ? "aceptar" : args.includes("--rechazar") ? "rechazar" : null;
  if (action) {
    const id = args[args.indexOf(`--${action}`) + 1];
    console.log(await decide(db, id, action));
  } else {
    const rows = await listPending(db);
    if (rows.length === 0) console.log("No hay coincidencias pendientes.");
    for (const r of rows) {
      console.log(`${r.id}  [${r.entity_type}/${r.provider}]  ${r.subject ?? r.entity_id}  →  ${r.candidate_label ?? r.candidate_id}  (${r.score ?? "–"})`);
      const motivo = (r.evidence as { motivo?: string }).motivo;
      if (motivo) console.log(`      ${motivo}`);
    }
  }
} finally {
  await end();
}
