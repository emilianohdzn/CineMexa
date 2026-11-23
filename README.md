# Cine Mexa

**El radar del cine mexicano.** _El cine mexicano está pasando._

App nativa de iPhone (Swift + SwiftUI) para descubrir y monitorear películas mexicanas en estreno, crítica, festivales en el mundo, convocatorias y tendencias digitales, con un backend en Supabase que sincroniza fuentes verificables.

> **Estado: Fases 1 y 2.** Arquitectura, contratos de datos, lógica núcleo con tests, esquema SQL con RLS validado y MVP SwiftUI navegable en **modo demostración**. El backend en vivo y los collectors son la Fase 3. Ver [`docs/PHASE-LOG.md`](docs/PHASE-LOG.md).

## Estructura

```
ios/                      Proyecto Xcode (CineMexa.xcodeproj, iOS 18+, SwiftUI)
  CineMexa/App            Entrada, estado global (AppModel), navegación por pestañas
  CineMexa/Core           Modelos del contrato, repositorios demo/en vivo, caché, lógica y favoritos (SwiftData)
  CineMexa/DesignSystem   Tokens, tipografía, marca (XMark, Wordmark) y componentes
  CineMexa/Features       Radar, Películas + ficha, Crítica, Mapa, Trends, Festivales, Búsqueda, Favoritos, Configuración
  CineMexa/Resources      DemoData.json (generado), fuentes OFL, ejemplo de LiveConfig
  CineMexaTests           Tests con Swift Testing
packages/core/            TypeScript compartido: contratos, normalización, deduplicación, disponibilidad, trend_score
backend/supabase/         Migraciones SQL (Postgres + RLS)
backend/test/             Tests de migraciones sobre Postgres embebido (PGlite)
backend/collectors/       Ingesta por proveedor (Fase 3)
demo/                     Generador y tests de los datos de demostración
admin/                    Curaduría web (pendiente)
docs/                     Arquitectura, metodología, licencias, marca, TestFlight, hoja de ruta, bitácora
```

## Ejecutar la app (Mac)

Requisitos: macOS con **Xcode 16 o posterior** (iOS 18 SDK).

1. Abre `ios/CineMexa.xcodeproj`.
2. Elige el esquema **CineMexa** y un simulador de iPhone (p. ej. iPhone 16).
3. ⌘R. La app arranca en **modo demostración** (datos ficticios, siempre etiquetados).
4. ⌘U ejecuta los tests de Swift.

Para un dispositivo físico, selecciona tu equipo en _Signing & Capabilities_ (el proyecto trae `DEVELOPMENT_TEAM` vacío a propósito).

Línea de comandos:

```sh
xcodebuild -project ios/CineMexa.xcodeproj -scheme CineMexa \
  -destination 'platform=iOS Simulator,name=iPhone 16' test
```

> ⚠️ El proyecto **no se ha compilado todavía**: se escribió en un entorno Linux sin Xcode. Ver “Qué está verificado”.

## Tests (Node 22.18+)

```sh
npm test              # core + datos demo + migraciones
npm run test:core     # normalización, deduplicación, disponibilidad, trend_score
npm run test:db       # requiere: cd backend && npm install
npm run demo:build    # regenera ios/CineMexa/Resources/DemoData.json
```

## Qué está verificado

| Parte | Verificación |
|---|---|
| `packages/core` | 29 tests pasan (`node --test`) |
| Migración SQL | 12 tests pasan en Postgres real embebido (PGlite) con roles de Supabase simulados: RLS, restricciones, unicidad, licencias de reseñas |
| `DemoData.json` | 6 tests pasan: contrato, referencias, tokens de fecha, todo marcado como demo, sin pósters inventados |
| Proyecto Xcode | `project.pbxproj` parseado sin referencias rotas |
| Código Swift | Revisión sintáctica con tree-sitter-swift: sin errores salvo macros (`#Predicate`, `#expect`) que esa gramática no soporta. **No compilado** con `swiftc` |
| Tests Swift | Escritos, **no ejecutados** (requieren Xcode) |

## Modo demostración y modo en vivo

- **Demo**: lee `DemoData.json`, con el mismo contrato JSON que servirá la API. Películas, personas, medios, reseñas y métricas son ficticias; los festivales son reales pero sus fechas y participaciones demo son inventadas. Un aviso amarillo lo indica en todas las pantallas clave.
- **En vivo**: `LiveRepository` llama a la Edge Function `catalog` (Fase 3/4) con la clave pública. Si falla, muestra el último catálogo válido con “Actualización pendiente”; nunca rellena con datos demo.

Configura el backend en _Configuración_ dentro de la app, o copia `ios/CineMexa/Resources/LiveConfig.example.json` como `LiveConfig.json` (ignorado por git). Sólo claves públicas: las secretas van en `.env` del backend (ver `.env.example`).

## Documentación

- [Arquitectura y contratos](docs/ARCHITECTURE.md)
- [Metodología de Trends](docs/TRENDS-METHODOLOGY.md)
- [Fuentes, licencias y privacidad](docs/SOURCES-AND-LICENSES.md)
- [Identidad visual](docs/BRAND.md)
- [TestFlight](docs/TESTFLIGHT.md)
- [Hoja de ruta](docs/ROADMAP.md)
- [Bitácora por fase](docs/PHASE-LOG.md)
