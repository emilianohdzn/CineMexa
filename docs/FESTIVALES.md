# Festivales: directorio y actividad verificada

Dos capas, con reglas distintas.

## 1. Directorio (`festivals`, `festival_editions`, `venues`)

- 14 festivales en `backend/seed/festivals.json`: ciudad, país, web oficial, enfoque. Las sedes son de **precisión ciudad**
  (`coordinate_precision = 'city'`) hasta tener la dirección de la sede oficial.
- Ediciones con fecha en `backend/seed/festival-editions.json`, cada una con `source_url` y estado:
  - `verified`: fecha leída en el sitio oficial del festival (Sundance 2027, Clermont-Ferrand 2027, Berlinale 2027).
  - `editorial`: fecha publicada por prensa o por la oficina de turismo que cita al festival (FICM 2026, FICUNAM 2026,
    Los Cabos 2026, Cannes 2027, Berlinale 2025, que permite ligar el Oso de Plata 2025 hallado en Wikidata).
  - Sin fuente no hay edición. FICG, GIFF, Ambulante, DocsMX, Venecia, San Sebastián y Locarno quedan sin fecha
    hasta que su sitio oficial la publique.
- Cambios de sede con fuente: Sundance se muda a Boulder (EE. UU.) desde 2027.
- `npm run seed:festivals` es idempotente: vuelve a escribir sólo lo que cambió.

## 2. Actividad verificada (`festival_events`)

Conector `backend/collectors/wikidata/festivals.ts` (datos abiertos CC0, `npm run collect:festivals`, trabajo `festivales`):

1. **Identidad**: liga un festival con su elemento de Wikidata sólo si la web oficial (P856) coincide por dominio
   y hay **un único** candidato. Las ediciones (que comparten dominio) se excluyen.
2. **Ediciones**: agrega ediciones con fecha de inicio (P580) que no existan. Una edición con fuente editorial o
   verificada **nunca** se sobrescribe.
3. **Premios y nominaciones** de películas con país de origen México (P495) cuyo premio pertenece al festival,
   **sólo si la declaración tiene referencia** en Wikidata. Se liga a la edición de ese año; si no hay edición, no se
   crea nada. Premio → `award`; nominación → `selection` con sección "En competencia por …".

Lo que el conector **no** hace: no deduce que una película se exhibirá porque fue seleccionada antes, no crea
funciones ni horarios, no inventa programación para el mapa. Las funciones (`screenings`) sólo llegarán de la
programación oficial publicada por cada festival.

Ambigüedades (dos candidatos de identidad) no se resuelven solas: quedan sin vincular para revisión editorial.
