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
import {
  NODE_SIZES,
  applyView,
  buildGraph,
  openPortCount,
  stateColor,
  type EntityNode,
} from '../graph/model';
import EntityNodeView from './EntityNodeView';
import PortsCard from './PortsCard';
import Toolbar from './Toolbar';

const nodeTypes: NodeTypes = { entity: EntityNodeView };

interface Props {
  scan: NmapScan;
}

function WorkspaceInner({ scan }: Props) {
  const { t } = useI18n();
  const theme = useTheme();
  const model = useMemo(() => buildGraph(scan, t), [scan, t]);
  // En escaneos grandes con pocos hosts interesantes, empezamos filtrados
  // para que el mapa sea legible sin perder el resto (se puede desactivar).
  const initialOnlyWithPorts =
    model.openPorts > 0 && model.openPorts / Math.max(scan.hosts.length, 1) <= 0.25;
  // El árbol jerárquico es la vista clásica y la que se muestra al abrir un escaneo.
  const initialLayout: LayoutMode = 'hierarchy';

  const [layoutMode, setLayoutMode] = useState<LayoutMode>(initialLayout);
  const [baseNodes, setBaseNodes] = useState<EntityNode[]>(() =>
    layoutGraph(model, initialLayout, { onlyWithPorts: initialOnlyWithPorts }),
  );
  // Los puertos no son nodos: se abren en una ficha flotante dentro del mapa.
  const [activeHost, setActiveHost] = useState<string | null>(null);
  const [showAllPorts, setShowAllPorts] = useState(false);
  const [query, setQuery] = useState('');
  const [onlyWithPorts, setOnlyWithPorts] = useState(initialOnlyWithPorts);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { getNode, setCenter, fitView } = useReactFlow();

  const view = useMemo(
    () => applyView(model, { query, onlyWithPorts }, baseNodes),
    [model, baseNodes, query, onlyWithPorts],
  );

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
    () => ({ activeHost, childrenByHost: model.childrenByHost, toggleHost }),
    [activeHost, model.childrenByHost, toggleHost],
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
    fit();
  }, [closeCard, fit]);

  const changeLayout = useCallback(
    (mode: LayoutMode) => {
      setLayoutMode(mode);
      setBaseNodes(layoutGraph(model, mode, { onlyWithPorts }));
      requestAnimationFrame(() =>
        requestAnimationFrame(() => void fitView({ padding: 0.16, duration: 500 })),
      );
    },
    [model, fitView, onlyWithPorts],
  );

  const changeOnlyWithPorts = useCallback(
    (value: boolean) => {
      setOnlyWithPorts(value);
      setBaseNodes(layoutGraph(model, layoutMode, { onlyWithPorts: value }));
      requestAnimationFrame(() =>
        requestAnimationFrame(() => void fitView({ padding: 0.16, duration: 450 })),
      );
    },
    [model, layoutMode, fitView],
  );

  const focusNode = useCallback(
    (id: string) => {
      const hostKey = /^(?:host|port|extra):([^:]+)/.exec(id)?.[1];
      const host = scan.hosts.find((candidate) => candidate.key === hostKey);
      if (hostKey) {
        setActiveHost(`host:${hostKey}`);
        setShowAllPorts(false);
      } else {
        closeCard();
      }
      if (onlyWithPorts && host && openPortCount(host) === 0) changeOnlyWithPorts(false);
      centerOn(hostKey ? `host:${hostKey}` : id, 1.05);
    },
    [scan.hosts, onlyWithPorts, changeOnlyWithPorts, centerOn, closeCard],
  );

  const focusMatch = useCallback(() => {
    const first = view.matchedNodes[0];
    if (first) focusNode(first.id);
  }, [view.matchedNodes, focusNode]);

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
    setActiveHost(null);
    setShowAllPorts(true);
  };
  const collapseAll = goHome;
  const activeHostLabel = showAllPorts
    ? t('workspace.allPorts')
    : activeHost
      ? (model.nodes.find((node) => node.id === activeHost)?.data.label ?? activeHost)
      : null;
  const cardHosts: NmapHost[] = showAllPorts
    ? scan.hosts.filter((host) => view.nodes.some((node) => node.id === `host:${host.key}`))
    : activeHost
      ? scan.hosts.filter((host) => `host:${host.key}` === activeHost)
      : [];

  return (
    <GraphActionsContext.Provider value={actions}>
      <div className="workspace">
        <Toolbar
          scan={scan}
          model={model}
          query={query}
          matchCount={view.matchCount}
          onlyWithPorts={onlyWithPorts}
          searchRef={searchRef}
          onQuery={setQuery}
          onOnlyWithPorts={changeOnlyWithPorts}
          layoutMode={layoutMode}
          onLayoutMode={changeLayout}
          onHome={goHome}
          onExpandAll={expandAll}
          onCollapseAll={collapseAll}
          onFit={fit}
          showMiniMap={showMiniMap}
          onToggleMiniMap={() => setShowMiniMap((value) => !value)}
          onFocusMatch={focusMatch}
        />

        <div className="graph-area">
          <ReactFlow
            nodes={view.nodes}
            edges={view.edges}
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
                <PortsCard hosts={cardHosts} query={query} onClose={closeCard} />
              </Panel>
            )}
          </ReactFlow>
        </div>
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
