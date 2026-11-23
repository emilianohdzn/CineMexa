// Ejecuta un comando con las variables de backend/.env.local sin que aparezcan en pantalla.
// Los argumentos pueden usar {NOMBRE} para insertar una variable; la salida pasa por el redactor.
// Uso: node scripts/con-secretos.ts -- npx supabase db push --db-url {DATABASE_URL} --dry-run
import { spawn } from "node:child_process";
import { loadLocalEnv, redactor } from "./env.ts";

const env = loadLocalEnv();
const redact = redactor(env);
const argv = process.argv.slice(process.argv.indexOf("--") + 1);
if (argv.length === 0) throw new Error("Falta el comando después de --");
const args = argv.map((a) => a.replace(/\{([A-Z0-9_]+)\}/g, (_, k) => {
  if (!(k in env)) throw new Error(`Variable desconocida: ${k}`);
  return env[k];
}));
const child = spawn(args[0], args.slice(1), { env: { ...process.env, ...env }, stdio: ["inherit", "pipe", "pipe"] });
child.stdout.on("data", (d) => process.stdout.write(redact(d)));
child.stderr.on("data", (d) => process.stderr.write(redact(d)));
child.on("exit", (code) => { process.exitCode = code ?? 1; });
