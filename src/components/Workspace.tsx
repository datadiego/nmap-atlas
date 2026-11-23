import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import type { NmapHost, NmapScan } from '../types';
import { useI18n } from '../i18n/I18nProvider';
import { GraphActionsContext } from '../graph/actions';
import { useTheme } from '../theme';
import { layoutGraph, type LayoutMode } from '../graph/layouts';
import { buildSubnetGroups, countOpenPorts } from '../graph/subnets';
import {
  NODE_SIZES,
  applyView,
  buildGraph,
  stateColor,
  type EntityNode,
} from '../graph/model';
import { hostLabel } from '../parser/nmapXml';
import { loadViewMode, saveViewMode, type ViewMode } from '../viewMode';
import EntityNodeView from './EntityNodeView';
import HostList, { buildHostSearchIndex, filterHostList } from './HostList';
import PortsCard from './PortsCard';
import Toolbar from './Toolbar';

const nodeTypes: NodeTypes = { entity: EntityNodeView };

interface Props {
  scan: NmapScan;
  onNotesChange: (hostKey: string, notes: string) => void;
  onNotesCommit: (hostKey: string) => void;
}

function toggleInSet(source: Set<string>, value: string): Set<string> {
  const next = new Set(source);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function WorkspaceInner({ scan, onNotesChange, onNotesCommit }: Props) {
  const { t } = useI18n();
  const theme = useTheme();

  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  const isGraph = viewMode !== 'list';
  const layoutMode: LayoutMode = viewMode === 'grid' ? 'grid' : 'hierarchy';
  // La vista de lista no construye nodos, aristas ni layouts: solo HTML.
  const model = useMemo(() => (isGraph ? buildGraph(scan, t) : null), [isGraph, scan, t]);
  const subnetGroups = useMemo(() => buildSubnetGroups(scan, t), [scan, t]);
  const openPorts = useMemo(
    () => scan.hosts.reduce((total, host) => total + countOpenPorts(host), 0),
    [scan.hosts],
  );

  // En escaneos grandes con pocos hosts interesantes, empezamos filtrados
  // para que el mapa sea legible sin perder el resto (se puede desactivar).
  const initialOnlyWithPorts =
    openPorts > 0 && openPorts / Math.max(scan.hosts.length, 1) <= 0.25;
  const [baseNodes, setBaseNodes] = useState<EntityNode[]>(() =>
    model ? layoutGraph(model, layoutMode, { onlyWithPorts: initialOnlyWithPorts }) : [],
  );

  // Si no hay nodos (primer render en grafo) calculamos el layout. Con nodos
  // ya presentes solo refrescamos datos (por ejemplo, notas) para conservar
  // las posiciones arrastradas por el usuario.
  useEffect(() => {
    if (!model) return;
    setBaseNodes((current) => {
      if (current.length === 0) {
        return layoutGraph(model, layoutMode, { onlyWithPorts });
      }
      const freshById = new Map(model.nodes.map((node) => [node.id, node]));
      return current.map((node) => {
        const fresh = freshById.get(node.id);
        if (!fresh) return node;
        return { ...node, data: { ...fresh.data, dimmed: node.data.dimmed } };
      });
    });
    // El layout solo se recalcula cuando cambia el modelo, no al buscar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  // Los puertos no son nodos: se abren en una ficha flotante dentro del mapa.
  const [activeHost, setActiveHost] = useState<string | null>(null);
  const [showAllPorts, setShowAllPorts] = useState(false);
  const [query, setQuery] = useState('');
  const [onlyWithPorts, setOnlyWithPorts] = useState(initialOnlyWithPorts);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [expandedSubnets, setExpandedSubnets] = useState<Set<string>>(() => new Set());
  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(() => new Set());
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { getNode, setCenter, fitView } = useReactFlow();

  const view = useMemo(
    () => (model ? applyView(model, { query, onlyWithPorts }, baseNodes) : null),
    [model, baseNodes, query, onlyWithPorts],
  );
  const searchIndex = useMemo(() => buildHostSearchIndex(scan.hosts), [scan.hosts]);
  const listView = useMemo(
    () => filterHostList(searchIndex, query, onlyWithPorts),
    [searchIndex, query, onlyWithPorts],
  );
  const matchCount = viewMode === 'list' ? listView.matchCount : (view?.matchCount ?? 0);

  const onNodesChange = useCallback((changes: NodeChange<EntityNode>[]) => {
    setBaseNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const toggleHost = useCallback(
    (hostId: string) => {
      setShowAllPorts(false);
      setActiveHost((current) => (current === hostId ? null : hostId));
    },
    [],
  );

  const actions = useMemo(
    () => ({ activeHost, childrenByHost: model?.childrenByHost ?? {}, toggleHost }),
    [activeHost, model, toggleHost],
  );

  const fit = useCallback(() => {
    void fitView({ padding: 0.16, duration: 400 });
  }, [fitView]);

  const centerOn = useCallback(
    (id: string, zoom: number) => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const node = getNode(id) as EntityNode | undefined;
          if (!node) return;
          const size = NODE_SIZES[node.data.kind];
          setCenter(node.position.x + size.width / 2, node.position.y + size.height / 2, {
            zoom,
            duration: 500,
          });
        }),
      );
    },
    [getNode, setCenter],
  );

  const closeCard = useCallback(() => {
    setActiveHost(null);
    setShowAllPorts(false);
  }, []);

  const goHome = useCallback(() => {
    closeCard();
    if (viewMode === 'list') {
      setQuery('');
      setOnlyWithPorts(false);
      setExpandedSubnets(new Set());
      setExpandedHosts(new Set());
    } else {
      fit();
    }
  }, [closeCard, fit, viewMode]);

  const changeLayout = useCallback(
    (mode: ViewMode) => {
      if (mode === viewMode) return;
      setViewMode(mode);
      saveViewMode(mode);
      closeCard();

      if (mode === 'list') {
        // Al volver al grafo se recalcula el layout con la opción elegida.
        setBaseNodes([]);
        return;
      }

      if (model) setBaseNodes(layoutGraph(model, mode, { onlyWithPorts }));
      requestAnimationFrame(() =>
        requestAnimationFrame(() => void fitView({ padding: 0.16, duration: 500 })),
      );
    },
    [viewMode, model, onlyWithPorts, closeCard, fitView],
  );

  const changeOnlyWithPorts = useCallback(
    (value: boolean) => {
      setOnlyWithPorts(value);
      if (!model) return;
      setBaseNodes(layoutGraph(model, layoutMode, { onlyWithPorts: value }));
      requestAnimationFrame(() =>
        requestAnimationFrame(() => void fitView({ padding: 0.16, duration: 450 })),
      );
    },
    [model, layoutMode, fitView],
  );

  const focusNode = useCallback(
    (id: string) => {
      if (!isGraph) return;
      const hostKey = /^(?:host|port|extra):([^:]+)/.exec(id)?.[1];
      const host = scan.hosts.find((candidate) => candidate.key === hostKey);
      if (hostKey) {
        setActiveHost(`host:${hostKey}`);
        setShowAllPorts(false);
      } else {
        closeCard();
      }
      if (onlyWithPorts && host && countOpenPorts(host) === 0) changeOnlyWithPorts(false);
      centerOn(hostKey ? `host:${hostKey}` : id, 1.05);
    },
    [isGraph, scan.hosts, onlyWithPorts, changeOnlyWithPorts, centerOn, closeCard],
  );

  const focusMatch = useCallback(() => {
    if (viewMode === 'list') {
      if (onlyWithPorts && listView.hosts.length === 0 && listView.matchCount > 0) {
        changeOnlyWithPorts(false);
        return;
      }
      const first = listView.hosts[0];
      if (!first) return;
      const subnet = subnetGroups.find((group) =>
        group.hosts.some((host) => host.key === first.key),
      );
      if (subnet) setExpandedSubnets((current) => new Set(current).add(subnet.id));
      setExpandedHosts((current) => new Set(current).add(first.key));
      setScrollTo(first.key);
      return;
    }
    const first = view?.matchedNodes[0];
    if (first) focusNode(first.id);
  }, [
    viewMode,
    onlyWithPorts,
    listView,
    subnetGroups,
    changeOnlyWithPorts,
    view,
    focusNode,
  ]);

  const clearScroll = useCallback(() => setScrollTo(null), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const typing =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape' && typing) {
        (target as HTMLInputElement).blur();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const expandAll = () => {
    if (viewMode === 'list') {
      setExpandedSubnets(new Set(subnetGroups.map((subnet) => subnet.id)));
      return;
    }
    setActiveHost(null);
    setShowAllPorts(true);
  };

  const collapseAll = () => {
    if (viewMode === 'list') {
      setExpandedSubnets(new Set());
      setExpandedHosts(new Set());
      return;
    }
    goHome();
  };

  const activeHostData = activeHost
    ? scan.hosts.find((host) => `host:${host.key}` === activeHost)
    : null;
  const activeHostLabel = showAllPorts
    ? t('workspace.allPorts')
    : activeHostData
      ? hostLabel(activeHostData, t)
      : null;
  const cardHosts: NmapHost[] =
    !isGraph || !view
      ? []
      : showAllPorts
        ? scan.hosts.filter((host) => view.nodes.some((node) => node.id === `host:${host.key}`))
        : activeHost
          ? scan.hosts.filter((host) => `host:${host.key}` === activeHost)
          : [];

  return (
    <GraphActionsContext.Provider value={actions}>
      <div className="workspace">
        <Toolbar
          hostCount={scan.hosts.length}
          openPorts={openPorts}
          subnetCount={subnetGroups.length}
          query={query}
          matchCount={matchCount}
          onlyWithPorts={onlyWithPorts}
          searchRef={searchRef}
          onQuery={setQuery}
          onOnlyWithPorts={changeOnlyWithPorts}
          layoutMode={viewMode}
          onLayoutMode={changeLayout}
          onHome={goHome}
          onExpandAll={expandAll}
          onCollapseAll={collapseAll}
          onFit={fit}
          showMiniMap={showMiniMap}
          onToggleMiniMap={() => setShowMiniMap((value) => !value)}
          onFocusMatch={focusMatch}
        />

        {viewMode === 'list' ? (
          <HostList
            hosts={listView.hosts}
            subnets={subnetGroups}
            query={query}
            matchedKeys={listView.matchedKeys}
            expandedSubnets={expandedSubnets}
            expandedHosts={expandedHosts}
            onToggleSubnet={(id) => setExpandedSubnets((current) => toggleInSet(current, id))}
            onToggleHost={(key) => setExpandedHosts((current) => toggleInSet(current, key))}
            onNotesChange={onNotesChange}
            onNotesCommit={onNotesCommit}
            scrollTo={scrollTo}
            onScrolled={clearScroll}
          />
        ) : (
          <div className="graph-area">
            <ReactFlow
              nodes={view?.nodes ?? []}
              edges={view?.edges ?? []}
              onNodesChange={onNodesChange}
              nodeTypes={nodeTypes}
              onNodeClick={(_, node) => {
                if (node.data.entity.type !== 'host') return;
                if (activeHost === node.id) {
                  closeCard();
                } else {
                  // Abrimos la ficha a la derecha sin mover el mapa: el overview
                  // sigue donde está y el host se marca como activo.
                  setShowAllPorts(false);
                  setActiveHost(node.id);
                }
              }}
              nodesConnectable={false}
              nodesDraggable
              colorMode={theme === 'light' ? 'light' : 'dark'}
              fitView
              fitViewOptions={{ padding: 0.16, maxZoom: 1 }}
              minZoom={0.03}
              maxZoom={2}
              proOptions={{ hideAttribution: false }}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--surface-2)" />
              <Controls showInteractive={false} />
              {showMiniMap && (
                <MiniMap
                  position="bottom-right"
                  pannable
                  zoomable
                  maskColor="rgba(var(--bg-rgb), 0.75)"
                  nodeColor={(node) => {
                    const data = (node as EntityNode).data;
                    if (data.dimmed) return 'var(--surface-2)';
                    switch (data.kind) {
                      case 'group': return 'transparent';
                      case 'scan': return 'var(--accent)';
                      case 'subnet': return 'var(--pink)';
                      case 'host': return 'var(--teal)';
                      case 'port': return stateColor(data.state);
                      default: return 'var(--dim)';
                    }
                  }}
                />
              )}
              {activeHostLabel && (
                <Panel position="top-left" className="breadcrumb-panel">
                  <button onClick={goHome}>{t('workspace.backToScan')}</button>
                  <span>/</span>
                  <strong>{activeHostLabel}</strong>
                </Panel>
              )}

              {cardHosts.length > 0 && (
                <Panel position="top-right" className="ports-card-panel">
                  <PortsCard
                    hosts={cardHosts}
                    query={query}
                    onClose={closeCard}
                    onNotesChange={onNotesChange}
                    onNotesCommit={onNotesCommit}
                  />
                </Panel>
              )}
            </ReactFlow>
          </div>
        )}
      </div>
    </GraphActionsContext.Provider>
  );
}

export default function Workspace(props: Props) {
  return (
    <ReactFlowProvider>
      <WorkspaceInner {...props} />
    </ReactFlowProvider>
  );
}
