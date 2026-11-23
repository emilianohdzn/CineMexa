# Crítica y noticias

## Qué se guarda y qué no

- Se guarda: **título, autor (si el medio lo publica), medio, fecha y enlace al artículo original**.
- No se guarda: el texto del artículo, extractos ni calificaciones. Las columnas `excerpt` y `score` de `reviews`
  sólo pueden llenarse con licencia (`excerpt_licensed`, `score_licensed`), y el colector nunca las toca.
- La app muestra la crítica y la noticia con su medio y abre el artículo en el sitio del medio.

## Fuentes permitidas

Cada medio es una fila de `sources` con `kind = 'feed'`, `feed_url` (https), `feed_kind` (`reviews`, `news`, `mixed`) y
`feed_scope` (`mx` si el medio se dedica al cine mexicano, `general` si no). Todas nacen **desactivadas**: se activan
una por una después de revisar los términos del medio (feed público de sindicación o permiso expreso).
Sin medios activados el trabajo `noticias` termina sin hacer nada.

## Cómo se vincula un artículo con una película

Un título parecido **nunca basta**. Se vincula solo si:

1. el titular (o una etiqueta del artículo) contiene el título exacto de **una sola** película del catálogo
   (si un título está contenido en otro, cuenta el más largo),
2. el año de la película es compatible con la fecha del artículo (de 3 años antes a 1 después), y
3. hay evidencia adicional: el título va **entre comillas** en el titular, es **la etiqueta** del artículo, o el
   titular **menciona a quien dirige**.

Si falta algo, el artículo va a la **cola de revisión** (`match_reviews`, tipo `feed_item`) con el motivo.
Una crítica no se publica hasta que se decide. Una noticia de un medio `mx` se publica sin película mientras tanto.

## Cola de revisión

```
npm run revisar                      # lista lo pendiente (TMDB, crítica, noticias) con el motivo
npm run revisar -- --aceptar <id>    # aplica la coincidencia y rechaza los otros candidatos del mismo registro
npm run revisar -- --rechazar <id>   # la descarta
```

Aceptar un candidato de TMDB vincula el id (el siguiente `collect:tmdb` trae póster y datos). Aceptar una crítica la
publica con verificación `editorial`.
