import type { RefObject } from 'react';
import {
  ChevronsDownUp,
  ChevronsUpDown,
  GitBranch,
  Home,
  LayoutGrid,
  Map,
  Maximize2,
  Network,
  Search,
  Server,
  X,
} from 'lucide-react';
import type { NmapScan } from '../types';
import type { GraphModel } from '../graph/model';
import type { LayoutMode } from '../graph/layouts';

interface Props {
  scan: NmapScan;
  model: GraphModel;
  query: string;
  matchCount: number;
  onlyWithPorts: boolean;
  searchRef: RefObject<HTMLInputElement>;
  onQuery: (value: string) => void;
  onOnlyWithPorts: (value: boolean) => void;
  layoutMode: LayoutMode;
  onLayoutMode: (mode: LayoutMode) => void;
  onHome: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onFit: () => void;
  showMiniMap: boolean;
  onToggleMiniMap: () => void;
  onFocusMatch: () => void;
}

export default function Toolbar({
  scan,
  model,
  query,
  matchCount,
  onlyWithPorts,
  searchRef,
  onQuery,
  onOnlyWithPorts,
  layoutMode,
  onLayoutMode,
  onHome,
  onExpandAll,
  onCollapseAll,
  onFit,
  showMiniMap,
  onToggleMiniMap,
  onFocusMatch,
}: Props) {
  return (
    <div className="toolbar">
      <div className="toolbar-stats">
        <div className="stat"><Server size={15} /><strong>{scan.hosts.length}</strong><span>hosts</span></div>
        <div className="stat"><Network size={15} /><strong>{model.openPorts}</strong><span>abiertos</span></div>
        <div className="stat"><span className="stat-glyph">◇</span><strong>{model.subnets.length}</strong><span>subredes</span></div>
      </div>

      <div className="toolbar-actions">
        <button className="btn-home" onClick={onHome} title="Volver al origen y cerrar la ficha de puertos">
          <Home size={15} /> Inicio
        </button>

        <div className="search-box">
          <Search size={16} />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') onFocusMatch(); }}
            placeholder="Buscar IP, host, servicio…  ( / )"
            aria-label="Buscar en el grafo"
          />
          {query && <span className="match-count">{matchCount}</span>}
          {query && (
            <button className="clear-search" onClick={() => onQuery('')} title="Limpiar búsqueda">
              <X size={14} />
            </button>
          )}
        </div>

        <button
          className={`chip-toggle ${onlyWithPorts ? 'active' : ''}`}
          onClick={() => onOnlyWithPorts(!onlyWithPorts)}
          title="Mostrar únicamente hosts con puertos abiertos"
        >
          Solo con abiertos
        </button>
        <div className="toolbar-divider" />
        <div className="layout-switch" role="group" aria-label="Distribución del grafo">
          <button
            className={layoutMode === 'grid' ? 'active' : ''}
            onClick={() => onLayoutMode('grid')}
            title="Vista de cuadrícula por subred"
          ><LayoutGrid size={14} /><span>Rejilla</span></button>
          <button
            className={layoutMode === 'hierarchy' ? 'active' : ''}
            onClick={() => onLayoutMode('hierarchy')}
            title="Vista jerárquica clásica"
          ><GitBranch size={14} /><span>Árbol</span></button>
        </div>

        <div className="toolbar-divider" />
        <button className="icon-button" onClick={onExpandAll} title="Ver todos los puertos">
          <ChevronsUpDown size={16} />
        </button>
        <button className="icon-button" onClick={onCollapseAll} title="Cerrar ficha de puertos">
          <ChevronsDownUp size={16} />
        </button>
        <button className="icon-button" onClick={onFit} title="Ajustar vista">
          <Maximize2 size={16} />
        </button>
        <button
          className={`icon-button ${showMiniMap ? 'active' : ''}`}
          onClick={onToggleMiniMap}
          title={showMiniMap ? 'Ocultar minimapa' : 'Mostrar minimapa'}
          aria-pressed={showMiniMap}
        >
          <Map size={16} />
        </button>
      </div>
    </div>
  );
}
