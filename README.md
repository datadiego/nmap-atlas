# nmap atlas

Aplicación para lanzar escaneos con Nmap y explorarlos como grafo, árbol, lista o capturas. El backend es Hono y **SQLite es la única fuente de verdad**: escaneos, notas, ajustes y capturas viven en la base de datos; el XML solo se conserva como huella del resultado original.

## Requisitos

- Node 22 o superior (usa `node:sqlite`) o Bun (usa `bun:sqlite`).
- `nmap` en el `PATH`.
- `ipcalc` 1.2 o superior para el cálculo de rangos.
- `gowitness` v3 opcional, para capturas de servicios HTTP.

## Uso

```sh
npm install
npm start                 # build + servidor en http://127.0.0.1:4173
npm run binary            # genera el ejecutable ./nmap-atlas
./nmap-atlas
```

También puedes ejecutar el servidor sin recompilar con `npm run serve` (o `npm run cli`).

### Docker

```sh
docker compose up --build      # http://127.0.0.1:4173
```

La imagen incluye `nmap`, `ipcalc`, `gowitness` v3 y Chromium. La base de datos se guarda en el volumen `atlas-data`. El puerto se cambia con `PORT=8080 docker compose up`; la IP de escucha del host con `HOST_IP=0.0.0.0`.

En Linux, para escanear `127.0.0.1` o hacer descubrimiento ARP en la LAN, usa el perfil con red del host (para el servicio por defecto antes):

```sh
docker compose --profile host up nmap-atlas-host   # http://127.0.0.1:4173
```

### Base de datos

Por defecto se usa `./data/nmap-atlas.sqlite` (se crea automáticamente). Se puede cambiar con:

```sh
./nmap-atlas --db-path /ruta/otra.sqlite
NMAP_ATLAS_DB_PATH=/ruta/otra.sqlite ./nmap-atlas
```

En SQLite se guardan los escaneos parseados, `raw_xml`, notas de hosts, ajustes de la interfaz y las capturas como BLOB. Los nombres de escaneo no llevan extensión `.xml`.

## Opciones de la CLI

| Opción | Descripción |
| --- | --- |
| `-p, --port <puerto>` | Puerto HTTP (por defecto `4173`). |
| `-h, --host <host>` | Host de escucha (por defecto `127.0.0.1`). Usa `0.0.0.0` solo en redes de confianza. |
| `--db-path <ruta>` | Fichero SQLite (por defecto `./data/nmap-atlas.sqlite`). |
| `--timeout <ms>` | Tiempo máximo por escaneo (por defecto 30 min). |
| `--host-timeout <ms>` | Tiempo máximo por host. |
| `--no-save` | No guardar escaneos (las capturas requieren guardar). |
| `--nmap-sudo` | Ejecutar `sudo -n nmap`. |
| `--nmap-command <cmd>` | Prefijo completo del comando de nmap. |
| `--nmap-privileged` | Añade `--privileged` (necesario con `setcap`). |
| `--nse-scripts-dir <ruta>` | Directorio de scripts NSE si no se detecta automáticamente. |
| `--ipcalc-command <cmd>` | Ruta a `ipcalc`. |
| `--gowitness-command <cmd>` | Ruta a `gowitness`. |
| `--help` | Mostrar la ayuda. |

### Permisos

Algunas funcionalidades de nmap necesitan permisos elevados, puedes usar:


```bash
sudo setcap cap_net_raw,cap_net_admin=eip "$(command -v nmap)"
```

Y lanzar el servidor con:

```bash
./nmap-atlas --nmap-privileged` 
```

gowitness se busca en el home de `SUDO_USER`; también puedes especificar la ruta con `--gowitness-command <ruta>`.

## Funcionalidades

- **Escaneo**: perfiles rápido, hosts, descubrimiento profundo, servicios y completo, además de comando personalizado validado. Progreso real con IPs aproximadas y cancelación.
- **Visualización**: rejilla, árbol, lista colapsable por subred y capturas, con filtros por puerto, servicio, sistema operativo y hostname.
- **Capturas**: `gowitness` v3 sobre los servicios HTTP detectados; solo se guardan respuestas 200–399.
- **Gestión**: renombrar, borrar e importar escaneos desde XML; notas por host; tema e idioma persistentes en SQLite.

