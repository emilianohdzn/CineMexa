#!/bin/bash
# Cine Mexa · asistente de configuración local.
#
# Pide cada credencial con entrada oculta (no se muestra ni queda en el historial), la valida por
# formato sin imprimirla, y la guarda en archivos privados (permiso 600) que Git ignora:
#   backend/.env.local                    → collectors, jobs y pruebas de conexión (servidor)
#   ios/CineMexa/Resources/LiveConfig.json → sólo URL pública + Publishable Key (app)
# Después, opcionalmente: Supabase CLI (login oficial + link) y secretos de GitHub Actions.
#
# Uso: ./scripts/configurar.sh        (desde la raíz del repositorio)
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
REPO_SLUG="emilianohdzn/CineMexa"
ENV_FILE="backend/.env.local"
IOS_FILE="ios/CineMexa/Resources/LiveConfig.json"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; exit 1; }
ask_yes() { local a; read -r -p "  $1 [s/N] " a; [[ "$a" =~ ^[sSyY] ]]; }

bold "Cine Mexa · configuración local"
echo "  Las claves no se muestran al escribirlas. Pega cada una y presiona Enter."
echo

# 1) Los archivos de destino deben estar ignorados por Git antes de escribir nada.
for f in "$ENV_FILE" "$IOS_FILE"; do
  git check-ignore -q "$f" || fail "$f no está en .gitignore. No se escribió nada."
done
ok "Git ignora $ENV_FILE y $IOS_FILE"

