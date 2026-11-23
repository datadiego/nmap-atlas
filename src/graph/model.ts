import type { Edge, Node } from '@xyflow/react';
import type { ExtraPortGroup, NmapHost, NmapPort, NmapScan } from '../types';
import { tGlobal, type TFunction } from '../i18n';
import { hostLabel, subnetOf } from '../parser/nmapXml';

export type NodeKind = 'scan' | 'subnet' | 'host' | 'port' | 'extra' | 'group';

export interface SubnetInfo {
  id: string;
  name: string;
  hosts: NmapHost[];
  openPorts: number;
  upHosts: number;
}

export type NodeEntity =
  | { type: 'scan'; scan: NmapScan }
  | { type: 'subnet'; subnet: SubnetInfo }
  | { type: 'host'; host: NmapHost }
  | { type: 'port'; host: NmapHost; port: NmapPort }
  | { type: 'extra'; host: NmapHost; group: ExtraPortGroup }
  | {
      type: 'group';
      tone: 'origin' | 'hosts';
      width: number;
      height: number;
    };

export interface GraphNodeData extends Record<string, unknown> {
  kind: NodeKind;
  id: string;
  label: string;
  subtitle: string;
  badge: string;
  state: string;
  detail: string;
  notes: string;
  dimmed: boolean;
  entity: NodeEntity;
}

export type EntityNode = Node<GraphNodeData, 'entity'>;

export interface GraphModel {
  nodes: EntityNode[];
  edges: Edge[];
  childrenByHost: Record<string, string[]>;
  subnets: SubnetInfo[];
  openPorts: number;
}

export const NODE_SIZES: Record<NodeKind, { width: number; height: number }> = {
  scan: { width: 250, height: 104 },
  subnet: { width: 220, height: 86 },
  host: { width: 234, height: 128 },
  port: { width: 236, height: 82 },
  extra: { width: 236, height: 76 },
  group: { width: 1, height: 1 },
};

const edgeColor: Record<string, string> = {
  open: 'var(--accent)',
  filtered: 'var(--amber)',
  closed: 'var(--dim)',
  unfiltered: 'var(--amber)',
  'open|filtered': 'var(--amber)',
};

export function stateColor(state: string): string {
  return edgeColor[state] ?? 'var(--dim)';
}

export function openPortCount(host: NmapHost): number {
  return host.ports.filter((port) => port.state === 'open').length;
}

function makeNode(
  kind: NodeKind,
  id: string,
  label: string,
  subtitle: string,
  badge: string,
  state: string,
  detail: string,
  entity: NodeEntity,
  notes = '',
): EntityNode {
  return {
    id,
    type: 'entity',
    position: { x: 0, y: 0 },
    data: { kind, id, label, subtitle, badge, state, detail, notes, dimmed: false, entity },
  };
}

function makeEdge(source: string, target: string, state = ''): Edge {
  const color = state ? stateColor(state) : 'var(--surface-3)';
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
    animated: state === 'open',
    style: { stroke: color, strokeWidth: state === 'open' ? 1.8 : 1.2 },
  };
}

