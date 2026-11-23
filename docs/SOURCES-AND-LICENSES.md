# Fuentes, licencias, privacidad y seguridad

## Proveedores

| Fuente | Uso | Credenciales | Licencia / términos | Atribución en app |
|---|---|---|---|---|
| Wikidata | identidad canónica, directores, países, coproducciones | no (User-Agent identificable) | CC0 | “Datos de Wikidata (CC0)” |
| TMDB | metadatos complementarios, rutas de imágenes | token de lectura (servidor) | TMDB API Terms; uso comercial requiere acuerdo | “This product uses the TMDB API but is not endorsed or certified by TMDB.” + logo según sus lineamientos |
| YouTube Data API | señales de tendencia | clave (servidor), cuota diaria | YouTube API Services ToS; caché limitada por sus políticas | “Datos de YouTube” |
| Google Trends API | señal opcional | acceso aprobado | según acuerdo | “Datos de Google Trends” |
| Festivales | ediciones, selecciones, programas | según fuente | feeds/calendarios oficiales o captura editorial | nombre del festival + enlace |
| Crítica | reseñas enlazadas | según alianza | sólo título + enlace; puntuación/extracto con permiso | medio y crítico |

Pendientes de decisión: revisar con TMDB el uso comercial antes de monetizar; definir alianzas editoriales (Cine PREMIERE, Tomatazos, medios culturales). No se consumen puntuaciones de Rotten Tomatoes ni Letterboxd.

## Reglas

- Sin scraping que viole términos de servicio, sistemas de acceso o restricciones técnicas. Donde no hay API, captura editorial.
- Pósters: sólo de fuentes autorizadas, con fuente y atribución en `film_images`. Nunca imágenes generadas o incorrectas como póster oficial.
- Reseñas: nunca artículos completos ni citas ficticias. La base de datos impide guardar `score` o `excerpt` sin bandera de licencia.
- Resúmenes automatizados: siempre etiquetados y con enlace a sus fuentes.

## Seguridad

- La app sólo incluye la URL del backend y la clave **pública** (anon/publishable). `service_role` y claves de proveedores viven en secretos del servidor (`.env.example`).
- RLS activo en todas las tablas (verificado por test).
- Pendiente (Fase 3): validación de entrada y rate limiting en Edge Functions, CORS restringido para la futura web.

## Privacidad

- Sin cuenta: favoritos locales (SwiftData).
- Sin ubicación: la ciudad se elige manualmente.
- Notificaciones sólo al tocar “Recordarme”; calendario mediante la hoja nativa con confirmación explícita.
- Sin analítica ni rastreadores publicitarios. Cualquier analítica futura requiere decisión explícita.

## Tipografías incluidas

- Fredoka — SIL Open Font License 1.1 (The Fredoka Project Authors). Se incluyen instancias estáticas SemiBold (600) y Bold (700) generadas desde la fuente variable; la familia no tiene ExtraBold, así que Bold es el peso máximo.
- IBM Plex Mono — SIL Open Font License 1.1 (IBM Corp.), sin modificar.

Las licencias están en `ios/CineMexa/Resources/Fonts/`.
