import type { NmapHost } from '../types';
import { tGlobal, type TFunction } from '../i18n';

/**
 * El XML ya se parsea en el servidor. Este módulo conserva solo los helpers
 * de presentación que necesitan las vistas para agrupar y etiquetar hosts.
 */

/** Subred /24 (o /48 en IPv6) a la que pertenece un host; se usa para agrupar nodos. */
export function subnetOf(host: NmapHost, t: TFunction = tGlobal): string {
  const ipv4 = host.addresses.find((address) => address.type === 'ipv4')?.addr;
  if (ipv4) {
    const octets = ipv4.split('.');
    if (octets.length === 4) return `${octets.slice(0, 3).join('.')}.0/24`;
  }

  const ipv6 = host.addresses.find((address) => address.type === 'ipv6')?.addr;
  if (ipv6) {
    const groups = ipv6.split(':').filter(Boolean);
    if (groups.length >= 3) return `${groups.slice(0, 3).join(':')}::/48`;
    return `${ipv6}/48`;
  }

  const mac = host.addresses.find((address) => address.type === 'mac');
  return mac ? t('parser.noIp') : t('parser.noAddress');
}

/** Nombre legible preferido para un host. */
export function hostLabel(host: NmapHost, t: TFunction = tGlobal): string {
  const named = host.hostnames.find((hostname) => hostname.name && hostname.type !== 'PTR');
  if (named) return named.name;
  if (host.hostnames[0]?.name) return host.hostnames[0].name;
  return host.addresses[0]?.addr ?? t('parser.hostFallback', { key: host.key });
}
