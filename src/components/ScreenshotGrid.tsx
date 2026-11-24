import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { HostScreenshot, NmapHost } from '../types';
import type { TFunction } from '../i18n';
import { useI18n } from '../i18n/I18nProvider';
import { hostLabel } from '../parser/nmapXml';
import { screenshotUrl } from '../screenshots';
import HostDetails from './HostDetails';
import ScrollToTop from './ScrollToTop';

export interface CaptureItem {
  key: string;
  hostKey: string;
  nmapHost: NmapHost;
  host: string;
  address: string;
  port: string;
  file: string;
  url: string;
  title: string;
  code: number;
}

type HostCaptures = (host: NmapHost) => Array<{ key: string; port: string; shot: HostScreenshot }>;

/** Convierte las capturas de gowitness de cada host en tarjetas del grid. */
export function buildCaptures(hosts: NmapHost[], t: TFunction, forHost: HostCaptures): CaptureItem[] {
  const items: CaptureItem[] = [];
  for (const host of hosts) {
    const label = hostLabel(host, t);
    const address = host.addresses.find(
      (entry) => entry.type === 'ipv4' || entry.type === 'ipv6',
    )?.addr ?? '';
    forHost(host).forEach(({ key, port, shot }) => {
      items.push({
        key: `${host.key}:${key}:${shot.file}`,
        hostKey: host.key,
        nmapHost: host,
        host: label,
        address,
        port,
        file: shot.file,
        url: shot.url,
        title: shot.title,
        code: shot.code,
      });
    });
  }
  return items.sort((a, b) =>
    a.host.localeCompare(b.host, undefined, { numeric: true }) ||
    Number(a.port) - Number(b.port),
  );
}

/** La búsqueda del toolbar también aplica a URL, título y puerto de la captura. */
export function filterCaptures(items: CaptureItem[], query: string): CaptureItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) =>
    `${item.host} ${item.address} ${item.port} ${item.title} ${item.url} ${item.code}`
      .toLowerCase()
      .includes(needle),
  );
}

interface Props {
  captures: CaptureItem[];
  scrollTo: string | null;
  onScrolled: () => void;
  onNotesChange: (hostKey: string, notes: string) => void;
  onNotesCommit: (hostKey: string) => void;
}

export default function ScreenshotGrid({
  captures,
  scrollTo,
  onScrolled,
  onNotesChange,
  onNotesCommit,
}: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const modalBodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const capturesRef = useRef(captures);
  capturesRef.current = captures;

  useEffect(() => {
    if (!scrollTo) return;
    const cards = rootRef.current?.querySelectorAll<HTMLElement>('[data-capture-key]');
    const card = Array.from(cards ?? []).find(
      (element) => element.dataset.captureKey === scrollTo,
    );
    card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    onScrolled();
  }, [scrollTo, onScrolled]);

  useEffect(() => {
    if (selectedKey && !captures.some((item) => item.key === selectedKey)) {
      setSelectedKey(null);
    }
  }, [captures, selectedKey]);

  useEffect(() => {
    if (!selectedKey) return;
    const capture = capturesRef.current.find((item) => item.key === selectedKey);
    const entry = capture
      ? modalBodyRef.current?.querySelector<HTMLElement>(`[data-http-port="${capture.port}"]`)
      : null;
    entry?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    closeRef.current?.focus();
  }, [selectedKey]);

  useEffect(() => {
    if (!selectedKey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedKey(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedKey]);

  useEffect(() => {
    if (!selectedKey) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [selectedKey]);

  const open = useCallback((key: string) => setSelectedKey(key), []);
  const close = useCallback(() => setSelectedKey(null), []);
  const selectedCapture = selectedKey
    ? captures.find((item) => item.key === selectedKey) ?? null
    : null;

  return (
    <>
      <div className="capture-grid" ref={rootRef}>
        <div className="capture-grid-inner">
          {captures.length === 0 && <p className="capture-empty">{t('captures.empty')}</p>}
          <div className="capture-cards">
            {captures.map((capture) => (
              <article
                className="capture-card"
                key={capture.key}
                data-capture-key={capture.key}
                data-host-key={capture.hostKey}
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                aria-expanded={selectedKey === capture.key}
                aria-label={t('captures.openHost')}
                title={t('captures.openHost')}
                onClick={(event) => {
                  // La imagen sigue abriendo la captura completa en otra pestaña.
                  if ((event.target as HTMLElement).closest('a')) return;
                  open(capture.key);
                }}
                onKeyDown={(event) => {
                  if ((event.target as HTMLElement).closest('a')) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open(capture.key);
                  }
                }}
              >
                <a
                  className="capture-card-image"
                  href={screenshotUrl(capture.file)}
                  target="_blank"
                  rel="noreferrer"
                  title={t('captures.open')}
                >
                  <img src={screenshotUrl(capture.file)} alt={`${capture.host}:${capture.port}`} loading="lazy" />
                </a>
                <div className="capture-card-body">
                  <div className="capture-card-head">
                    <strong title={capture.host}>{capture.host}</strong>
                    <span className="capture-card-port">:{capture.port}</span>
                    <span className="capture-card-code">{capture.code}</span>
                  </div>
                  {capture.title && <span className="capture-card-title" title={capture.title}>{capture.title}</span>}
                  <code className="capture-card-url" title={capture.url}>{capture.url}</code>
                </div>
              </article>
            ))}
          </div>
        </div>
        <ScrollToTop targetRef={rootRef} />
      </div>

      {selectedCapture && createPortal(
        <div
          className="capture-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            className="capture-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('captures.detailsTitle', {
              host: selectedCapture.host,
              port: selectedCapture.port,
            })}
          >
            <div className="capture-modal-head">
              <div className="capture-modal-title">
                <strong title={selectedCapture.host}>{selectedCapture.host}</strong>
                <span className="capture-modal-port">:{selectedCapture.port}</span>
              </div>
              <button
                type="button"
                ref={closeRef}
                className="capture-modal-close"
                onClick={close}
                title={t('captures.closeDetails')}
                aria-label={t('captures.closeDetails')}
              >
                <X size={18} />
              </button>
            </div>
            <div className="capture-modal-body" ref={modalBodyRef}>
              <HostDetails
                host={selectedCapture.nmapHost}
                open
                openSections
                highlightPort={selectedCapture.port}
                onNotesChange={(notes) => onNotesChange(selectedCapture.hostKey, notes)}
                onNotesCommit={() => onNotesCommit(selectedCapture.hostKey)}
              />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