/** Construye el grafo completo (con posiciones) a partir del escaneo parseado. */
export function buildGraph(scan: NmapScan, t: TFunction = tGlobal): GraphModel {
  const nodes: EntityNode[] = [];
  const edges: Edge[] = [];
  const childrenByHost: Record<string, string[]> = {};

  const subnets = new Map<string, SubnetInfo>();
  scan.hosts.forEach((host) => {
    const subnetId = `subnet:${subnetOf(host, t)}`;
    if (!subnets.has(subnetId)) {
      subnets.set(subnetId, {
        id: subnetId,
        name: subnetId.replace('subnet:', ''),
        hosts: [],
        openPorts: 0,
        upHosts: 0,
      });
    }
    const subnet = subnets.get(subnetId)!;
    subnet.hosts.push(host);
    subnet.openPorts += openPortCount(host);
    if (host.state === 'up') subnet.upHosts += 1;
  });

  const scanNode = makeNode(
    'scan',
    'scan',
    t('graph.nmapScan'),
    scan.args || `nmap ${scan.startstr}`,
    t('app.hosts', { count: scan.hosts.length }),
    scan.runStats ? 'ok' : '',
    `nmap v${scan.version} · ${scan.startstr}`,
    { type: 'scan', scan },
  );
  nodes.push(scanNode);

  subnets.forEach((subnet) => {
    nodes.push(
      makeNode(
        'subnet',
        subnet.id,
        subnet.name,
        `${t('app.hosts', { count: subnet.hosts.length })} · ${t('graph.active', { count: subnet.upHosts })}`,
        t('graph.open', { count: subnet.openPorts }),
        subnet.openPorts > 0 ? 'open' : '',
        t('graph.subnetDetected'),
        { type: 'subnet', subnet },
      ),
    );
    edges.push(makeEdge('scan', subnet.id, subnet.openPorts > 0 ? 'open' : ''));
  });

  scan.hosts.forEach((host) => {
    const hostId = `host:${host.key}`;
    const ip = host.addresses.find((a) => a.type === 'ipv4' || a.type === 'ipv6')?.addr ?? '';
    const open = openPortCount(host);
    const osName = host.os[0]?.name || host.osClasses[0]?.osFamily || '';
    const label = hostLabel(host, t);
    nodes.push(
      makeNode(
        'host',
        hostId,
        label,
        [ip === label ? '' : ip, osName].filter(Boolean).join(' · ') || host.state,
        open > 0
          ? t('graph.open', { count: open })
          : host.ports.length
            ? t('graph.ports', { count: host.ports.length })
            : t('graph.noPorts'),
        host.state === 'up' ? (open > 0 ? 'open' : 'up') : 'down',
        [host.reason ? t('graph.reason', { reason: host.reason }) : '', host.osClasses.flatMap((osClass) => osClass.cpe).join(' ')]
          .filter(Boolean)
          .join(' · '),
        { type: 'host', host },
        host.notes,
      ),
    );
    const subnetId = `subnet:${subnetOf(host, t)}`;
    edges.push(makeEdge(subnetId, hostId, open > 0 ? 'open' : ''));

    childrenByHost[hostId] = [];
    host.ports.forEach((port) => {
      const portId = `port:${host.key}:${port.protocol}:${port.portId}`;
      const service = port.service;
      const serviceName = service?.name || t('graph.unknown');
      const product = [service?.product, service?.version].filter(Boolean).join(' ');
      nodes.push(
        makeNode(
          'port',
          portId,
          `${port.portId}/${port.protocol}`,
          product ? `${serviceName} · ${product}` : serviceName,
          port.state,
          port.state,
          [port.reason ? t('graph.reason', { reason: port.reason }) : '', service?.cpe.join(' ')]
            .filter(Boolean)
            .join(' · '),
          { type: 'port', host, port },
        ),
      );
      edges.push(makeEdge(hostId, portId, port.state));
      childrenByHost[hostId].push(portId);
    });

    host.extraPorts.forEach((group, index) => {
      const extraId = `extra:${host.key}:${index}`;
      nodes.push(
        makeNode(
          'extra',
          extraId,
          `${t('graph.ports', { count: group.count })} ${group.state}`,
          group.reasons.map((reason) => `${reason.count} ${reason.reason}`).join(' · '),
          t('graph.summary'),
          group.state,
          t('graph.extraDetail'),
          { type: 'extra', host, group },
        ),
      );
      edges.push(makeEdge(hostId, extraId, group.state));
      childrenByHost[hostId].push(extraId);
    });
  });

  // Las posiciones las asigna el módulo de layouts según el modo elegido.
  return {
    nodes,
    edges,
    childrenByHost,
    subnets: Array.from(subnets.values()),
    openPorts: scan.hosts.reduce((total, host) => total + openPortCount(host), 0),
  };
}

export interface ViewOptions {
  query: string;
  onlyWithPorts: boolean;
}

/** Deriva los nodos/aristas visibles y el resaltado de búsqueda. */
export function applyView(model: GraphModel, options: ViewOptions, sourceNodes?: EntityNode[]) {
  const query = options.query.trim().toLowerCase();
  const hidden = new Set<string>();

  // Los puertos ya no son nodos: se muestran en una ficha dentro del mapa.
  model.nodes.forEach((node) => {
    const type = node.data.entity.type;
    if (type === 'port' || type === 'extra') hidden.add(node.id);
  });

  if (options.onlyWithPorts) {
    const emptyHosts = model.nodes.filter((node) => {
      if (node.data.entity.type !== 'host') return false;
      return openPortCount(node.data.entity.host) === 0;
    });
    emptyHosts.forEach((host) => {
      hidden.add(host.id);
    });
    model.subnets.forEach((subnet) => {
      const visibleHosts = subnet.hosts.filter((host) => openPortCount(host) > 0);
      if (visibleHosts.length === 0) hidden.add(subnet.id);
    });
  }

  const matches = (node: EntityNode): boolean => {
    if (!query) return true;
    const { label, subtitle, detail, badge, notes } = node.data;
    return [label, subtitle, detail, badge, notes].some((value) =>
      value.toLowerCase().includes(query),
    );
  };

  // Buscamos también en los puertos (que viven en la ficha, no en el grafo):
  // así "https" encuentra el puerto y abre la ficha de su host.
  const matchedNodes = query ? model.nodes.filter(matches) : [];
  const matchedIds = new Set(matchedNodes.map((node) => node.id));
  const highlighted = (node: EntityNode): boolean => {
    if (!query || node.data.entity.type === 'group') return true;
    if (matchedIds.has(node.id)) return true;
    return (model.childrenByHost[node.id] ?? []).some((id) => matchedIds.has(id));
  };

  const nodes: EntityNode[] = (sourceNodes ?? model.nodes)
    .filter((node) => !hidden.has(node.id))
    .map((node) => ({ ...node, data: { ...node.data, dimmed: !highlighted(node) } }));

  const visibleIds = new Set(nodes.map((node) => node.id));
  const edges = model.edges.filter(
    (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
  );

  return { nodes, edges, matchedNodes, matchCount: matchedNodes.length };
}
