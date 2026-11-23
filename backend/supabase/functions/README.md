# Edge Functions

## `catalog` · GET `/functions/v1/catalog?v=1`
Devuelve el `CatalogSnapshot` v1 (ver `docs/ARCHITECTURE.md`) que decodifica la app.

- Lógica en `backend/catalog/` (sin dependencias de Deno, probada en Node con PGlite):
  `queries.ts` lee como rol `anon` (RLS decide qué es publicable), `snapshot.ts` arma el JSON,
  `handler.ts` resuelve método, versión, ETag/304, `Cache-Control` y 503 ante fallos.
- `index.ts` sólo conecta Deno + postgres.js con `SUPABASE_DB_URL` (inyectada por Supabase). No usa service_role.
- Estado de fuentes: función SQL `public_source_status()` (migración `20261123010000`).

```sh
supabase functions deploy catalog --no-verify-jwt   # lectura pública; la app manda la anon key de todas formas
curl -i "https://TU-PROYECTO.supabase.co/functions/v1/catalog?v=1" -H "apikey: $SUPABASE_ANON_KEY"
```

Pendiente de verificar contra un proyecto real de Supabase (el despliegue y el import de
`../../../catalog/*.ts` desde la función no se han probado todavía).
