// Reglas de disponibilidad y de estado temporal de festivales y eventos.
// Principio: una fecha de estreno estimada nunca se convierte en una función real.

export type FilmStatus = "in_theaters" | "release_identified" | "festival" | "upcoming" | "archive";

export interface AvailabilityInput {
  now: Date;
  mxReleaseDate?: string | null; // fecha de estreno identificada en la base
  confirmedScreenings: { startsAt: string }[]; // funciones confirmadas por una sala
  festivalEvents: { date: string }[]; // proyecciones o selecciones con fecha confirmada
  year?: number | null; // año de la obra; si es posterior al actual, aún no se ha estrenado
}

const DAY = 86_400_000;

/**
 * Prioridad: funciones confirmadas próximas > estreno identificado reciente (sin funciones)
 * > festival en los próximos/últimos 30 días > próximamente > archivo.
 */
export function classifyFilmStatus(i: AvailabilityInput): FilmStatus {
  const now = i.now.getTime();
  const upcomingScreening = i.confirmedScreenings.some((s) => {
    const t = Date.parse(s.startsAt);
    return t >= now && t - now <= 14 * DAY;
  });
  if (upcomingScreening) return "in_theaters";

  if (i.mxReleaseDate) {
    const r = Date.parse(i.mxReleaseDate);
    if (r > now) return "upcoming";
    if (now - r <= 28 * DAY) return "release_identified";
  }
  if (i.festivalEvents.some((e) => Math.abs(Date.parse(e.date) - now) <= 30 * DAY)) return "festival";
  // Sin fecha de estreno identificada, una obra fechada en un año futuro está por estrenarse.
  if (!i.mxReleaseDate && i.year && i.year > i.now.getUTCFullYear()) return "upcoming";
  return "archive";
}

export type EditionStatus = "upcoming" | "active" | "past" | "unconfirmed";

/** Las fechas de edición son fechas de calendario locales (YYYY-MM-DD), inclusivas. */
export function editionStatus(startsOn: string | null, endsOn: string | null, today: string): EditionStatus {
  if (!startsOn || !endsOn) return "unconfirmed";
  if (today < startsOn) return "upcoming";
  if (today > endsOn) return "past";
  return "active";
}

export type MapPeriod = "week" | "month" | "upcoming" | "last12" | "historic";

/** ¿Un evento con fecha confirmada cae en el periodo del filtro del mapa? */
export function inMapPeriod(eventDate: string | null, period: MapPeriod, now: Date): boolean {
  if (!eventDate) return false; // sin fecha confirmada no se muestra como actividad
  const t = Date.parse(eventDate);
  const n = now.getTime();
  switch (period) {
    case "week": return t >= n - 3 * DAY && t <= n + 7 * DAY;
    case "month": return t >= n - 7 * DAY && t <= n + 31 * DAY;
    case "upcoming": return t >= n;
    case "last12": return t >= n - 365 * DAY && t <= n;
    case "historic": return t <= n;
  }
}
