import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { AlertCircle, FileCode2, FolderOpen, LoaderCircle, Settings2, Terminal } from 'lucide-react';
import type { ApiStatus, SavedScan } from '../types';
import OptionsPanel from './OptionsPanel';
import ScanForm from './ScanForm';

interface Props {
  onLoad: (xml: string, filename: string, warnings?: string[]) => void;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function UploadView({ onLoad }: Props) {
  const [mode, setMode] = useState<'file' | 'scan' | 'options'>('scan');
  const [apiStatus, setApiStatus] = useState<ApiStatus | null | undefined>(undefined);
  const [scans, setScans] = useState<SavedScan[]>([]);
  const [loadingSaved, setLoadingSaved] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/status')
      .then((response) => (response.ok ? (response.json() as Promise<ApiStatus>) : null))
      .then((data) => { if (active) setApiStatus(data ?? null); })
      .catch(() => { if (active) setApiStatus(null); });
    return () => { active = false; };
  }, []);

  const loadSaved = async () => {
    try {
      const response = await fetch('/api/scans');
      if (!response.ok) return;
      const data = (await response.json()) as { scans: SavedScan[] };
      setScans(data.scans);
    } catch {
      // Si falla el historial, el resto de la interfaz sigue funcionando.
    }
  };

  useEffect(() => { void loadSaved(); }, []);

  const readFile = async (file: File) => {
    setError('');
    try {
      onLoad(await file.text(), file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer el archivo.');
    }
  };

  const openSaved = async (name: string) => {
    setError('');
    setLoadingSaved(name);
    try {
      const response = await fetch(`/api/scans/${encodeURIComponent(name)}`);
      if (!response.ok) throw new Error(`Error ${response.status} al abrir el escaneo.`);
      onLoad(await response.text(), name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir el escaneo guardado.');
    } finally {
      setLoadingSaved(null);
    }
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void readFile(file);
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void readFile(file);
  };

  return (
    <main className="upload-view">
      <div className="upload-card">
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={mode === 'file'}
            className={mode === 'file' ? 'active' : ''}
            onClick={() => { setMode('file'); setError(''); }}
          >
            <FolderOpen size={16} /> Escaneos realizados
          </button>
          <button
            role="tab"
            aria-selected={mode === 'scan'}
            className={mode === 'scan' ? 'active' : ''}
            onClick={() => { setMode('scan'); setError(''); }}
          >
            <Terminal size={16} /> Escanear
          </button>
          <button
            role="tab"
            aria-selected={mode === 'options'}
            className={mode === 'options' ? 'active' : ''}
            onClick={() => { setMode('options'); setError(''); }}
          >
            <Settings2 size={16} /> Opciones
          </button>
        </div>

        {mode === 'file' ? (
          <div className="upload-panel">
            <div
              className={`dropzone ${dragging ? 'dragging' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => { if (event.key === 'Enter') inputRef.current?.click(); }}
            >
              <div className="drop-icon"><FileCode2 size={34} /></div>
              <h3>Arrastra tu XML aquí</h3>
              <p>o haz clic para buscarlo en tu equipo</p>
              <span className="drop-hint">.xml · se admite la salida de nmap -oX / -oA</span>
              <input
                ref={inputRef}
                type="file"
                accept=".xml,text/xml,application/xml"
                hidden
                onChange={handleInput}
              />
            </div>

            {scans.length > 0 && (
              <div className="saved-scans">
                <div className="saved-scans-head">
                  <FolderOpen size={14} /> Escaneos guardados ({scans.length})
                </div>
                <div className="saved-scans-list">
                  {scans.slice(0, 12).map((scan) => (
                    <button key={scan.name} onClick={() => void openSaved(scan.name)}>
                      <span className="saved-name">
                        {loadingSaved === scan.name && <LoaderCircle size={11} className="spin" />}
                        {scan.name}
                      </span>
                      <span className="saved-meta">
                        {formatSize(scan.size)} · {new Date(scan.mtime).toLocaleString()}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : mode === 'options' ? (
          <OptionsPanel />
        ) : (
          <ScanForm status={apiStatus} onLoad={onLoad} />
        )}

        {error && (
          <div className="error-banner" role="alert">
            <AlertCircle size={16} /> {error}
          </div>
        )}
      </div>
    </main>
  );
}
