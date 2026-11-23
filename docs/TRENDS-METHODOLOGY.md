# Metodología de Trends · `trend_score/1.0`

Implementación: `packages/core/src/trendScore.ts` (tests en `packages/core/test/trendScore.test.ts`). El cálculo corre en el servidor; la app sólo presenta el resultado y sus fuentes.

## Señales

| Fuente | Tipo | Estado | Métrica |
|---|---|---|---|
| YouTube Data API | digital | adaptador pendiente de clave (Fase 3) | visualizaciones nuevas por intervalo en videos oficiales/relevantes |
| Google Trends API | digital | sólo con acceso aprobado | índice de interés |
| Menciones en medios | separada | Fase 3 (feeds autorizados) | menciones verificadas por intervalo |
| TikTok / Instagram / X | — | **no integradas**: no se simulan cifras | — |

La popularidad general de TMDB **no** se usa como evidencia de tendencia social.

## Cálculo

Para la ventana `W` (24 h, 7 d o 30 d), por película `f` y fuente `s`:

```
current   = Σ valores en (now − W, now]
baseline  = promedio de las K = 3 ventanas anteriores
growth    = ln((current + α_s) / (baseline + α_s))     α amortigua conteos pequeños
activity  = ln(1 + current)
component = 0.7 · z(growth) + 0.3 · z(activity)       z = estandarización robusta (mediana, MAD·1.4826)
score     = Σ w_s · component_s / Σ w_s                sólo fuentes activas
índice    = 100 / (1 + e^(−score))                     50 = interés típico del grupo
```

Pesos y umbrales por defecto (`DEFAULT_SOURCES`): YouTube `w=0.6, α=200, mínimo 500`; Google Trends `w=0.6, α=5, mínimo 5`; Medios `w=0.4, α=2, mínimo 2`.

## Reglas

1. **Crecimiento sobre tamaño**: la estandarización entre candidatas evita que una película con audiencia histórica enorme gane sólo por volumen.
2. **Evidencia suficiente**: una película entra sólo si alcanza el mínimo en al menos una fuente **digital**. Los medios suman, pero no bastan solos.
3. **Sin relleno**: si hay menos de cinco películas elegibles, se muestran sólo esas.
4. **Etiqueta honesta**: con sólo YouTube y medios, el ranking se llama **“Tendencias digitales”** y la app lista las fuentes.
5. **Cambio de posición**: se compara con el ranking de la ventana inmediatamente anterior; cada cálculo se guarda en `trend_snapshots`.
6. **Explicación**: cada posición cita la señal que más aportó (p. ej. “YouTube: visualizaciones +200 % frente al periodo anterior”).
7. **Determinista**: mismo input, mismo output, sin importar el orden de las observaciones.
8. **Extensible**: una fuente nueva es una entrada en `SourceConfig` y un collector que escriba `trend_signals`; no requiere cambiar la app.

## Datos de demostración

Las señales demo son series sintéticas deterministas (`demo/build-demo.ts`) procesadas por el mismo algoritmo. Están marcadas como demo y no representan audiencias reales.

## Cobertura y límites actuales (23 nov 2026)

- **Única fuente activa: YouTube.** El ranking mide el crecimiento de visualizaciones de los tráilers oficiales
  registrados (TMDB → YouTube), no toda la conversación digital sobre el cine mexicano. Google Trends no tiene un
  acceso oficial aprobado y sigue desactivado; no se usa la "popularity" de TMDB.
- **Mediciones**: cada 6 h (cuando se activen los horarios). La primera medición de un video sólo fija la línea base;
  los deltas empiezan en la segunda. Un video con estadísticas ocultas no genera señal.
- **Evidencia mínima**: 500 visualizaciones nuevas en el periodo. Con pocas mediciones el ranking puede quedar vacío
  y la app lo dice así, sin rellenar.
- **Ventanas**: 24 h compara contra las 3 ventanas de 24 h anteriores; 7 d y 30 d igual. El 7 d necesita al menos
  una semana de historial para tener línea base propia; mientras tanto la línea base es 0 y el crecimiento se mide
  contra el suavizado α.
- **Validación**: `npm run auditar:tendencias` reporta corridas, unidades de cuota, videos medidos, películas con dos o
  más mediciones, suma de deltas, deltas negativos (deben ser 0), tráilers repetidos entre películas y el último
  snapshot de cada ventana.

## Cómo ampliar

Cada fuente nueva entra como `SourceConfig` (peso, evidencia mínima, α) y escribe en `trend_signals` con su propia
métrica. Candidatas con acceso oficial: menciones en medios con licencia (fuente `media`, ya prevista y reportada
aparte), Google Trends si se aprueba su API.
