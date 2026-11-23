// Validación de tendencias en la base real (sólo lectura). Uso: npm run auditar:tendencias
import { openPostgres } from "../collectors/lib/db.ts";
import { trendsHealth } from "../audit/trends.ts";
import { loadLocalEnv, redactor } from "./env.ts";

const env = loadLocalEnv();
const redact = redactor(env);
const { db, end } = await openPostgres(env.DATABASE_URL, { max: 1 });
try {
  console.log(redact(JSON.stringify(await trendsHealth(db), null, 2)));
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : error));
  process.exitCode = 1;
} finally {
  await end();
}
