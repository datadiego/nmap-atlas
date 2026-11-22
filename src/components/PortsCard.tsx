import { X } from 'lucide-react';
import { stateColor } from '../graph/model';
import { hostLabel } from '../parser/nmapXml';
import type { NmapHost, NmapPort } from '../types';

interface Props {
  hosts: NmapHost[];
  query: string;
  onClose: () => void;
}

const stateLabels: Record<string, string> = {
  open: 'abierto',
  closed: 'cerrado',
  filtered: 'filtrado',
  unfiltered: 'sin filtrar',
  'open|filtered': 'abierto|filtrado',
  'closed|filtered': 'cerrado|filtrado',
  unknown: 'desconocido',
};

function portText(port: NmapPort): string {
  const service = port.service;
  return [
    `${port.portId}/${port.protocol}`,
    port.state,
    port.reason,
    service?.name,
    service?.product,
    service?.version,
    ...(service?.cpe ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export default function PortsCard({ hosts, query, onClose }: Props) {
  const q = query.trim().toLowerCase();
  const total = hosts.reduce((sum, host) => sum + host.ports.length, 0);
  const open = hosts.reduce((sum, host) => sum + host.ports.filter((port) => port.state === 'open').length, 0);
  const matches = q ? hosts.reduce((sum, host) => sum + host.ports.filter((p) => portText(p).includes(q)).length, 0) : total;

  return (
    <div className="ports-card">
      <div className="ports-card-head">
        <div>
          <span className="ports-card-kicker">
            {hosts.length > 1 ? 'Todos los hosts' : hosts[0] ? hostLabel(hosts[0]) : 'Puertos'}
          </span>
          <h3>
            {total} {total === 1 ? 'puerto' : 'puertos'}
            {open > 0 && <span> · {open} abiertos</span>}
            {q && <span> · {matches} coincidencias</span>}
          </h3>
        </div>
        <button className="ports-card-close" onClick={onClose} title="Cerrar ficha de puertos">
          <X size={15} />
        </button>
      </div>

      <div className="ports-card-scroll">
        {total === 0 && (
          <p className="ports-card-empty">Este host no tiene puertos enumerados en el XML.</p>
        )}

        {hosts.map((host) => (
          <div className="ports-card-host" key={host.key}>
            {hosts.length > 1 && <div className="ports-card-hostname">{hostLabel(host)}</div>}

            {[...host.ports]
              .sort((a, b) => Number(a.portId) - Number(b.portId))
              .map((port) => {
                const service = port.service;
                const product = [service?.product, service?.version].filter(Boolean).join(' ');
                const hit = Boolean(q && portText(port).includes(q));
                const cpe = service?.cpe[0];
                return (
                  <div className={`port-row ${hit ? 'match' : ''}`} key={`${port.protocol}:${port.portId}`}>
                    <span className="port-number">{port.portId}/{port.protocol}</span>
                    <span className="port-state" style={{ color: stateColor(port.state) }}>
                      {stateLabels[port.state] ?? port.state}
                    </span>
                    <div className="port-main">
                      <strong>{service?.name || 'desconocido'}</strong>
                      <span>{product || port.reason || '—'}</span>
                    </div>
                    {cpe && (
                      <a
                        className="port-cpe"
                        href={`https://nvd.nist.gov/vuln/search/results?query=${encodeURIComponent(cpe)}&search_type=all`}
                        target="_blank"
                        rel="noreferrer"
                        title={cpe}
                      >
                        CPE
                      </a>
                    )}
                  </div>
                );
              })}

            {host.extraPorts.map((group, index) => (
              <div className="ports-card-extra" key={`${group.state}:${index}`}>
                + {group.count} puertos {group.state}
                <span>{group.reasons.map((reason) => `${reason.count} ${reason.reason}`).join(' · ')}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
