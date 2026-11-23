import { useEffect, useState } from 'react';
import { AlertCircle, Calculator, LoaderCircle, X } from 'lucide-react';
import type { IpcCalcResult } from '../types';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n';

interface Props {
  initialTarget: string;
  version?: string | null;
  onUse: (cidr: string) => void;
  onClose: () => void;
}

export default function IpcCalcPanel({ initialTarget, version, onUse, onClose }: Props) {
  const { t, formatNumber } = useI18n();
  const [query, setQuery] = useState(initialTarget);
  const [result, setResult] = useState<IpcCalcResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const formatCount = (value?: string) => {
    if (!value || !/^\d+$/.test(value)) return value ?? '—';
    return formatNumber(Number(value));
  };

  const calculate = async () => {
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const response = await fetch('/api/ipcalc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: query }),
      });
      const data = await response.json().catch(() => ({})) as IpcCalcResult & { error?: string };
      if (!response.ok) throw new Error(data.error ?? t('scan.errorStatus', { status: response.status }));
      setResult(data);
    } catch (err) {
      if (err instanceof TypeError) {
        setError(t('ipcalc.noServer'));
      } else {
        setError(err instanceof Error ? err.message : t('ipcalc.calcError'));
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initialTarget.trim()) void calculate();
    // Solo se calcula al abrir el panel; los cambios posteriores los hace el botón.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows: Array<[TranslationKey, string | undefined]> = result
    ? [
        ['ipcalc.address', result.address],
        ['ipcalc.netmask', result.netmask ? `${result.netmask} (/${result.prefix})` : undefined],
        ['ipcalc.broadcast', result.broadcast],
        ['ipcalc.range', result.minaddr && result.maxaddr ? `${result.minaddr} – ${result.maxaddr}` : undefined],
        ['ipcalc.addresses', formatCount(result.addresses)],
        ['ipcalc.space', result.addrspace],
      ].filter((row): row is [TranslationKey, string] => Boolean(row[1]))
    : [];

  return (
    <div className="ipcalc-panel">
      <div className="ipcalc-head">
        <span><Calculator size={14} /> {t('ipcalc.title')}</span>
        {version && <code>ipcalc {version}</code>}
        <button type="button" className="icon-button ipcalc-close" onClick={onClose} aria-label={t('ipcalc.close')} title={t('ipcalc.closeShort')}>
          <X size={13} />
        </button>
      </div>

      <div className="ipcalc-input-row">
        <input
          className="scan-input"
          value={query}
          spellCheck={false}
          placeholder="192.168.1.10/24"
          aria-label={t('ipcalc.targetAria')}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void calculate(); }}
        />
        <button type="button" className="btn btn-primary ipcalc-run" onClick={() => void calculate()} disabled={busy || !query.trim()}>
          {busy ? <LoaderCircle size={14} className="spin" /> : <Calculator size={14} />}
          {busy ? t('ipcalc.calculating') : t('ipcalc.calculate')}
        </button>
      </div>

      {error && (
        <div className="ipcalc-error" role="alert">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {result && (
        <div className="ipcalc-result">
          <div className="ipcalc-network">
            <span>{t('ipcalc.network')}</span>
            <strong>{result.cidr}</strong>
            <em>{result.family}</em>
          </div>
          <dl className="ipcalc-data">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{t(label)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <button type="button" className="btn btn-ghost ipcalc-use" onClick={() => onUse(result.cidr ?? query)}>
            {t('ipcalc.use')}
          </button>
        </div>
      )}
    </div>
  );
}
