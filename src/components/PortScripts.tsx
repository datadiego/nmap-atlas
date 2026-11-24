import { useI18n } from '../i18n/I18nProvider';
import type { NmapPort } from '../types';

interface Props {
  port: NmapPort;
  open?: boolean;
}

/** Resultados NSE de un puerto, incluidos los scripts del servicio. */
export default function PortScripts({ port, open = false }: Props) {
  const { t } = useI18n();
  const scripts = [...(port.scripts ?? []), ...(port.service?.scripts ?? [])];
  if (scripts.length === 0) return null;

  return (
    <details className="port-scripts" open={open}>
      <summary>{t('ports.scripts', { count: scripts.length })}</summary>
      <div className="port-scripts-body">
        {scripts.map((script, index) => (
          <div className="host-script" key={`${script.id}:${index}`}>
            <strong>{script.id}</strong>
            <code>{script.output}</code>
          </div>
        ))}
      </div>
    </details>
  );
}
