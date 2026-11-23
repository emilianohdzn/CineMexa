# Collectors

Un servicio de ingesta por proveedor. Corren en el servidor (tarea programada) con la conexión
del rol de servicio; nunca dentro de la app.

```
Fuente externa → collector → normalización (packages/core) → resolución por id externo
→ upsert en Postgres (source_records + tablas de hechos) → ingestion_runs
```

## Compartido (`lib/`)
- `http.ts`: `fetchJson` con User-Agent, timeout y reintentos ante 429/5xx (respeta `Retry-After`).
- `runs.ts`: `ingestion_runs` (inicio/fin, conteos, error) y `source_records` con hash de contenido.
- `db.ts`: interfaz `Db` mínima (PGlite en pruebas, postgres.js en producción) y transacciones.

## Wikidata (`wikidata/`) · listo
Descubre obras con México (Q96) como país de origen (P495), publicadas desde un año dado.

- `sparql.ts`: consulta paginada (una fila por película con `GROUP_CONCAT`).
- `parse.ts`: respuesta → candidatos. Corto si es clase "cortometraje" o dura ≤ 40 min. Coproducción si hay
  más de un país; con sólo México la participación queda `unknown` (no se infiere). Géneros sólo si están en
  la tabla `GENRE_LABELS`; títulos que son Q-ids se descartan.
- `upsert.ts`: resuelve por Wikidata → IMDb → TMDB. Un título igual sin id crea una película aparte con
  `needs_review` y sin publicar. No sobrescribe películas `verified`/`editorial` (sólo completa huecos).
  Un registro sin cambios no toca las tablas.
- `run.ts`: corrida completa. Si la fuente falla, la corrida queda `failed` y no se borra nada.

```sh
# Vista previa sin base de datos
WIKIDATA_USER_AGENT="CineMexaBot/0.1 (https://github.com/emilianohdzn/CineMexa; tu-correo)" \
  npm run collect:wikidata -- --from-year 2020 --dry-run
# Escritura (conexión directa a Postgres de Supabase, rol de servicio)
DATABASE_URL=postgres://... WIKIDATA_USER_AGENT="..." npm run collect:wikidata -- --from-year 2020
```

Pruebas: `test/wikidata.test.ts` con una respuesta SPARQL sintética (Q-ids ficticios) sobre PGlite.
Aún no se ha corrido contra el endpoint real ni contra un Supabase real: la red de la nube de desarrollo
bloquea Wikidata.

## TMDB (`tmdb/`) · listo (falta token)
Enriquece películas que ya tienen id de TMDB (normalmente vía Wikidata, P4947). No busca por título.

- `parse.ts`: sinopsis es-MX, duración, IMDb, póster/fondo, tráiler de YouTube (oficial en español primero),
  reparto (12) y equipo clave. Estreno en México sólo de `release_dates` de MX tipo 3 (salas) o 2 (limitado).
- `upsert.ts`: no pisa películas curadas (sólo huecos); el póster de TMDB lleva su atribución y no
  reemplaza un póster primario oficial/editorial; las personas se vinculan por `tmdb_id` o, dentro de la
  misma película, por nombre normalizado (no se fusionan homónimos de otras películas).
- No se usa `popularity` de TMDB como señal de tendencia.

```sh
TMDB_API_READ_TOKEN=... DATABASE_URL=... npm run collect:tmdb -- --limit 200
```

## YouTube (`youtube/`) · listo (falta clave)
Visualizaciones de los tráilers registrados en `films.trailer_url` (videos.list, 1 unidad de cuota por
cada 50 videos; `maxUnits` limita la corrida). La primera consulta sólo fija la línea base; después se
guarda en `trend_signals` la diferencia de visualizaciones (`views_delta`) por intervalo. Estadísticas
ocultas no generan dato. La clave nunca se escribe en errores ni en `ingestion_runs`.

## Job de tendencias (`../jobs/trends.ts`)
Lee `trend_signals`, reparte intervalos en horas, aplica `trend_score` de `packages/core` y guarda un
`trend_snapshot` por ventana (24 h, 7 días, 30 días). Sin evidencia el ranking queda vacío.

```sh
YOUTUBE_API_KEY=... DATABASE_URL=... npm run collect:youtube
DATABASE_URL=... npm run job:trends
```

## Frecuencias sugeridas (ver `.env.example`)
Wikidata diario, TMDB diario, YouTube cada 4–6 h seguido del job de tendencias. Se pueden programar con
Supabase Cron + una función que dispare el collector, o con un runner externo (GitHub Actions programado).

## Pendiente
Festivales: adaptadores de feeds/ICS oficiales y captura editorial; noticias.
