import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { AlertCircle, Check, FileCode2, FolderOpen, LoaderCircle, Settings2, Terminal, Trash2, X } from 'lucide-react';
import type { ApiStatus, SavedScan } from '../types';
import { useI18n } from '../i18n/I18nProvider';
import OptionsPanel from './OptionsPanel';
import ScanForm from './ScanForm';

interface Props {
  onLoad: (xml: string, filename: string, warnings?: string[]) => void;
}

export default function UploadView({ onLoad }: Props) {
  const { t, formatNumber, formatDateTime } = useI18n();
  const [mode, setMode] = useState<'file' | 'scan' | 'options'>('scan');
  const [apiStatus, setApiStatus] = useState<ApiStatus | null | undefined>(undefined);
  const [scans, setScans] = useState<SavedScan[]>([]);
  const [loadingSaved, setLoadingSaved] = useState<string | null>(null);
  const [deletingSaved, setDeletingSaved] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
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

  const formatSize = (bytes: number) =>
    bytes < 1024
      ? `${formatNumber(bytes)} B`
      : `${formatNumber(bytes / 1024, { maximumFractionDigits: 1 })} KB`;

  const readFile = async (file: File) => {
    setError('');
    try {
      onLoad(await file.text(), file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('upload.readError'));
    }
  };

  const openSaved = async (name: string) => {
    setError('');
    setLoadingSaved(name);
    try {
      const response = await fetch(`/api/scans/${encodeURIComponent(name)}`);
      if (!response.ok) throw new Error(t('upload.openErrorStatus', { status: response.status }));
      onLoad(await response.text(), name);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('upload.openError'));
    } finally {
      setLoadingSaved(null);
    }
  };

  const deleteSaved = async (name: string) => {
    setError('');
    setDeletingSaved(name);
    try {
      const response = await fetch('/api/scans/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        const message = data.error ?? '';
        if (message.includes('no existe')) throw new Error(t('upload.deleteMissing'));
        if (message.includes('no válido')) throw new Error(t('upload.deleteInvalid'));
        throw new Error(message || t('upload.deleteError'));
      }
      setScans((current) => current.filter((scan) => scan.name !== name));
      setConfirmingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('upload.deleteError'));
    } finally {
      setDeletingSaved(null);
    }
  };

  const deleteAllSaved = async () => {
    setError('');
    setDeletingAll(true);
    try {
      const response = await fetch('/api/scans/delete-all', { method: 'POST' });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || t('upload.deleteAllError'));
      setScans([]);
      setConfirmingDelete(null);
      setConfirmingDeleteAll(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('upload.deleteAllError'));
    } finally {
      setDeletingAll(false);
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
            aria-selected={mode === 'scan'}
            className={mode === 'scan' ? 'active' : ''}
            onClick={() => { setMode('scan'); setError(''); }}
          >
            <Terminal size={16} /> {t('tabs.scan')}
          </button>
          <button
            role="tab"
            aria-selected={mode === 'file'}
            className={mode === 'file' ? 'active' : ''}
            onClick={() => { setMode('file'); setError(''); }}
          >
            <FolderOpen size={16} /> {t('tabs.savedScans')}
          </button>
          <button
            role="tab"
            aria-selected={mode === 'options'}
            className={mode === 'options' ? 'active' : ''}
            onClick={() => { setMode('options'); setError(''); }}
          >
            <Settings2 size={16} /> {t('tabs.options')}
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
              <div className="drop-icon"><FileCode2 size={22} /></div>
              <h3>{t('upload.dropTitle')}</h3>
              <p>{t('upload.dropSubtitle')}</p>
              <span className="drop-hint">{t('upload.dropFormats')}</span>
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
                  <FolderOpen size={14} /> {t('upload.savedScans', { count: scans.length })}
                  <div className="saved-scans-head-actions">
                    {confirmingDeleteAll ? (
                      <>
                        <button
                          className={`saved-scans-head-action confirm${deletingAll ? ' busy' : ''}`}
                          title={t('upload.deleteAllConfirm')}
                          aria-label={t('upload.deleteAllConfirm')}
                          disabled={deletingAll}
                          onClick={() => void deleteAllSaved()}
                        >
                          {deletingAll ? <LoaderCircle size={12} className="spin" /> : <Check size={12} />}
                          <span>{t('upload.deleteAllConfirm')}</span>
                        </button>
                        <button
                          className="saved-scans-head-action"
                          title={t('upload.deleteCancel')}
                          aria-label={t('upload.deleteCancel')}
                          disabled={deletingAll}
                          onClick={() => setConfirmingDeleteAll(false)}
                        >
                          <X size={12} />
                        </button>
                      </>
                    ) : (
                      <button
                        className="saved-scans-head-action"
                        title={t('upload.deleteAllTitle')}
                        aria-label={t('upload.deleteAllTitle')}
                        disabled={deletingAll}
                        onClick={() => setConfirmingDeleteAll(true)}
                      >
                        <Trash2 size={12} />
                        <span>{t('upload.deleteAllShort')}</span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="saved-scans-list">
                  {scans.map((scan) => {
                    const mtime = new Date(scan.mtime);
                    const validMtime = !Number.isNaN(mtime.getTime());
                    const confirming = confirmingDelete === scan.name;
                    return (
                      <div className="saved-scan-row" key={scan.name}>
                        <button
                          className="saved-scan-open"
                          onClick={() => void openSaved(scan.name)}
                          disabled={deletingAll || deletingSaved === scan.name}
                        >
                          <span className="saved-name">
                            {loadingSaved === scan.name && <LoaderCircle size={11} className="spin" />}
                            {scan.name}
                          </span>
                          <span className="saved-meta">
                            {formatSize(scan.size)}
                            {validMtime && ` · ${formatDateTime(mtime, { dateStyle: 'medium', timeStyle: 'short' })}`}
                          </span>
                        </button>
                        <div className="saved-scan-actions">
                          {confirming ? (
                            <>
                              <button
                                className={`saved-scan-action confirm${deletingSaved === scan.name ? ' busy' : ''}`}
                                title={t('upload.deleteConfirm')}
                                aria-label={t('upload.deleteConfirm')}
                                disabled={deletingAll || deletingSaved === scan.name}
                                onClick={() => void deleteSaved(scan.name)}
                              >
                                {deletingSaved === scan.name
                                  ? <LoaderCircle size={12} className="spin" />
                                  : <Check size={12} />}
                              </button>
                              <button
                                className="saved-scan-action"
                                title={t('upload.deleteCancel')}
                                aria-label={t('upload.deleteCancel')}
                                disabled={deletingAll || deletingSaved === scan.name}
                                onClick={() => setConfirmingDelete(null)}
                              >
                                <X size={12} />
                              </button>
                            </>
                          ) : (
                            <button
                              className="saved-scan-action"
                              title={t('upload.deleteTitle')}
                              aria-label={t('upload.deleteTitle')}
                              disabled={deletingAll || deletingSaved === scan.name}
                              onClick={() => setConfirmingDelete(scan.name)}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
