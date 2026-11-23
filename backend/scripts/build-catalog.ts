// Empaqueta la lógica del catálogo y de Mexa (backend/catalog, backend/mexa + packages/core) en un módulo dentro de
// la carpeta de cada función, para que `supabase functions deploy` no dependa de archivos fuera de ella.
import { build } from "esbuild";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
for (const [name, entry] of [["catalog", join(root, "catalog", "handler.ts")], ["mexa", join(root, "mexa", "handler.ts")]] as const) {
  await build({
    entryPoints: [entry],
    outfile: join(root, "supabase", "functions", name, "_bundle", "handler.js"),
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    legalComments: "none",
    // openPostgres (db.ts) importa postgres.js de forma diferida; la función usa npm:postgres por su cuenta.
    external: ["postgres"],
    banner: { js: "// Generado por backend/scripts/build-catalog.ts. No editar." },
  });
  console.log(`${name} empaquetado en supabase/functions/${name}/_bundle/handler.js`);
}
