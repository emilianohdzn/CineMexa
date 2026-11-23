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
