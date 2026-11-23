// Lectura de RSS 2.0 y Atom sin dependencias. Se queda sólo con metadatos (título, enlace, autor, fecha, etiquetas):
// la descripción y el contenido del artículo se descartan a propósito.
export interface FeedItem {
  url: string;
  title: string;
  author: string | null;
  publishedAt: string;
  categories: string[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", ndash: "–", mdash: "—", hellip: "…" };

export function decodeText(raw: string): string {
  const cdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return cdata
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

const tag = (block: string, name: string) => block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"))?.[1];
const tags = (block: string, name: string) => [...block.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi"))].map((m) => m[1]);
const attr = (el: string, name: string) => el.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1] ?? el.match(new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`, "i"))?.[1];

function httpUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(decodeText(raw));
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    // Los parámetros de campaña no identifican el artículo.
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/i.test(k)) u.searchParams.delete(k);
    u.hash = "";
    return u.toString();
  } catch { return null; }
}

function isoDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = Date.parse(decodeText(raw));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function parseFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  const seen = new Set<string>();
  const push = (item: FeedItem | null) => { if (item && !seen.has(item.url)) { seen.add(item.url); out.push(item); } };

  for (const block of tags(xml, "item")) {
    const url = httpUrl(tag(block, "link")) ?? (/isPermaLink\s*=\s*"false"/i.test(block) ? null : httpUrl(tag(block, "guid")));
    const title = decodeText(tag(block, "title") ?? "");
    const publishedAt = isoDate(tag(block, "pubDate") ?? tag(block, "dc:date"));
    const author = decodeText(tag(block, "dc:creator") ?? tag(block, "author") ?? "") || null;
    if (url && title && publishedAt) push({ url, title, author, publishedAt, categories: tags(block, "category").map(decodeText).filter(Boolean) });
  }
  for (const block of tags(xml, "entry")) {
    const links = [...block.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    const alt = links.find((l) => !attr(l, "rel") || attr(l, "rel") === "alternate");
    const url = httpUrl(alt ? attr(alt, "href") : undefined);
    const title = decodeText(tag(block, "title") ?? "");
    const publishedAt = isoDate(tag(block, "published") ?? tag(block, "updated"));
    const authorBlock = tag(block, "author");
    const author = authorBlock ? decodeText(tag(authorBlock, "name") ?? authorBlock) || null : null;
    const categories = [...block.matchAll(/<category\b[^>]*>/gi)].map((m) => attr(m[0], "term") ?? "").map(decodeText).filter(Boolean);
    if (url && title && publishedAt) push({ url, title, author, publishedAt, categories });
  }
  return out;
}
