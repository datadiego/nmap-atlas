import { useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Boxes, ChevronDown, ChevronRight, Layers3, Network, ScanLine, Server, SquareStack } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';
import { GraphActionsContext } from '../graph/actions';
import type { EntityNode as EntityNodeType, NodeKind } from '../graph/model';

const icons: Record<NodeKind, typeof Server> = {
  scan: ScanLine,
  subnet: Network,
  host: Server,
  port: Layers3,
  extra: SquareStack,
  group: Boxes,
};

const NOTE_PREVIEW_CHARS = 72;

export default function EntityNodeView({ data, selected }: NodeProps<EntityNodeType>) {
  const { t } = useI18n();
  const { activeHost, childrenByHost, toggleHost } = useContext(GraphActionsContext);
  const Icon = icons[data.kind];
  const childCount = data.entity.type === 'host' ? (childrenByHost[data.id]?.length ?? 0) : 0;
  const expanded = activeHost === data.id;
  const note = (data.notes || '').replace(/\s+/g, ' ').trim();
  const notePreview = note.length > NOTE_PREVIEW_CHARS
    ? `${note.slice(0, NOTE_PREVIEW_CHARS).trimEnd()}…`
    : note;

  if (data.entity.type === 'group') {
    return (
      <div
        className={`graph-group group-${data.entity.tone}`}
        style={{ width: data.entity.width, height: data.entity.height }}
      >
        <span className="graph-group-title">{data.label}</span>
        <span className="graph-group-count">{data.subtitle}</span>
      </div>
    );
  }

  return (
    <div
      className={`graph-node kind-${data.kind} state-${data.state || 'none'} ${
        data.dimmed ? 'dimmed' : ''
      } ${selected ? 'selected' : ''} ${expanded ? 'active' : ''}`}
    >
      <Handle type="target" position={Position.Left} className="node-handle" />
      <span className="node-icon"><Icon size={17} /></span>
      <div className="node-content">
        <div className="node-title-row">
          <span className="node-label" title={data.label}>{data.label}</span>
          {data.badge && <span className={`node-badge state-${data.state || 'none'}`}>{data.badge}</span>}
        </div>
        <span className="node-subtitle" title={data.subtitle}>{data.subtitle}</span>
        {data.kind === 'host' && note && (
          <span className="node-notes" title={note}>{notePreview}</span>
        )}
      </div>
      {childCount > 0 && (
        <button
          className="node-toggle nodrag"
          title={expanded ? t('node.hidePorts') : t('node.showPorts')}
          onClick={(event) => { event.stopPropagation(); toggleHost(data.id); }}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {!expanded && <span>{childCount}</span>}
        </button>
      )}
      <Handle type="source" position={Position.Right} className="node-handle" />
    </div>
  );
}
