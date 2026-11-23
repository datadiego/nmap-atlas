import { X } from 'lucide-react';
import { stateColor } from '../graph/model';
import { hostLabel } from '../parser/nmapXml';
import { useI18n } from '../i18n/I18nProvider';
import HostDetails from './HostDetails';
import type { TranslationKey } from '../i18n';
import type { NmapHost, NmapPort } from '../types';

interface Props {
  hosts: NmapHost[];
  query: string;
  onClose: () => void;
  onNotesChange: (hostKey: string, notes: string) => void;
}

const stateKeys: Record<string, TranslationKey> = {
  open: 'state.open',
  closed: 'state.closed',
  filtered: 'state.filtered',
  unfiltered: 'state.unfiltered',
  'open|filtered': 'state.openFiltered',
  'closed|filtered': 'state.closedFiltered',
  unknown: 'state.unknown',
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

export default function PortsCard({ hosts, query, onClose, onNotesChange }: Props) {
  const { t, formatNumber } = useI18n();
  const q = query.trim().toLowerCase();
  const total = hosts.reduce((sum, host) => sum + host.ports.length, 0);
  const open = hosts.reduce((sum, host) => sum + host.ports.filter((port) => port.state === 'open').length, 0);
  const matches = q ? hosts.reduce((sum, host) => sum + host.ports.filter((p) => portText(p).includes(q)).length, 0) : total;

  return (
    <div className="ports-card">
      <div className="ports-card-head">
        <div>
          <span className="ports-card-kicker">
            {hosts.length > 1
              ? t('ports.allHosts')
              : hosts[0]
                ? hostLabel(hosts[0], t)
                : t('ports.title')}
          </span>
          <h3>
            {formatNumber(total)} {total === 1 ? t('ports.portOne') : t('ports.portMany')}
            {open > 0 && <span> · {t('ports.open', { count: formatNumber(open) })}</span>}
            {q && <span> · {t('ports.matches', { count: formatNumber(matches) })}</span>}
          </h3>
        </div>
        <button className="ports-card-close" onClick={onClose} title={t('ports.close')}>
          <X size={15} />
        </button>
      </div>

      <div className="ports-card-scroll">
        {total === 0 && (
          <p className="ports-card-empty">{t('ports.empty')}</p>
        )}

        {hosts.map((host) => (
          <div className="ports-card-host" key={host.key}>
            {hosts.length > 1 && <div className="ports-card-hostname">{hostLabel(host, t)}</div>}
            <HostDetails
              host={host}
              open={hosts.length === 1}
              onNotesChange={(notes) => onNotesChange(host.key, notes)}
            />

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
                  </div>
                );
              })}

            {host.extraPorts.map((group, index) => (
              <div className="ports-card-extra" key={`${group.state}:${index}`}>
                {t('ports.extra', {
                  count: formatNumber(group.count),
                  state: stateKeys[group.state] ? t(stateKeys[group.state]) : group.state,
                })}
                <span>{group.reasons.map((reason) => `${formatNumber(reason.count)} ${reason.reason}`).join(' · ')}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
