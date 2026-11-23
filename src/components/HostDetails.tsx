import type { ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { NmapHost } from '../types';

interface Props {
  host: NmapHost;
  open?: boolean;
  /** Abre también las secciones internas (huellas de SO), no solo el bloque. */
  openSections?: boolean;
  onNotesChange?: (notes: string) => void;
  onNotesCommit?: () => void;
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
}: Props) {
  const { t, formatNumber } = useI18n();
  const osSummary = host.os[0]?.name || host.osClasses[0]?.osFamily || host.osClasses[0]?.vendor || '';

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
