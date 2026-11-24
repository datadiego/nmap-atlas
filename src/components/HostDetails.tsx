import type { ReactNode } from 'react';
import { httpUrlsForHost } from '../httpUrls';
import { useI18n } from '../i18n/I18nProvider';
import { screenshotUrl, useScreenshots } from '../screenshots';
import type { NmapHost } from '../types';

interface Props {
  host: NmapHost;
  open?: boolean;
  /** Abre también las secciones internas (huellas de SO), no solo el bloque. */
  openSections?: boolean;
  onNotesChange?: (notes: string) => void;
  onNotesCommit?: () => void;
  /** Resalta la entrada HTTP de este puerto, por ejemplo al abrirla desde una captura. */
  highlightPort?: string;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="host-detail-row">
      <span className="host-detail-label">{label}</span>
      <div className="host-detail-values">{children}</div>
    </div>
  );
}

function cpeUrl(cpe: string): string {
  return `https://nvd.nist.gov/vuln/search/results?query=${encodeURIComponent(cpe)}&search_type=all`;
}

export default function HostDetails({
  host,
  open = false,
  openSections = false,
  onNotesChange,
  onNotesCommit,
  highlightPort,
}: Props) {
  const { t, formatNumber } = useI18n();
  const { forHost } = useScreenshots();
  const screenshots = forHost(host);
  const httpPorts = httpUrlsForHost(host);
  const osSummary = host.os[0]?.name || host.osClasses[0]?.osFamily || host.osClasses[0]?.vendor || '';

  type HttpItem = { port: string; url: string; shot?: (typeof screenshots)[number]['shot'] };
  const byPort = new Map<string, HttpItem>();
  for (const { port, url } of httpPorts) {
    byPort.set(String(port), { port: String(port), url });
  }
  for (const { port, shot } of screenshots) {
    const existing = byPort.get(port);
    byPort.set(port, existing
      ? { ...existing, shot, url: shot.url || existing.url }
      : { port, url: shot.url, shot });
  }
  const httpItems = [...byPort.values()].sort((a, b) => Number(a.port) - Number(b.port));

  return (
    <details className="host-details" open={open}>
      <summary>
        <span>{t('host.details')}</span>
        {host.notes && <span className="host-details-note-dot" title={t('host.notes')} />}
        {osSummary && <span className="host-details-os">{osSummary}</span>}
      </summary>
      <div className="host-details-body">
        <Row label={t('host.notes')}>
          <textarea
            className="host-notes-input nodrag"
            value={host.notes}
            placeholder={t('host.notesPlaceholder')}
            rows={2}
            maxLength={500}
            onChange={(event) => onNotesChange?.(event.target.value)}
            onBlur={() => onNotesCommit?.()}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          />
        </Row>

        {(host.state || host.reason) && (
          <Row label={t('host.state')}>
            {host.state && <code className="host-detail-chip">{host.state}</code>}
            {host.reason && (
              <span className="host-detail-text">{t('host.reason')}: {host.reason}</span>
            )}
          </Row>
        )}

        {host.addresses.length > 0 && (
          <Row label={t('host.addresses')}>
            {host.addresses.map((address) => (
              <code className="host-detail-chip" key={`${address.type}:${address.addr}`}>
                {address.addr}
                {address.type && ` · ${address.type}`}
                {address.vendor && ` · ${address.vendor}`}
              </code>
            ))}
          </Row>
        )}

        {host.hostnames.length > 0 && (
          <Row label={t('host.hostnames')}>
            {host.hostnames.map((hostname, index) => (
              <code className="host-detail-chip" key={`${hostname.name}:${index}`}>
                {hostname.name}
                {hostname.type && ` · ${hostname.type}`}
              </code>
            ))}
          </Row>
        )}

        {httpItems.length > 0 && (
          <Row label={t('host.http')}>
            <div className="host-screenshots">
              {httpItems.map(({ port, url, shot }) => (
                <div
                  className={`host-http-entry${highlightPort === port ? ' match' : ''}`}
                  key={`${port}:${url || shot?.file}`}
                  data-http-port={port}
                >
                  {shot ? (
                    <div className="host-screenshot">
                      <a
                        className="host-screenshot-image"
                        href={screenshotUrl(shot.file)}
                        target="_blank"
                        rel="noreferrer"
                        title={shot.title
                          ? `${shot.title} · ${t('host.screenshotOpen', { url: shot.url })}`
                          : t('host.screenshotOpen', { url: shot.url })}
                      >
                        <img src={screenshotUrl(shot.file)} alt={shot.url} loading="lazy" />
                      </a>
                      <span>
                        <strong>:{port}</strong>
                        {shot.title && <span>{shot.title}</span>}
                        {url ? (
                          <a
                            className="host-screenshot-url"
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            title={t('host.httpOpen', { url })}
                          >
                            <code>{url}</code>
                            <span aria-hidden="true">↗</span>
                          </a>
                        ) : (
                          <code>{shot.url}</code>
                        )}
                      </span>
                    </div>
                  ) : (
                    url && (
                      <a
                        className="host-http-link"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        title={t('host.httpOpen', { url })}
                      >
                        <code>:{port}</code>
                        <span>{url}</span>
                        <span aria-hidden="true">↗</span>
                      </a>
                    )
                  )}
                </div>
              ))}
            </div>
          </Row>
        )}

        {host.os.length > 0 && (
          <Row label={t('host.os')}>
            {host.os.map((match, index) => (
              <div className="host-os" key={`${match.name}:${index}`}>
                <div>
                  <strong>{match.name}</strong>
                  <span>{t('host.accuracy', { count: formatNumber(match.accuracy) })}</span>
                </div>
                {match.line && (
                  <details className="host-os-fingerprint" open={openSections}>
                    <summary>{t('host.osLine')}</summary>
                    <code>{match.line}</code>
                  </details>
                )}
              </div>
            ))}
          </Row>
        )}

        {host.osClasses.length > 0 && (
          <Row label={t('host.osClasses')}>
            {host.osClasses.map((osClass, index) => {
              const name = [osClass.vendor, osClass.osFamily, osClass.osGen]
                .filter(Boolean)
                .join(' ') || osClass.type;
              return (
                <div className="host-os" key={`${name}:${index}`}>
                  <div>
                    <strong>{name || '—'}</strong>
                    <span>
                      {[
                        osClass.type,
                        t('host.accuracy', { count: formatNumber(osClass.accuracy) }),
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  {osClass.cpe.length > 0 && (
                    <div className="host-cpe-list">
                      {osClass.cpe.filter(Boolean).map((cpe, index) => (
                        <a
                          className="port-cpe"
                          href={cpeUrl(cpe)}
                          target="_blank"
                          rel="noreferrer"
                          title={cpe}
                          key={`${cpe}:${index}`}
                        >
                          CPE
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </Row>
        )}

        {host.uptime && <Row label={t('host.uptime')}><code className="host-detail-chip">{host.uptime}</code></Row>}
        {host.distance && <Row label={t('host.distance')}><code className="host-detail-chip">{host.distance}</code></Row>}

        {host.times && (
          <Row label={t('host.times')}>
            <code className="host-detail-chip">
              srtt {host.times.srtt} · rttvar {host.times.rttvar} · to {host.times.to}
            </code>
          </Row>
        )}

        {host.scripts.length > 0 && (
          <Row label={t('host.scripts')}>
            {host.scripts.map((script) => (
              <div className="host-script" key={script.id}>
                <strong>{script.id}</strong>
                <code>{script.output}</code>
              </div>
            ))}
          </Row>
        )}
      </div>
    </details>
  );
}
