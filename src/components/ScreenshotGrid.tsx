import { useEffect, useRef } from 'react';
import type { HostScreenshot, NmapHost } from '../types';
import type { TFunction } from '../i18n';
import { useI18n } from '../i18n/I18nProvider';
import { hostLabel } from '../parser/nmapXml';
import { screenshotUrl } from '../screenshots';

export interface CaptureItem {
  key: string;
  hostKey: string;
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
}

export default function ScreenshotGrid({ captures, scrollTo, onScrolled }: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollTo) return;
    const cards = rootRef.current?.querySelectorAll<HTMLElement>('[data-capture-key]');
    const card = Array.from(cards ?? []).find(
      (element) => element.getAttribute('data-capture-key') === scrollTo,
    );
    card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    onScrolled();
  }, [scrollTo, onScrolled]);

  return (
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
    </div>
  );
}
