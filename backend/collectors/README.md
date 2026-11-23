# Collectors (Fase 3, pendiente)

Un servicio de ingesta por proveedor. Todavía no hay código aquí: se implementa en la Fase 3.

Contrato previsto (ver `docs/ARCHITECTURE.md`):

```
Fuente externa → collector → normalización (packages/core/normalize) → deduplicación (packages/core/dedupe)
→ verificación → upsert en Postgres (source_records + tablas de hechos) → ingestion_runs
```

Orden planeado: `wikidata` (SPARQL, sin clave) → `tmdb` (requiere token) → `youtube` (requiere clave y control de cuota) → festivales (feeds oficiales o captura editorial).

Reglas: sin scraping que viole términos de servicio; sin claves en el cliente; si una fuente falla se conserva el último dato válido y se registra la corrida como `failed` o `partial`.
