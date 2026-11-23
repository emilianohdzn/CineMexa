#!/bin/bash
# Cine Mexa · cambia sólo la contraseña de DATABASE_URL en backend/.env.local.
# Útil si la URI se pegó con el marcador [YOUR-PASSWORD] o si se restableció la contraseña.
# Entrada oculta; el valor nunca se imprime. El archivo conserva el permiso 600.
#
# Uso: ./scripts/cambiar-password-db.sh   (desde la raíz del repositorio)
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE="backend/.env.local"

[[ -f "$ENV_FILE" ]] || { echo "  ✗ No existe $ENV_FILE. Corre primero ./scripts/configurar.sh"; exit 1; }
git check-ignore -q "$ENV_FILE" || { echo "  ✗ $ENV_FILE no está en .gitignore. No se cambió nada."; exit 1; }

printf '\033[1m%s\033[0m\n' "Cine Mexa · contraseña de la base de datos"
echo "  Es la contraseña de la base de tu proyecto (Project Settings > Database). No se muestra al escribirla."
while true; do
  printf '  Contraseña: '
  IFS= read -r -s DB_PASSWORD; echo
  [[ -n "$DB_PASSWORD" ]] && break
  echo "  ! Vacía. Inténtalo de nuevo."
done

DB_PASSWORD="$DB_PASSWORD" ENV_FILE="$ENV_FILE" node -e '
const fs = require("node:fs");
const file = process.env.ENV_FILE;
const lines = fs.readFileSync(file, "utf8").split("\n");
const i = lines.findIndex((l) => l.startsWith("DATABASE_URL="));
if (i < 0) { console.error("  ✗ No hay DATABASE_URL en el archivo."); process.exit(1); }
const url = new URL(lines[i].slice("DATABASE_URL=".length).replace(/^"(.*)"$/, "$1"));
url.password = encodeURIComponent(process.env.DB_PASSWORD);
lines[i] = "DATABASE_URL=" + url.toString();
fs.writeFileSync(file, lines.join("\n"), { mode: 0o600 });
fs.chmodSync(file, 0o600);
'
unset DB_PASSWORD
printf '  \033[32m✓\033[0m %s\n' "Contraseña actualizada en $ENV_FILE (permiso 600). Ya puedes cerrar esta ventana."
