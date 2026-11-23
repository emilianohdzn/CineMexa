# Hoja de ruta

## Fase 3 · Backend y sincronización real
**Hecho (probado con PGlite y respuestas sintéticas; falta correrlo contra los servicios reales):**
collector Wikidata, collector TMDB, collector YouTube + job de tendencias, Edge Function `catalog`
(contrato v1, RLS como anon, ETag) y `public_source_status()`. La app decodifica la respuesta (prueba en Swift).

**Plan original:**
- Collector Wikidata (SPARQL): películas con país de origen México (Q96), directores, coproducciones, ids externos.
- Collector TMDB aislado: metadatos, imágenes autorizadas, `release_dates` para MX, proveedores de streaming si los términos lo permiten.
- Collector YouTube con caché y presupuesto de cuota; escritura en `trend_signals` y job de `trend_snapshots`.
- Sistema extensible de fuentes de festivales: adaptador por feed/ICS oficial + captura editorial.
- Edge Function `catalog` (contrato v1) con caché HTTP y rate limiting; funciones de detalle paginadas si el catálogo crece.
- Supabase Cron con las frecuencias de `.env.example`.

## Fase 4 · Integración
- App contra el backend real; pósters reales; estados de actualización y atribuciones.
- Endpoint incremental (`since=`) para no descargar el catálogo completo.

## Fase 5 · Calidad
- Compilación y tests en Xcode; UI tests de navegación; auditoría de VoiceOver y Dynamic Type XXL; Instruments en listas y mapa.
- Extraer `Core` a un paquete SPM `CineMexaKit`.

## Después
- Admin web de curaduría (Supabase Auth + `staff`).
- Cuenta opcional y sincronización de favoritos (`user_favorites`).
- Alertas: estrenos, selecciones oficiales, recordatorios de festivales y deadlines (push).
- Widgets (Top 5, próximo festival) y Live Activities para festivales en curso.
- Versión web usando la misma API.
- Alianzas editoriales de crítica con licencias de extracto/puntuación.
