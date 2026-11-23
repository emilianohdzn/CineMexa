# Bitácora por fase

## Fase 1 · Auditoría y arquitectura (23 nov 2026)

**Entorno**: contenedor Linux x86_64, Node 22, Python 3. Sin Xcode, sin Swift, sin servidor Postgres. Red restringida: GitHub y npm accesibles; Wikidata, TMDB y download.swift.org bloqueados desde este entorno.

**Auditoría**: no existía código previo (ver `ARCHITECTURE.md`). Base nueva.

**Archivos creados**
- `packages/core/src/{types,normalize,dedupe,trendScore,availability,index}.ts` + 4 archivos de test
- `backend/supabase/migrations/20261123000000_init.sql`, `backend/test/migrations.test.ts`, `backend/package.json`
- `docs/*`, `README.md`, `.env.example`, `.gitignore`, `package.json`

**Tests**
- `npm run test:core`: **29/29 pasan**
- `npm run test:db`: **12/12 pasan** (PGlite 0.4.6, Postgres embebido, con roles `anon`/`authenticated`/`service_role` y `auth.uid()` simulados)

## Fase 2 · MVP visual navegable (23 nov 2026)

**Archivos creados**
- `ios/CineMexa.xcodeproj` (formato Xcode 16, carpetas sincronizadas, targets app + tests)
- `ios/CineMexa/**`: 26 archivos Swift (App, Core, DesignSystem, Features), `Assets.xcassets` con ícono 1024, fuentes OFL, `DemoData.json`
- `ios/CineMexaTests/CineMexaTests.swift` (Swift Testing)
- `demo/build-demo.ts`, `demo/demo-data.test.ts`
- `docs/brand/app-icon.svg`, `wordmark.png`

**Funcionalidades implementadas (código)**
- 5 pestañas: Radar, Películas, Mapa, Trends, Festivales. Búsqueda global, Favoritos, Fuentes y créditos, Configuración.
- Radar: encabezado con fecha y estado de sincronización honesto, hero 2:3, en cartelera con distinción función confirmada / estreno identificado / cineteca, Top 5 con señal, vista previa del mapa, próximos festivales, crítica reciente, noticias.
- Películas: 9 filtros + año, género, dirección, tipo de producción, streaming; grid 2 columnas; acceso destacado a Crítica.
- Ficha: encabezado, acciones (guardar, seguir, tráiler, compartir), sinopsis, dónde verla por ciudad elegida, crítica con estado vacío, recorrido con fuentes, ficha técnica, procedencia.
- Mapa: MapKit interactivo, agrupación, hoja inferior por festival, filtros de periodo, tipo de participación, largos/cortos y búsqueda; lista alternativa accesible.
- Trends: 24 h / 7 d / 30 d, ranking con cambio de posición y explicación, gráfica Swift Charts, metodología.
- Festivales: agenda (en curso, próximos, recientes), calendario mensual navegable, convocatorias con deadline, recordatorio local y “Agregar al calendario” nativo.
- Modo demo / en vivo con caché del último dato válido y errores visibles.

**Verificación**
- `npm run test:demo`: **6/6 pasan**.
- `project.pbxproj` parseado con `@bacons/xcode`: 26 objetos, sin referencias rotas.
- tree-sitter-swift sobre los 27 archivos Swift: sin errores de sintaxis, excepto en las macros `#Predicate`, `#expect` y `#require`, que esa gramática no reconoce.
- **No compilado ni ejecutado**: falta Xcode. La app **no se ha abierto en el simulador**.

**Dependencias pendientes**
- Un Mac con Xcode 16+ para compilar, corregir lo que marque el compilador y ejecutar los tests de Swift.
- Repositorio de GitHub para versionar.
- Proyecto Supabase y claves (TMDB, YouTube) para la Fase 3.

**Próximo bloque**: compilar en Xcode y corregir; luego Fase 3 empezando por Wikidata y la Edge Function `catalog`.

## Fase 3 · Backend y sincronización (23 nov 2026)

- Colectores: Wikidata (SPARQL, P495 = Q96), TMDB (sinopsis, estreno MX tipo 3 o 2, póster con atribución, tráiler, créditos sin pisar curaduría) y YouTube (visualizaciones con presupuesto de cuota). Job de tendencias (`trend_snapshots`).
- Edge Function `catalog`: snapshot v1 leído como `anon` bajo RLS, ETag/304, caché, 503 honesto. `public_source_status()`.
- Verificación: 33 pruebas de backend sobre PGlite con respuestas sintéticas; la app decodifica la respuesta (prueba en Swift).

## Fase 4 · Integración con datos reales (23 nov 2026)

- `scripts/configurar.sh`: entradas ocultas, validación de formato, `git check-ignore` antes de escribir `backend/.env.local` (600) y `LiveConfig.json` (solo URL y Publishable Key).
- `backend/scripts/`: verificación de conexiones, ejecutor con secretos redactados, estado de la ingesta, empaquetado de `catalog`. Siembra de 14 festivales (ciudad, sin fechas).
- Verificado en la Mac: 5/5 conexiones reales; migraciones aplicadas tras corrida en seco; `catalog` publicada y respondiendo; Wikidata 217 películas (corrida parcial), TMDB 40, 28 tráilers medidos; app en vivo en el simulador y en el iPhone 17.
- Correcciones de la primera corrida real: jsonb doblemente serializado (`openPostgres`), backdrop desbordado, fuente habilitada tras corrida exitosa.

## Fase 5 · Calidad (en curso)

- CI en GitHub Actions (core, demo, backend). Workflow de colectores solo manual hasta que se autorice el horario.
- Wikidata en paralelo (4 conexiones, reintento ante choque de unicidad).
- Fechas relativas: "hace un momento" ante desfase de reloj y sin "dentro de 0 segundos" (17/17 pruebas de Swift en la Mac).
- Pendiente: accesibilidad XXXL y VoiceOver, UI tests, `CineMexaKit`, horario de colectores.
