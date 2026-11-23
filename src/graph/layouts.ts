import dagre from '@dagrejs/dagre';
import type { GraphModel, EntityNode } from './model';
import { NODE_SIZES, openPortCount } from './model';

export type LayoutMode = 'grid' | 'hierarchy';

export interface LayoutOptions {
  onlyWithPorts?: boolean;
  onlyWithScreenshots?: boolean;
  screenshotKeys?: Set<string>;
}

const visibleHosts = (hosts: GraphModel['subnets'][number]['hosts'], options: LayoutOptions) => {
  const result = hosts.filter((host) =>
    (!options.onlyWithPorts || openPortCount(host) > 0) &&
    (!options.onlyWithScreenshots || Boolean(options.screenshotKeys?.has(host.key))),
  );
  return result.sort((a, b) =>
    (a.addresses[0]?.addr ?? '').localeCompare(b.addresses[0]?.addr ?? '', undefined, {
      numeric: true,
    }),
  );
};

type Point = { x: number; y: number };

function makePlacer(model: GraphModel) {
  const kinds = new Map(model.nodes.map((node) => [node.id, node.data.kind]));
  const positions = new Map<string, Point>();

  const place = (id: string, centerX: number, centerY: number) => {
    const kind = kinds.get(id);
    if (!kind) return;
    const size = NODE_SIZES[kind];
    positions.set(id, { x: centerX - size.width / 2, y: centerY - size.height / 2 });
  };

  const nodes = () =>
    model.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));

  return { place, nodes };
}

/**
 * Cuadrícula por subred: cada host ocupa una celda, fila a fila.
 */
function gridLayout(model: GraphModel, options: LayoutOptions): EntityNode[] {
  const { place, nodes } = makePlacer(model);
  place('scan', -360, 0);

  const cellWidth = 300;
  const cellHeight = 150;
  let blockX = 0;

  model.subnets.forEach((subnet) => {
    const hosts = visibleHosts(subnet.hosts, options);
    const total = Math.max(hosts.length, 1);
    const cols = Math.max(1, Math.ceil(Math.sqrt(total)));
    place(subnet.id, blockX + 70, -120);

    hosts.forEach((host, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      place(`host:${host.key}`, blockX + 130 + col * cellWidth, 20 + row * cellHeight);
    });

    blockX += cols * cellWidth + 120;
  });

  return nodes();
}

/** Layout jerárquico clásico de dagre (izquierda a derecha). */
function hierarchyLayout(model: GraphModel, options: LayoutOptions): EntityNode[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 110, marginx: 60, marginy: 60 });
  const visibleIds = new Set<string>(['scan', ...model.subnets.map((subnet) => subnet.id)]);
  model.subnets.forEach((subnet) => {
    visibleHosts(subnet.hosts, options).forEach((host) => visibleIds.add(`host:${host.key}`));
  });
  const layoutNodes = model.nodes.filter(
    (node) => visibleIds.has(node.id) && ['scan', 'subnet', 'host'].includes(node.data.entity.type),
  );
  const layoutIds = new Set(layoutNodes.map((node) => node.id));
  layoutNodes.forEach((node) => {
    const size = NODE_SIZES[node.data.kind];
    graph.setNode(node.id, { width: size.width, height: size.height });
  });
  model.edges.forEach((edge) => {
    if (layoutIds.has(edge.source) && layoutIds.has(edge.target)) graph.setEdge(edge.source, edge.target);
  });
  dagre.layout(graph);

  return model.nodes.map((node) => {
    const position = graph.node(node.id);
    if (!position) return node;
    const size = NODE_SIZES[node.data.kind];
    return {
      ...node,
      position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
    };
  });
}

export function layoutGraph(model: GraphModel, mode: LayoutMode, options: LayoutOptions = {}): EntityNode[] {
  switch (mode) {
    case 'grid':
      return gridLayout(model, options);
    case 'hierarchy':
    default:
      return hierarchyLayout(model, options);
  }
}
