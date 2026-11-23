# Arquitectura

## Auditoría inicial (Fase 1)

El directorio de trabajo estaba vacío y la carpeta compartida del proyecto no contenía archivos. **No había código previo disponible**: no se encontraron `cinemexa-prototipo.html`, `cinemexa-launch-candidate.html`, `packages/core`, `packages/db`, `packages/collectors` ni documentos de arquitectura. Se construyó una base nueva que conserva los principios pedidos del proyecto anterior:

- Wikidata como fuente canónica de identidad (`film_external_ids.is_canonical`, precedencia en `dedupe.ts`); TMDB como proveedor complementario aislado.
- Deduplicación, verificación, procedencia y confianza por dato.
- Cortometrajes al mismo nivel que largometrajes (`film_kind`, filtros, mapa, tendencias).
- n8n no participa en ninguna ruta crítica.

Si aparece el código anterior, se puede comparar contra `packages/core` y la migración inicial; ambos están aislados para facilitar esa fusión.

## Flujo de datos

```
Fuentes externas (Wikidata, TMDB, YouTube, festivales, medios)
   │  Supabase Cron (servidor; frecuencias configurables)
   ▼
Collectors por proveedor (Edge Functions, Fase 3)
   ▼
Normalización ── packages/core/normalize.ts
   ▼
Deduplicación ── packages/core/dedupe.ts (Wikidata > TMDB > IMDb > título+año+dirección)
   ▼
Verificación ── estados verified / editorial / automatic / unverified; needs_review
   ▼
Postgres (source_records, films, festival_events, …, ingestion_runs)  ← RLS
   ▼
API interna: Edge Function `catalog` (lectura, JSON tipado, caché) ── contrato v1
   ▼
App iOS: CatalogRepository → Catalog (índices) → vistas SwiftUI
```

Las vistas nunca hablan con proveedores. La app sólo conoce la API de Cine Mexa y una clave pública.

## App iOS

- **Patrón**: MVVM ligero con estado observable. `AppModel` (`@Observable`, `@MainActor`) maneja modo, carga, caché y errores. `Catalog` es un modelo de consulta inmutable con índices; las vistas son funciones de él.
- **Por qué no un paquete SPM separado todavía**: el proyecto se escribió sin Xcode; un solo target con carpetas sincronizadas (formato Xcode 16) minimiza el riesgo de configuración. `Core/` no importa SwiftUI salvo donde es inevitable y puede extraerse a un paquete `CineMexaKit` en la Fase 5.
- **Navegación**: `TabView` con 5 pestañas (API `Tab` de iOS 18), un `NavigationStack` por pestaña y rutas tipadas (`Route`). Búsqueda, Favoritos, Fuentes y Configuración desde la barra superior.
- **Persistencia**: SwiftData para favoritos y seguimientos (`FavoriteItem`), `URLCache` (50 MB / 300 MB) para imágenes y respuestas, y `SnapshotCache` para el último catálogo en vivo válido.
- **Mapa**: MapKit SwiftUI con agrupación por cuadrícula según el área visible; coordenadas persistidas en el backend (`venues`), sin geocodificación en el cliente.
- **Accesibilidad**: Dynamic Type (`Font.custom(_:size:relativeTo:)`), etiquetas de VoiceOver, objetivos táctiles ≥ 44 pt, estados con texto + símbolo, Reduce Motion respetado en transiciones, carruseles y marcadores.

## Contrato de datos v1

Una sola respuesta `CatalogSnapshot` (JSON, `snake_case`, fechas ISO 8601 UTC; fechas de calendario `AAAA-MM-DD`):

| Clave | Contenido |
|---|---|
| `meta` | `mode` (`demo`/`live`), `api_version`, `generated_at`, `notice`, `sources[]` con estado y última sincronización |
| `films[]` | identidad, títulos, año, `kind`, países ISO, `mx_participation`, géneros, créditos, `poster`/`backdrop` (con fuente y atribución, o `null`), `status`, `mx_release_date`, `provenance` |
| `screenings[]` | funciones **confirmadas**: sede con coordenadas, tipo (sala, cineteca, cineclub), `starts_at`, enlace de compra |
| `streaming[]` | ofertas en México cuando el proveedor permite usar el dato |
| `reviews[]` | medio, crítico, título, URL original, fecha; `score` y `excerpt` sólo si hay licencia; `is_automated_summary` |
| `timeline[]` | recorrido: selección, función de festival, estreno, premio, salas, streaming; cada hito con fuente |
| `festivals[]` | identidad, sede con coordenadas y precisión, `editions[]` con fechas, zona horaria, programa, convocatoria y deadline |
| `festival_events[]` | selección / función / premio / estreno por película y edición; `occurs_at = null` si no hay fecha confirmada |
| `news[]` | feed cronológico con enlace y entidad relacionada |
| `trends[]` | ranking por ventana (`24h`, `7d`, `30d`), etiqueta honesta, fuentes usadas, señales por película e histórico |

`provenance` = `{ source, source_url, retrieved_at, published_at, verification, confidence }`.

Implementaciones del contrato: `ios/CineMexa/Core/Models/Models.swift` (Codable) y `packages/core/src/types.ts`. `demo/demo-data.test.ts` comprueba que los datos demo lo cumplen.

## Base de datos

`backend/supabase/migrations/20261123000000_init.sql` crea las 19 entidades pedidas más `film_titles`, `streaming_offers` y `staff`, con:

- claves foráneas, índices (incluye trigram para búsqueda), unicidad de ids externos y de eventos;
- restricciones de dominio: países ISO, coordenadas válidas, fechas coherentes, premio con nombre, puntuación/extracto sólo con licencia;
- RLS en todas las tablas: lectura pública sólo de lo publicado y no “sin verificar”; escritura sólo `service_role` o `staff`; favoritos y alertas por usuario;
- semilla de `sources` con atribuciones y frecuencias objetivo.

## Reglas de veracidad aplicadas en código

- Estreno identificado ≠ función confirmada (`classifyFilmStatus`, `Catalog.availability`).
- Una selección sin fecha nunca aparece como actividad actual en el mapa (`inMapPeriod`, `DateLogic.isInPeriod`).
- Las ediciones se evalúan en la zona horaria del festival; nunca se suponen fechas anuales.
- Trends no rellena huecos ni usa la popularidad general de TMDB.
- Sin póster autorizado se muestra un placeholder que lo dice.
