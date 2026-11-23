#!/usr/bin/env bash
# descargar binario de gowitness de releases en github e instalar
# instalar nmap desde pacman y compilar ipcalc 1.2.0 (necesario para --format=json)
# descargar binario de nmap-atlas de releases en github e instalar
set -euo pipefail

readonly GOWITNESS_REPO="sensepost/gowitness"
readonly ATLAS_REPO="datadiego/nmap-atlas"
readonly IPCALC_VERSION="1.2.0"
readonly IPCALC_URL="https://gitlab.com/ipcalc/ipcalc/-/archive/${IPCALC_VERSION}/ipcalc-${IPCALC_VERSION}.tar.gz"
readonly INSTALL_DIR="/usr/local/bin"

log()  { printf '\n==> %s\n' "$*"; }
warn() { printf 'Aviso: %s\n' "$*" >&2; }
die()  { printf 'Error: %s\n' "$*" >&2; exit 1; }

if [[ $EUID -eq 0 ]]; then
  SUDO=()
else
  command -v sudo >/dev/null 2>&1 || die "Necesitas sudo para instalar en ${INSTALL_DIR}."
  SUDO=(sudo)
  "${SUDO[@]}" -v || die "No se pudo obtener permisos con sudo."
fi

for command in curl mktemp tar pacman; do
  command -v "$command" >/dev/null 2>&1 || die "Falta el comando ${command}."
done

case "$(uname -m)" in
  x86_64|amd64)  gowitness_arch="amd64" ;;
  aarch64|arm64) gowitness_arch="arm64" ;;
  armv7l|armv8l) gowitness_arch="arm" ;;
  *) die "Arquitectura $(uname -m) no soportada por gowitness." ;;
esac

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

log "1/3 Descargando gowitness..."
release_url="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/${GOWITNESS_REPO}/releases/latest")"
gowitness_tag="${release_url%/}"
gowitness_tag="${gowitness_tag##*/}"
gowitness_url="https://github.com/${GOWITNESS_REPO}/releases/download/${gowitness_tag}/gowitness-${gowitness_tag}-linux-${gowitness_arch}"
curl -fL --retry 3 -o "${workdir}/gowitness" "$gowitness_url"
"${SUDO[@]}" install -m 0755 "${workdir}/gowitness" "${INSTALL_DIR}/gowitness"
printf 'gowitness %s instalado en %s\n' "$gowitness_tag" "${INSTALL_DIR}/gowitness"

log "2/3 Instalando nmap y compilando ipcalc ${IPCALC_VERSION}..."
"${SUDO[@]}" pacman -Syu --noconfirm --needed nmap gcc make
printf 'nmap instalado: %s\n' "$(nmap --version 2>&1 | head -n 1)"
printf 'Descargando y compilando ipcalc %s...\n' "$IPCALC_VERSION"
curl -fL --retry 3 -o "${workdir}/ipcalc.tar.gz" "$IPCALC_URL"
tar -xzf "${workdir}/ipcalc.tar.gz" -C "$workdir"
make -C "${workdir}/ipcalc-${IPCALC_VERSION}" USE_MAXMIND=no >/dev/null
"${SUDO[@]}" install -m 0755 "${workdir}/ipcalc-${IPCALC_VERSION}/ipcalc" "${INSTALL_DIR}/ipcalc"
if ! "${INSTALL_DIR}/ipcalc" --format=json 10.0.0.0/24 >/dev/null 2>&1; then
  die "ipcalc ${IPCALC_VERSION} no devolvió un JSON válido."
fi
printf 'ipcalc instalado: %s\n' "$("${INSTALL_DIR}/ipcalc" --version 2>&1 | head -n 1)"

log "3/3 Descargando nmap-atlas..."
curl -fL --retry 3 -o "${workdir}/nmap-atlas" \
  "https://github.com/${ATLAS_REPO}/releases/latest/download/nmap-atlas"
"${SUDO[@]}" install -m 0755 "${workdir}/nmap-atlas" "${INSTALL_DIR}/nmap-atlas"
printf 'nmap-atlas instalado en %s\n' "${INSTALL_DIR}/nmap-atlas"

log "Comprobación..."
for binary in nmap gowitness ipcalc nmap-atlas; do
  if command -v "$binary" >/dev/null 2>&1; then
    printf '  %-12s %s\n' "$binary" "$(command -v "$binary")"
  else
    warn "${binary} no está en el PATH; añade ${INSTALL_DIR} al PATH."
  fi
done

printf '\nListo. Arranca la interfaz con: nmap-atlas\n'
