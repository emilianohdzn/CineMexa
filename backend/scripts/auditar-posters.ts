// Auditoría de pósters en la base real (sólo lectura, sin imprimir secretos).
// Uso: npm run auditar:posters [-- --json salida.json]
import { writeFileSync } from "node:fs";
import { openPostgres } from "../collectors/lib/db.ts";
import { checkUrls, posterCoverage, primaryPosterUrls } from "../audit/posters.ts";
import { loadLocalEnv, redactor } from "./env.ts";

const env = loadLocalEnv();
const redact = redactor(env);
const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const { db, end } = await openPostgres(env.DATABASE_URL, { max: 1 });
try {
  const cobertura = await posterCoverage(db);
  const checked = await checkUrls(await primaryPosterUrls(db));
  const failing = checked.filter((c) => c.status !== 200);
  const pct = (n: number) => (cobertura.publicadas ? Math.round((n / cobertura.publicadas) * 1000) / 10 : 0);
  const report = {
    medido_en: new Date().toISOString(),
    cobertura: { ...cobertura, porcentaje_con_poster: pct(cobertura.con_poster_primario) },
    urls: {
      revisadas: checked.length, responden_200: checked.length - failing.length, fallan: failing.length,
      hosts: [...new Set(checked.map((c) => new URL(c.url).host))],
      tamanos: [...new Set(checked.map((c) => c.url.match(/\/t\/p\/([^/]+)\//)?.[1] ?? "otro"))],
      fallas: failing.slice(0, 30),
    },
  };
  const text = redact(JSON.stringify(report, null, 2));
  console.log(text);
  if (jsonOut) writeFileSync(jsonOut, text + "\n");
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : error));
  process.exitCode = 1;
} finally {
  await end();
}
