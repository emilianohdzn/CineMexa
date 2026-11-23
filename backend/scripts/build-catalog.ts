// Empaqueta la lógica del catálogo (backend/catalog + packages/core) en un solo módulo dentro de
// la carpeta de la función, para que `supabase functions deploy` no dependa de archivos fuera de ella.
import { build } from "esbuild";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
await build({
  entryPoints: [join(root, "catalog", "handler.ts")],
  outfile: join(root, "supabase", "functions", "catalog", "_bundle", "handler.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  legalComments: "none",
  // openPostgres (db.ts) importa postgres.js de forma diferida; la función usa npm:postgres por su cuenta.
  external: ["postgres"],
  banner: { js: "// Generado por backend/scripts/build-catalog.ts. No editar." },
});
console.log("catalog empaquetado en supabase/functions/catalog/_bundle/handler.js");
