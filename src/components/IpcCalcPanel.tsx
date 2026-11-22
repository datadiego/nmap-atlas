import { useEffect, useState } from 'react';
import { AlertCircle, Calculator, LoaderCircle, X } from 'lucide-react';
import type { IpcCalcResult } from '../types';

interface Props {
  initialTarget: string;
  version?: string | null;
  onUse: (cidr: string) => void;
  onClose: () => void;
}

function formatCount(value?: string) {
  if (!value || !/^\d+$/.test(value)) return value ?? '—';
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export default function IpcCalcPanel({ initialTarget, version, onUse, onClose }: Props) {
  const [query, setQuery] = useState(initialTarget);
  const [result, setResult] = useState<IpcCalcResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
      if (!response.ok) throw new Error(data.error ?? `Error ${response.status}`);
      setResult(data);
    } catch (err) {
      if (err instanceof TypeError) {
        setError('No hay conexión con el servidor local. Inicia Nmap Atlas desde la CLI.');
      } else {
        setError(err instanceof Error ? err.message : 'No se pudo calcular el rango.');
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

  const rows = result
    ? [
        ['Dirección', result.address],
        ['Máscara', result.netmask ? `${result.netmask} (/${result.prefix})` : undefined],
        ['Broadcast', result.broadcast],
        ['Rango', result.minaddr && result.maxaddr ? `${result.minaddr} – ${result.maxaddr}` : undefined],
        ['Direcciones', formatCount(result.addresses)],
        ['Espacio', result.addrspace],
      ].filter(([, value]) => Boolean(value))
    : [];

  return (
    <div className="ipcalc-panel">
      <div className="ipcalc-head">
        <span><Calculator size={14} /> Calcular rango</span>
        {version && <code>ipcalc {version}</code>}
        <button type="button" className="icon-button ipcalc-close" onClick={onClose} aria-label="Cerrar calculadora" title="Cerrar">
          <X size={13} />
        </button>
      </div>

      <div className="ipcalc-input-row">
        <input
          className="scan-input"
          value={query}
          spellCheck={false}
          placeholder="192.168.1.10/24"
          aria-label="Dirección o rango a calcular"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void calculate(); }}
        />
        <button type="button" className="btn btn-primary ipcalc-run" onClick={() => void calculate()} disabled={busy || !query.trim()}>
          {busy ? <LoaderCircle size={14} className="spin" /> : <Calculator size={14} />}
          {busy ? 'Calculando…' : 'Calcular'}
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
            <span>Red calculada</span>
            <strong>{result.cidr}</strong>
            <em>{result.family}</em>
          </div>
          <dl className="ipcalc-data">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <button type="button" className="btn btn-ghost ipcalc-use" onClick={() => onUse(result.cidr ?? query)}>
            Usar como objetivo
          </button>
        </div>
      )}
    </div>
  );
}