# 2) Entradas ocultas con validación de formato (nunca se imprime el valor).
read_secret() { # nombre_variable  etiqueta  regex  ayuda
  local var="$1" label="$2" regex="$3" help="$4" value=""
  while true; do
    printf '  %s: ' "$label"
    IFS= read -r -s value; echo
    value="${value#"${value%%[![:space:]]*}"}"; value="${value%"${value##*[![:space:]]}"}"
    if [[ -z "$value" ]]; then warn "Vacío. Inténtalo de nuevo."; continue; fi
    if [[ "$value" =~ $regex ]]; then printf -v "$var" '%s' "$value"; ok "$label: formato correcto"; return; fi
    warn "No parece válido. $help"
  done
}

read_secret SUPABASE_URL "URL del proyecto Supabase" '^https://[a-z0-9]{20}\.supabase\.co/?$' \
  "Debe ser https://<ref>.supabase.co (Project Settings > API)."
SUPABASE_URL="${SUPABASE_URL%/}"
PROJECT_REF="$(printf '%s' "$SUPABASE_URL" | sed -E 's#^https://([a-z0-9]+)\.supabase\.co$#\1#')"

read_secret SUPABASE_PUBLISHABLE_KEY "Publishable Key de Supabase" '^(sb_publishable_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$' \
  "Empieza con sb_publishable_ (o la anon key legacy eyJ...). Nunca la secret/service_role."
if [[ "$SUPABASE_PUBLISHABLE_KEY" == eyJ* ]]; then
  ROLE="$(printf '%s' "$SUPABASE_PUBLISHABLE_KEY" | cut -d. -f2 | tr '_-' '/+' | base64 -D 2>/dev/null | grep -o '"role":"[a-z_]*"' || true)"
  [[ "$ROLE" == '"role":"anon"' ]] || fail "Esa clave JWT no es anon. La app sólo puede llevar la clave pública."
fi

read_secret DATABASE_URL "Conexión PostgreSQL (URI)" '^postgres(ql)?://[^:/@]+:[^@]+@[^/]+:[0-9]+/[A-Za-z0-9_]+' \
  "Debe ser postgresql://usuario:contraseña@host:puerto/postgres (botón Connect del proyecto)."
if [[ "$DATABASE_URL" == *"YOUR-PASSWORD"* || "$DATABASE_URL" == *"%5BYOUR"* ]]; then
  fail "La URI todavía tiene el marcador [YOUR-PASSWORD]. Vuelve a correr el asistente y reemplázalo por la contraseña de la base."
fi
DB_HOST="$(DATABASE_URL="$DATABASE_URL" node -e 'process.stdout.write(new URL(process.env.DATABASE_URL).hostname)')"
DB_USER="$(DATABASE_URL="$DATABASE_URL" node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DATABASE_URL).username))')"
if [[ "$DB_HOST" == *pooler.supabase.com ]]; then
  ok "Conexión por pooler (funciona también desde GitHub Actions, que no tiene IPv6)"
  [[ "$DB_USER" == *".$PROJECT_REF" ]] || warn "El usuario del pooler no corresponde al proyecto de la URL. Revisa que sean del mismo proyecto."
elif [[ "$DB_HOST" == "db.$PROJECT_REF.supabase.co" ]]; then
  warn "Conexión directa (sólo IPv6). Sirve en tu Mac, pero GitHub Actions necesitará la del Session pooler."
else
  warn "El host de la base no es de este proyecto de Supabase. Revisa que sea el correcto."
fi

read_secret TMDB_API_READ_TOKEN "Token de lectura de TMDB (API Read Access Token)" '^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' \
  "Es el token largo que empieza con eyJ (no la API key corta)."
read_secret YOUTUBE_API_KEY "Clave de YouTube Data API" '^AIza[0-9A-Za-z_-]{35}$' \
  "Empieza con AIza y tiene 39 caracteres."

WIKIDATA_USER_AGENT="CineMexaBot/0.1 (https://github.com/$REPO_SLUG)"

# 3) Archivos privados.
{
  echo "# Cine Mexa · secretos locales del servidor. Generado por scripts/configurar.sh. NO subir a Git."
  printf 'SUPABASE_URL=%s\n' "$SUPABASE_URL"
  printf 'SUPABASE_PUBLISHABLE_KEY=%s\n' "$SUPABASE_PUBLISHABLE_KEY"
  printf 'SUPABASE_PROJECT_REF=%s\n' "$PROJECT_REF"
  printf 'DATABASE_URL=%s\n' "$DATABASE_URL"
  printf 'TMDB_API_READ_TOKEN=%s\n' "$TMDB_API_READ_TOKEN"
  printf 'YOUTUBE_API_KEY=%s\n' "$YOUTUBE_API_KEY"
  printf 'WIKIDATA_USER_AGENT="%s"\n' "$WIKIDATA_USER_AGENT"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"
ok "Guardado $ENV_FILE (permiso 600)"

# La app sólo recibe la URL pública y la Publishable Key.
SUPABASE_URL="$SUPABASE_URL" KEY="$SUPABASE_PUBLISHABLE_KEY" node -e \
  'process.stdout.write(JSON.stringify({ baseUrl: process.env.SUPABASE_URL, anonKey: process.env.KEY }, null, 2) + "\n")' > "$IOS_FILE"
chmod 600 "$IOS_FILE"
ok "Guardado $IOS_FILE (sólo URL pública y Publishable Key)"

# Comprobación final: nada de esto quedó listo para commit.
if [[ -n "$(git status --porcelain -- "$ENV_FILE" "$IOS_FILE")" ]]; then fail "Git ve los archivos de secretos. Revisa .gitignore."; fi
ok "Git no ve ninguno de los dos archivos"
echo

# 4) Supabase CLI (inicio de sesión oficial en el navegador + vínculo con el proyecto).
bold "Supabase CLI"
if ! command -v supabase >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1 && ask_yes "Supabase CLI no está instalado. ¿Lo instalo con Homebrew (gratis)?"; then
    brew install supabase/tap/supabase
  else
    warn "Sin Supabase CLI. Instálalo después con: brew install supabase/tap/supabase"
  fi
fi
if command -v supabase >/dev/null 2>&1; then
  if ! supabase projects list >/dev/null 2>&1; then
    echo "  Se abrirá el navegador para iniciar sesión en Supabase (mecanismo oficial)."
    supabase login
  fi
  ok "Sesión de Supabase CLI activa"
  SUPABASE_DB_PASSWORD="$(DATABASE_URL="$DATABASE_URL" node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DATABASE_URL).password))')" \
    supabase link --project-ref "$PROJECT_REF" --workdir backend >/dev/null && ok "Proyecto vinculado (backend/supabase)" \
    || warn "No se pudo vincular. Si el proyecto está en pausa, reactívalo y vuelve a correr el asistente."
fi
echo

# 5) Secretos del entorno remoto de los collectors (GitHub Actions). Las Edge Functions no los
#    necesitan: `catalog` sólo usa SUPABASE_DB_URL, que Supabase inyecta solo.
bold "Secretos de GitHub Actions (donde correrán los collectors)"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  if ask_yes "¿Guardo DATABASE_URL, TMDB_API_READ_TOKEN y YOUTUBE_API_KEY como secretos de $REPO_SLUG?"; then
    printf '%s' "$DATABASE_URL" | gh secret set DATABASE_URL -R "$REPO_SLUG"
    printf '%s' "$TMDB_API_READ_TOKEN" | gh secret set TMDB_API_READ_TOKEN -R "$REPO_SLUG"
    printf '%s' "$YOUTUBE_API_KEY" | gh secret set YOUTUBE_API_KEY -R "$REPO_SLUG"
    gh variable set WIKIDATA_USER_AGENT -R "$REPO_SLUG" --body "$WIKIDATA_USER_AGENT" >/dev/null
    ok "Secretos guardados en GitHub (cifrados; nadie puede leerlos de vuelta)"
  fi
else
  warn "GitHub CLI no está listo. Para este paso: brew install gh && gh auth login, y vuelve a correr el asistente."
fi
echo
bold "Listo."
echo "  Variables guardadas: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_PROJECT_REF, DATABASE_URL,"
echo "  TMDB_API_READ_TOKEN, YOUTUBE_API_KEY, WIKIDATA_USER_AGENT. Ya puedes cerrar esta ventana."
