import { stripDiacritics } from "../../../packages/core/src/index.ts";

/** Slug ASCII en minúsculas con guiones, compatible con el check de films.slug. */
export function slugify(...parts: Array<string | number | null | undefined>): string {
  const s = parts
    .filter((p) => p !== null && p !== undefined && `${p}`.trim() !== "")
    .map((p) => stripDiacritics(`${p}`.toLowerCase()).replace(/ñ/g, "n"))
    .join(" ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "pelicula";
}
