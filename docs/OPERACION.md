# Operación de la ingesta

La ingesta corre en GitHub Actions (`.github/workflows/collectors.yml`), sin servidor propio y sin costo en un
repositorio público. La Mac ya no es necesaria para mantener los datos al día.

## Trabajos

| Trabajo | Qué hace | Frecuencia propuesta (UTC → Cancún) | Límite |
| --- | --- | --- | --- |
| `wikidata` | Descubre películas mexicanas desde `CATALOG_FROM_YEAR` (2024) y después corre `festivales` | diario 09:10 → 04:10 | 40 min |
| `festivales` | Vincula festivales con Wikidata por dominio oficial, agrega ediciones con fecha y premios/nominaciones con referencia (ver `docs/FESTIVALES.md`) | con `wikidata`, o a mano | 15 min |
| `noticias` | Crítica y noticias de los feeds activados (ver `docs/CRITICA-Y-NOTICIAS.md`); sin feeds activados no hace nada | diario 13:10 → 08:10 | 10 min |
| `tmdb` | Vincula películas sin id (sólo con evidencia fuerte) y enriquece: primero nunca consultadas, luego cambiadas en TMDB en 24 h, luego las más antiguas | diario 09:40 → 04:40 | 45 min, 300 películas, 60 búsquedas |
| `youtube-y-tendencias` | Mide vistas de tráilers y, si la medición funciona, recalcula rankings 24 h / 7 d / 30 d | cada 6 h, minuto 20 → 19:20, 01:20, 07:20, 13:20 | 15 min, 20 unidades por corrida, 200 por día |

Los cron de GitHub se interpretan siempre en UTC. Cancún usa UTC−5 todo el año.

## Protecciones

- **Sin duplicados**: grupo de concurrencia por trabajo en Actions y candado de Postgres (`pg_try_advisory_lock`) en
  `jobs/ejecutar.ts`, que también excluye una corrida lanzada a mano desde la Mac.
- **Corridas abandonadas**: una corrida en `running` de hace más de 3 h se cierra como `failed`.
- **Reintentos**: cada petición HTTP reintenta 429/5xx/red con espera exponencial y respeta `Retry-After`.
- **Cuota**: YouTube cuesta 1 unidad por cada 50 videos; el presupuesto diario (200) está muy por debajo de la cuota
  gratuita (10 000). TMDB no tiene cuota diaria; se espacian las peticiones.
- **Errores**: cada corrida queda en `ingestion_runs` (estado, conteos, primeros errores) y en el resumen del job.
- **Aviso**: si dos corridas programadas seguidas fallan, se abre o comenta el issue "Colectores: fallas repetidas".
- **Estado visible**: la pantalla Fuentes de la app muestra la última sincronización de cada fuente
  (`public_source_status()`).

## Ejecutar a mano

- GitHub: Actions → Collectors → Run workflow (requiere que el workflow esté en `main`).
- Mac: `cd backend && npm run job -- tmdb` (lee `backend/.env.local`).

## Activar los horarios

Requiere autorización explícita. Se quitan los comentarios de `schedule` en `collectors.yml` y se fusiona en `main`.
