import type { NmapHost, NmapScan } from '../types';
import type { SubnetInfo } from './model';
import { tGlobal, type TFunction } from '../i18n';
import { subnetOf } from '../parser/nmapXml';

export const countOpenPorts = (host: NmapHost): number =>
  host.ports.reduce((total, port) => total + (port.state === 'open' ? 1 : 0), 0);

/**
 * Agrupa hosts por subred sin construir nodos ni aristas. Es la única
 * información que necesita la vista de lista, mucho más barata que el grafo.
 */
export function buildSubnetGroups(scan: NmapScan, t: TFunction = tGlobal): SubnetInfo[] {
  const groups = new Map<string, SubnetInfo>();

  scan.hosts.forEach((host) => {
    const id = `subnet:${subnetOf(host, t)}`;
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        name: id.slice('subnet:'.length),
        hosts: [],
        openPorts: 0,
        upHosts: 0,
      };
      groups.set(id, group);
    }
    group.hosts.push(host);
    group.openPorts += countOpenPorts(host);
    if (host.state === 'up') group.upHosts += 1;
  });

  return Array.from(groups.values());
}
