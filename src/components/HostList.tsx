import { useEffect, useMemo, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import type { NmapHost } from '../types';
import { stateColor, type SubnetInfo } from '../graph/model';
import { countOpenPorts } from '../graph/subnets';
import { hostLabel } from '../parser/nmapXml';
import { useI18n } from '../i18n/I18nProvider';
import HostDetails from './HostDetails';
import ScrollToTop from './ScrollToTop';
import { stateKeys } from './portState';

interface Props {
  hosts: NmapHost[];
  subnets: SubnetInfo[];
  query: string;
  matchedKeys: Set<string>;
  expandedSubnets: Set<string>;
  expandedHosts: Set<string>;
  onToggleSubnet: (id: string) => void;
  onToggleHost: (key: string) => void;
  onNotesChange: (hostKey: string, notes: string) => void;
  onNotesCommit: (hostKey: string) => void;
  scrollTo: string | null;
  onScrolled: () => void;
}

export interface HostListResult {
  hosts: NmapHost[];
  matchedKeys: Set<string>;
  matchCount: number;
}

export interface HostSearchEntry {
  host: NmapHost;
  text: string;
}

function hostSearchText(host: NmapHost): string {
  return [
    host.state,
    host.reason,
    host.notes,
    host.uptime,
    ...host.addresses.flatMap((address) => [address.addr, address.type, address.vendor]),
    ...host.hostnames.flatMap((hostname) => [hostname.name, hostname.type]),
    ...host.os.flatMap((match) => [match.name, match.line]),
    ...host.osClasses.flatMap((osClass) => [
      osClass.vendor,
      osClass.osFamily,
      osClass.osGen,
      osClass.type,
      ...osClass.cpe,
    ]),
    ...host.ports.flatMap((port) => [
      `${port.portId}/${port.protocol}`,
      port.state,
      port.reason,
      port.service?.name ?? '',
      port.service?.product ?? '',
      port.service?.version ?? '',
      ...(port.service?.cpe ?? []),
    ]),
    ...host.extraPorts.flatMap((group) => [
      `${group.count} ${group.state}`,
      ...group.reasons.map((reason) => `${reason.count} ${reason.reason}`),
    ]),
    ...host.scripts.flatMap((script) => [script.id, script.output]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** El texto searchable se calcula una vez por escaneo, no en cada pulsación. */
export function buildHostSearchIndex(hosts: NmapHost[]): HostSearchEntry[] {
  return hosts.map((host) => ({ host, text: hostSearchText(host) }));
}

/** Filtra la lista de hosts; comparte búsqueda con la barra superior. */
export function filterHostList(
  index: HostSearchEntry[],
  query: string,
  onlyWithPorts: boolean,
  onlyWithScreenshots = false,
  screenshotKeys: Set<string> = new Set(),
): HostListResult {
  const needle = query.trim().toLowerCase();
  const matched = needle
    ? index.filter((entry) => entry.text.includes(needle)).map((entry) => entry.host)
    : index.map((entry) => entry.host);
  const matchedKeys = new Set(matched.map((host) => host.key));
  const visible = matched.filter((host) =>
    (!onlyWithPorts || countOpenPorts(host) > 0) &&
    (!onlyWithScreenshots || screenshotKeys.has(host.key)),
  );
  return { hosts: visible, matchedKeys, matchCount: matchedKeys.size };
}

export default function HostList({
  hosts,
  subnets,
  query,
  matchedKeys,
  expandedSubnets,
  expandedHosts,
  onToggleSubnet,
  onToggleHost,
  onNotesChange,
  onNotesCommit,
  scrollTo,
  onScrolled,
}: Props) {
  const { t, formatNumber } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollTo) return;
    const row = rootRef.current?.querySelector<HTMLElement>(`[data-host-key="${scrollTo}"]`);
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    onScrolled();
  }, [scrollTo, onScrolled]);

  const highlight = Boolean(query.trim());
  const visibleKeys = useMemo(() => new Set(hosts.map((host) => host.key)), [hosts]);
  const orderedSubnets = useMemo(
    () => [...subnets].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [subnets],
  );

  return (
    <div className="host-list" ref={rootRef}>
      <div className="host-list-inner">
        {hosts.length === 0 && <p className="host-list-empty">{t('list.empty')}</p>}

        {orderedSubnets.map((subnet) => {
          const groupHosts = subnet.hosts.filter((host) => visibleKeys.has(host.key));
          if (groupHosts.length === 0) return null;

          const subnetOpen = expandedSubnets.has(subnet.id);
          const openCount = groupHosts.reduce((total, host) => total + countOpenPorts(host), 0);
          const upCount = groupHosts.filter((host) => host.state === 'up').length;

          return (
            <section className="host-list-subnet" key={subnet.id}>
              <button
                className="host-list-subnet-head"
                onClick={() => onToggleSubnet(subnet.id)}
                aria-expanded={subnetOpen}
                title={subnet.name}
              >
                <ChevronRight size={14} className={`host-list-caret ${subnetOpen ? 'open' : ''}`} />
                <strong>{subnet.name}</strong>
                <span className="host-list-subnet-meta">
                  {t('app.hosts', { count: formatNumber(groupHosts.length) })}
                  {' · '}{t('graph.active', { count: formatNumber(upCount) })}
                  {' · '}{t('graph.open', { count: formatNumber(openCount) })}
                </span>
              </button>

              {subnetOpen && groupHosts.map((host) => {
                const expanded = expandedHosts.has(host.key);
                const label = hostLabel(host, t);
                const ip = host.addresses.find(
                  (address) => address.type === 'ipv4' || address.type === 'ipv6',
                )?.addr ?? '';
                const osName = host.os[0]?.name || host.osClasses[0]?.osFamily || '';
                const subtitle =
                  [ip === label ? '' : ip, osName].filter(Boolean).join(' · ') || host.state;
                const open = countOpenPorts(host);
                const match = highlight && matchedKeys.has(host.key);
                const note = host.notes.trim();

                return (
                  <div
                    className={`host-list-item ${match ? 'match' : ''}`}
                    key={host.key}
                    data-host-key={host.key}
                  >
                    <button
                      className="host-list-row"
                      onClick={() => onToggleHost(host.key)}
                      aria-expanded={expanded}
                      title={
                        expanded
                          ? t('list.collapseHost', { name: label })
                          : t('list.expandHost', { name: label })
                      }
                    >
                      <ChevronRight size={14} className={`host-list-caret ${expanded ? 'open' : ''}`} />
                      <span className={`host-list-dot ${host.state === 'up' ? 'up' : ''}`} />
                      <span className="host-list-main">
                        <strong>{label}</strong>
                        <span>{subtitle}</span>
                      </span>
                      {note && (
                        <span className="host-list-note" title={note}>
                          {note.length > 72 ? `${note.slice(0, 72)}…` : note}
                        </span>
                      )}
                      <span
                        className="host-list-badge"
                        style={{ color: open > 0 ? stateColor('open') : 'var(--dim)' }}
                      >
                        {open > 0
                          ? t('graph.open', { count: open })
                          : host.ports.length
                            ? t('graph.ports', { count: host.ports.length })
                            : t('graph.noPorts')}
                      </span>
                    </button>

                    {expanded && (
                      <div className="host-list-detail">
                        {host.ports.length > 0 && (
                          <div className="host-list-ports">
                            {host.ports.map((port) => {
                              const service = port.service;
                              const product = [service?.product, service?.version]
                                .filter(Boolean)
                                .join(' ');
                              return (
                                <div className="host-list-port" key={`${port.protocol}:${port.portId}`}>
                                  <span className="port-number">{port.portId}/{port.protocol}</span>
                                  <span
                                    className="port-state"
                                    style={{ color: stateColor(port.state) }}
                                  >
                                    {stateKeys[port.state]
                                      ? t(stateKeys[port.state])
                                      : port.state}
                                  </span>
                                  <span
                                    className="host-list-port-service"
                                    title={[service?.name, product].filter(Boolean).join(' · ')}
                                  >
                                    {service?.name || t('ports.unknown')}
                                    {product && ` · ${product}`}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {host.extraPorts.map((group, index) => (
                          <div className="ports-card-extra" key={`${group.state}:${index}`}>
                            {t('ports.extra', {
                              count: formatNumber(group.count),
                              state: stateKeys[group.state]
                                ? t(stateKeys[group.state])
                                : group.state,
                            })}
                            <span>
                              {group.reasons
                                .map((reason) => `${formatNumber(reason.count)} ${reason.reason}`)
                                .join(' · ')}
                            </span>
                          </div>
                        ))}

                        <HostDetails
                          host={host}
                          open
                          openSections
                          onNotesChange={(notes) => onNotesChange(host.key, notes)}
                          onNotesCommit={() => onNotesCommit(host.key)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      <ScrollToTop targetRef={rootRef} />
    </div>
  );
}
