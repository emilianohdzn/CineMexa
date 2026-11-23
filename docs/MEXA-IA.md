# Mexa IA: arquitectura propuesta

Estado: **diseño**. No hay modelos de pago activados ni llaves de IA configuradas. Activar un modelo requiere
autorización explícita, con presupuesto mensual aprobado.

## Principios

1. **Primero datos estructurados, luego lenguaje.** Mexa responde desde las tablas de Cine Mexa (películas, créditos,
   festivales, crítica, noticias, tendencias). Nunca desde lo que "sabe" un modelo.
2. **Siempre con fuente.** Cada afirmación lleva el registro que la sostiene y su procedencia
   (`source_id`, `source_url`, `retrieved_at`, `verification`), igual que el catálogo.
3. **Sin datos, no hay respuesta.** "No tengo datos verificados sobre eso" es una respuesta válida. Mexa no predice
   funciones, fechas ni premios.
4. **Sin infraestructura nueva.** Supabase (Postgres y Edge Functions) y GitHub Actions ya existentes. Nada de base
   vectorial mientras la búsqueda estructurada alcance.
5. **Llaves fuera del iPhone.** La app sólo conoce la URL pública y la clave publicable. Cualquier llave de modelo vive
   como secreto de la Edge Function.

## Fase A: sin modelo (costo $0)

Una Edge Function `mexa` recibe la pregunta y la resuelve con reglas:

- **Entidades** con `pg_trgm` (ya instalado, índice `films_title_trgm_idx`): películas, personas, festivales y ciudades.
  Si hay más de un candidato, Mexa pregunta cuál ("¿Te refieres a *Mácula* de 2025 o de 2026?").
- **Intenciones** con un catálogo cerrado de consultas parametrizadas. Ejemplos:
  - películas de un director o de un año;
  - estrenos próximos;
  - dónde verla (sólo funciones reales o streaming registrado);
  - premios en un festival;
  - crítica de una película;
  - qué está en tendencia y por qué (con la metodología de `TRENDS-METHODOLOGY.md`).
- **Respuesta** como JSON:

```json
{ "text": "…", "citations": [{ "type": "festival_event", "id": "…", "source": "wikidata", "url": "…", "retrieved_at": "…" }],
  "confidence": "verified|editorial|automatic", "unanswered": null }
```

Esto ya cubre la mayoría de preguntas reales sobre el catálogo y sirve como banco de pruebas.

## Fase B: modelo de lenguaje opcional (requiere autorización)

El modelo sólo hace dos cosas:

1. Convierte la pregunta en una llamada a las mismas consultas de la Fase A (uso de herramientas con esquema cerrado).
2. Redacta la respuesta **únicamente** con las filas devueltas, citando cada una.

Controles:

- **Presupuesto mensual con tope duro.** Cada llamada registra sus tokens y su costo estimado en una tabla
  `ai_usage` (fecha, tokens de entrada y salida, costo). Al llegar al tope, Mexa vuelve a la Fase A sin modelo.
- **Caché** por pregunta normalizada y versión del catálogo (`meta.etag`): la misma pregunta no se paga dos veces.
- **Límite por dispositivo** (por ejemplo 20 preguntas al día) con un identificador anónimo, sin cuenta.
- **Evaluación** antes de activar: un conjunto de 50 preguntas con respuesta esperada, medido en la Fase A y con modelo.
  Se activa sólo si mejora y no inventa (0 afirmaciones sin cita).
- El proveedor, el modelo y su precio se eligen al activar, con una cotización mensual para tu aprobación.

## ¿Base vectorial?

Sólo si la evaluación muestra preguntas que la búsqueda estructurada y de texto no resuelve (por ejemplo, temas de
la crítica). En ese caso `pgvector` en el mismo Postgres de Supabase, sin servicio nuevo. Los embeddings se calcularían
sólo sobre títulos y metadatos permitidos, nunca sobre textos completos de crítica.

## n8n (opcional, sin duplicar collectors)

n8n no ingiere datos: los collectors viven en `backend/` y corren en GitHub Actions. Si se usa n8n, sólo orquesta
alrededor:

- **Avisos**: consulta `ingestion_runs` (corridas fallidas o atrasadas) y `match_reviews` pendientes, y avisa por
  correo o mensajería.
- **Disparar una corrida**: llama a `workflow_dispatch` de `collectors.yml` con un token de GitHub de alcance mínimo
  (sólo Actions de este repositorio).
- **Revisión editorial**: un formulario que llama a `npm run revisar` vía Actions o a una función protegida para staff.
  Nunca expone la conexión de servicio.

Credenciales de n8n: un usuario de Postgres de **sólo lectura** sobre `ingestion_runs` y `match_reviews`, o la API REST
con un rol limitado. Nunca `DATABASE_URL` del rol de servicio.

## Próximos pasos

1. Fase A: Edge Function `mexa` con 6 intenciones y pruebas (sin costo).
2. Pantalla "Pregúntale a Mexa" en la app, con las fuentes visibles bajo cada respuesta.
3. Conjunto de evaluación de 50 preguntas.
4. Sólo con tu autorización: cotización y activación de la Fase B con tope mensual.
