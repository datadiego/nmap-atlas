import type { RefObject } from 'react';
import {
  ChevronsDownUp,
  ChevronsUpDown,
  GitBranch,
  Home,
  LayoutGrid,
  List,
  Map,
  Maximize2,
  Network,
  Search,
  Server,
  X,
} from 'lucide-react';
import type { ViewMode } from '../viewMode';
import { useI18n } from '../i18n/I18nProvider';

interface Props {
  hostCount: number;
  openPorts: number;
  subnetCount: number;
  layoutMode: ViewMode;
  onLayoutMode: (mode: ViewMode) => void;
  query: string;
  matchCount: number;
  onlyWithPorts: boolean;
  searchRef: RefObject<HTMLInputElement>;
  onQuery: (value: string) => void;
  onOnlyWithPorts: (value: boolean) => void;
  onHome: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onFit: () => void;
  showMiniMap: boolean;
  onToggleMiniMap: () => void;
  onFocusMatch: () => void;
}

export default function Toolbar({
  hostCount,
  openPorts,
  subnetCount,
  layoutMode,
  onLayoutMode,
  query,
  matchCount,
  onlyWithPorts,
  searchRef,
  onQuery,
  onOnlyWithPorts,
  onHome,
  onExpandAll,
  onCollapseAll,
  onFit,
  showMiniMap,
  onToggleMiniMap,
  onFocusMatch,
}: Props) {
  const { t, formatNumber } = useI18n();
  const isList = layoutMode === 'list';

  return (
    <div className="toolbar">
      <div className="toolbar-stats">
        <div className="stat"><Server size={15} /><strong>{formatNumber(hostCount)}</strong><span>hosts</span></div>
        <div className="stat"><Network size={15} /><strong>{formatNumber(openPorts)}</strong><span>{t('toolbar.open')}</span></div>
        <div className="stat"><span className="stat-glyph">◇</span><strong>{formatNumber(subnetCount)}</strong><span>{t('toolbar.subnets')}</span></div>
      </div>

      <div className="toolbar-actions">
        <button
          className="btn-home"
          onClick={onHome}
          title={isList ? t('toolbar.homeListTitle') : t('toolbar.homeTitle')}
        >
          <Home size={15} /> {t('toolbar.home')}
        </button>

        <div className="search-box">
          <Search size={16} />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') onFocusMatch(); }}
            placeholder={t('toolbar.searchPlaceholder')}
            aria-label={t('toolbar.searchAria')}
          />
          {query && <span className="match-count">{matchCount}</span>}
          {query && (
            <button className="clear-search" onClick={() => onQuery('')} title={t('toolbar.clearSearch')}>
              <X size={14} />
            </button>
          )}
        </div>

        <button
          className={`chip-toggle ${onlyWithPorts ? 'active' : ''}`}
          onClick={() => onOnlyWithPorts(!onlyWithPorts)}
          title={t('toolbar.onlyOpenTitle')}
        >
          {t('toolbar.onlyOpen')}
        </button>
        <div className="toolbar-divider" />

        <div className="layout-switch" role="group" aria-label={t('toolbar.viewMode')}>
          <button
            className={layoutMode === 'grid' ? 'active' : ''}
            onClick={() => onLayoutMode('grid')}
            title={t('toolbar.gridTitle')}
            aria-pressed={layoutMode === 'grid'}
          ><LayoutGrid size={14} /><span>{t('toolbar.grid')}</span></button>
          <button
            className={layoutMode === 'hierarchy' ? 'active' : ''}
            onClick={() => onLayoutMode('hierarchy')}
            title={t('toolbar.treeTitle')}
            aria-pressed={layoutMode === 'hierarchy'}
          ><GitBranch size={14} /><span>{t('toolbar.tree')}</span></button>
          <button
            className={isList ? 'active' : ''}
            onClick={() => onLayoutMode('list')}
            title={t('toolbar.listTitle')}
            aria-pressed={isList}
          ><List size={14} /><span>{t('toolbar.list')}</span></button>
        </div>

        <button
          className="icon-button"
          onClick={onExpandAll}
          title={isList ? t('toolbar.expandList') : t('toolbar.expandAll')}
        >
          <ChevronsUpDown size={16} />
        </button>
        <button
          className="icon-button"
          onClick={onCollapseAll}
          title={isList ? t('toolbar.collapseList') : t('toolbar.collapseAll')}
        >
          <ChevronsDownUp size={16} />
        </button>

        {!isList && (
          <>
            <button className="icon-button" onClick={onFit} title={t('toolbar.fit')}>
              <Maximize2 size={16} />
            </button>
            <button
              className={`icon-button ${showMiniMap ? 'active' : ''}`}
              onClick={onToggleMiniMap}
              title={showMiniMap ? t('toolbar.hideMiniMap') : t('toolbar.showMiniMap')}
              aria-pressed={showMiniMap}
            >
              <Map size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
