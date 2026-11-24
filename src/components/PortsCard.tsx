import { X } from 'lucide-react';
import { hostLabel } from '../parser/nmapXml';
import { useI18n } from '../i18n/I18nProvider';
import HostDetails from './HostDetails';
import PortRows, { portText } from './PortRows';
import type { NmapHost } from '../types';

interface Props {
  hosts: NmapHost[];
  query: string;
  openAll?: boolean;
  onClose: () => void;
  onNotesChange: (hostKey: string, notes: string) => void;
  onNotesCommit: (hostKey: string) => void;
}

export default function PortsCard({
  hosts,
  query,
  openAll = false,
  onClose,
  onNotesChange,
  onNotesCommit,
}: Props) {
  const { t, formatNumber } = useI18n();
  const q = query.trim().toLowerCase();
  const detailsOpen = openAll || hosts.length === 1;
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
              open={detailsOpen}
              openSections={detailsOpen}
              portsContent={<PortRows host={host} query={query} scriptsOpen={detailsOpen} />}
              onNotesChange={(notes) => onNotesChange(host.key, notes)}
              onNotesCommit={() => onNotesCommit(host.key)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
