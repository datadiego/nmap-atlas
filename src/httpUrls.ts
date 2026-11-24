import type { NmapHost, NmapPort } from './types';

/** Servicios que gowitness ya trata como HTTP, más los puertos habituales. */
const HTTP_SERVICES = new Set([
  'http', 'https', 'http-alt', 'https-alt', 'http-mgmt', 'http-proxy', 'www', 'www-http',
]);
const HTTP_PORTS = new Set([80, 443, 8000, 8080, 8443, 8888]);
const HTTPS_PORTS = new Set([443, 8443]);

export interface HostHttpUrl {
  port: number;
  url: string;
}

function authority(host: NmapHost): string {
  const address = host.addresses.find((entry) => entry.addr && entry.type !== 'mac');
  const name = address?.addr || host.hostnames.find((entry) => entry.name)?.name || '';
  return name.includes(':') && !name.startsWith('[') ? `[${name}]` : name;
}

export function httpUrl(host: NmapHost, port: NmapPort): string | null {
  const service = port.service?.name?.toLowerCase().trim() ?? '';
  const number = Number(port.portId);
  if (!Number.isInteger(number) || number < 1 || number > 65535) return null;
  if (!HTTP_SERVICES.has(service) && !HTTP_PORTS.has(number)) return null;

  const target = authority(host);
  if (!target) return null;
  const scheme = service.includes('https') || HTTPS_PORTS.has(number) ? 'https' : 'http';
  return `${scheme}://${target}:${number}/`;
}

export function httpUrlsForHost(host: NmapHost): HostHttpUrl[] {
  const found: HostHttpUrl[] = [];
  const seen = new Set<string>();
  for (const port of host.ports) {
    if (port.state !== 'open') continue;
    const url = httpUrl(host, port);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    found.push({ port: Number(port.portId), url });
  }
  return found.sort((a, b) => a.port - b.port);
}
