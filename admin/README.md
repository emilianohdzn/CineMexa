# Admin (pendiente)

Interfaz web mínima de curaduría, separada de la app iOS, protegida con Supabase Auth y la tabla `staff`.
El esquema ya soporta sus permisos (políticas `staff_all` en la migración inicial). Funciones previstas:
agregar festivales y ediciones, confirmar proyecciones, vincular reseñas, resolver duplicados (`films.merged_into`),
aprobar hechos ambiguos (`needs_review`), revisar `ingestion_runs` y ver `source_records`.
