# Publicación en TestFlight

1. **Cuenta**: Apple Developer Program activo. En Xcode, _Settings › Accounts_, agrega el Apple ID.
2. **Identidad**: en el target CineMexa, _Signing & Capabilities_, elige el equipo. Cambia `PRODUCT_BUNDLE_IDENTIFIER` (`mx.cinemexa.app`) si ese identificador no está disponible para tu equipo.
3. **App Store Connect**: crea la app con el mismo bundle ID, nombre “Cine Mexa”, idioma principal Español (México), categoría Entretenimiento.
4. **Privacidad**: en “App Privacy” declara que no se recopilan datos (estado actual: sin cuenta, sin analítica, sin ubicación). Revisa de nuevo si se activa Supabase Auth.
5. **Versión**: sube `MARKETING_VERSION` y `CURRENT_PROJECT_VERSION` en cada build.
6. **Archivo**: destino _Any iOS Device (arm64)_ → _Product › Archive_ → _Distribute App › App Store Connect › Upload_.
7. **TestFlight**: espera el procesamiento, completa “Test Information” y agrega testers internos. Los externos requieren revisión beta.
8. **Antes de una beta pública**: modo en vivo configurado con backend real, atribuciones de TMDB visibles en _Fuentes y créditos_, URL de política de privacidad, y decidir si la demo queda disponible para revisores (recomendado, claramente etiquetada).

Automatización futura: `xcodebuild archive` + `xcodebuild -exportArchive` o Xcode Cloud con un flujo en la rama `main`.

## Estado de preparación (revisado el 23 nov 2026)

| Punto | Estado | Detalle |
| --- | --- | --- |
| Firma | Listo en la Mac | `DEVELOPMENT_TEAM` vacío en el repositorio a propósito. La Mac firma con tu equipo y la build ya se instaló en tu iPhone. Para archivar, elige el equipo en _Signing & Capabilities_. |
| Bundle ID | Listo | `mx.cinemexa.app` (pruebas: `.appTests`, `.appUITests`). Falta crear la app en App Store Connect con ese ID. |
| Entitlements | Listo | No usa capacidades especiales (sin iCloud, push remoto ni App Groups). |
| Permisos | Listo | Sin ubicación, cámara ni fotos. Las notificaciones locales (recordatorio de convocatoria) se piden sólo al tocar el botón. "Agregar al calendario" usa la hoja nativa, que no requiere permiso en iOS 17+. **Probar en el iPhone antes de enviar.** |
| Ícono | Listo | `AppIcon` de 1024 px de tamaño único. |
| Versión | Pendiente | `0.1.0 (1)`. Sube `CURRENT_PROJECT_VERSION` en cada build que envíes. |
| Manifiesto de privacidad | Listo | `PrivacyInfo.xcprivacy`: sin rastreo ni datos recopilados; UserDefaults con razón CA92.1. |
| Cumplimiento de exportación | Listo | `ITSAppUsesNonExemptEncryption = NO` (sólo HTTPS del sistema). |
| Política de privacidad | **Falta** | App Store Connect pide una URL. Contenido sugerido: sin cuenta, sin analítica, sin rastreo; favoritos y ciudad sólo en el dispositivo. |
| Atribuciones | Casi listo | TMDB fijo en _Fuentes y créditos_, Wikidata y YouTube desde el catálogo, tipografías OFL. **Falta el logo de TMDB** (sus términos lo piden en la pantalla de créditos). |
| Compatibilidad | Listo | iOS 18.0 o superior, iPhone, vertical, modo oscuro. |
| En línea y sin conexión | Probado | Prueba de interfaz "sin conexión con Reintentar"; caché del último catálogo válido; catálogo incremental con respaldo completo. |
| Errores y estados vacíos | Probado en simulador | Error de red con reintento; tendencias sin evidencia suficiente lo dicen en lugar de inventar un ranking. |
| Configuración en vivo | Atención | `LiveConfig.json` (URL y clave publicable) no está en git: debe existir en la Mac al archivar (`scripts/configurar.sh`). Si falta, la app arranca en demo. |
| Capturas para la tienda | Falta | 6.9" (iPhone 17 Pro Max) obligatorias. |

**No se ha enviado ninguna build.** Para TestFlight interno sólo hace falta crear la app en App Store Connect, archivar
y subir. Los testers externos y una beta pública requieren revisión de Apple y tu autorización explícita.
