import { stateColor } from '../graph/model';
import { useI18n } from '../i18n/I18nProvider';
import PortScripts from './PortScripts';
import { stateKeys } from './portState';
import type { NmapHost, NmapPort } from '../types';

export function portText(port: NmapPort): string {
  const service = port.service;
  return [
    `${port.portId}/${port.protocol}`,
    port.state,
    port.reason,
    service?.name,
    service?.product,
    service?.version,
    ...(service?.cpe ?? []),
    ...port.scripts.flatMap((script) => [script.id, script.output]),
    ...(service?.scripts ?? []).flatMap((script) => [script.id, script.output]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

interface Props {
  host: NmapHost;
  query?: string;
  scriptsOpen?: boolean;
}

/** Filas de puertos y puertos extra, reutilizadas en grafo y modal de capturas. */
export default function PortRows({ host, query = '', scriptsOpen = false }: Props) {
  const { t, formatNumber } = useI18n();
  const q = query.trim().toLowerCase();

  return (
    <>
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
                {stateKeys[port.state] ? t(stateKeys[port.state]) : port.state}
              </span>
              <div className="port-main">
                <strong>{service?.name || t('ports.unknown')}</strong>
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
              <PortScripts port={port} open={scriptsOpen} />
            </div>
          );
        })}

      {host.extraPorts.map((group, index) => (
        <div className="ports-card-extra" key={`${group.state}:${index}`}>
          {t('ports.extra', {
            count: formatNumber(group.count),
            state: stateKeys[group.state] ? t(stateKeys[group.state]) : group.state,
          })}
          <span>{group.reasons.map((reason) => `${reason.count} ${reason.reason}`).join(' · ')}</span>
        </div>
      ))}
    </>
  );
}
