import { useState } from 'react';
import { AlertTriangle, Radar, RotateCcw, X } from 'lucide-react';
import type { NmapScan } from './types';
import { parseNmapXml } from './parser/nmapXml';
import UploadView from './components/UploadView';
import Workspace from './components/Workspace';

export default function App() {
  const [scan, setScan] = useState<NmapScan | null>(null);
  const [hideWarning, setHideWarning] = useState(false);
  const [uploadKey, setUploadKey] = useState(0);

  const resetScan = () => {
    setScan(null);
    setHideWarning(false);
    setUploadKey((key) => key + 1);
  };

  const loadXml = (xml: string, filename: string, extraWarnings: string[] = []) => {
    const parsed = parseNmapXml(xml, filename);
    setScan({ ...parsed, warnings: [...extraWarnings, ...parsed.warnings] });
    setHideWarning(false);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          type="button"
          className="brand"
          onClick={resetScan}
          title="Nuevo escaneo"
          aria-label="Nmap Atlas: nuevo escaneo"
        >
          <span className="brand-mark"><Radar size={22} strokeWidth={2} /></span>
          <h1>Nmap Atlas</h1>
        </button>
        {scan && (
          <div className="header-right">
            <div className="header-file" title={scan.filename || 'XML sin nombre'}>
              <span className="dot dot-green" />
              {scan.filename || 'Escaneo cargado'}
              <span className="muted">
                · {scan.hosts.length} hosts ·{' '}
                {scan.hosts.reduce(
                  (total, host) => total + host.ports.filter((port) => port.state === 'open').length,
                  0,
                )}{' '}
                puertos abiertos
              </span>
            </div>
            <button className="btn btn-ghost" onClick={resetScan}>
              <RotateCcw size={15} /> Nuevo escaneo
            </button>
          </div>
        )}
      </header>

      {scan?.warnings.length ? !hideWarning && (
        <div className="warning-banner" role="status">
          <AlertTriangle size={15} />
          <span>{scan.warnings.join(' ')}</span>
          <button className="icon-button" onClick={() => setHideWarning(true)} title="Ocultar aviso">
            <X size={14} />
          </button>
        </div>
      ) : null}

      {scan ? (
        <Workspace key={scan.filename + scan.args} scan={scan} />
      ) : (
        <UploadView key={uploadKey} onLoad={loadXml} />
      )}
    </div>
  );
}
