import { useRef, useState } from 'react';
import { AlertTriangle, Radar, RotateCcw, X } from 'lucide-react';
import type { NmapScan } from './types';
import { parseNmapXml } from './parser/nmapXml';
import { forgetHostNotes, hostNotesKey, loadHostNotes, saveHostNotes } from './notes';
import { useI18n } from './i18n/I18nProvider';
import { useScreenshots } from './screenshots';
import RenameScan from './components/RenameScan';
import UploadView from './components/UploadView';
import Workspace from './components/Workspace';

export default function App() {
  const { t, locale, formatNumber, formatDateTime } = useI18n();
  const { refresh: refreshScreenshots } = useScreenshots();
  const [scan, setScan] = useState<NmapScan | null>(null);
  const [hideWarning, setHideWarning] = useState(false);
  const [uploadKey, setUploadKey] = useState(0);
  const [viewKey, setViewKey] = useState(0);
  const [renamingScan, setRenamingScan] = useState(false);
  const scanRef = useRef<NmapScan | null>(null);
  const noteTimers = useRef(new Map<string, number>());
  const noteValues = useRef(new Map<string, string>());
  scanRef.current = scan;

  const resetScan = () => {
    setScan(null);
    setHideWarning(false);
    setRenamingScan(false);
    setUploadKey((key) => key + 1);
  };

  const loadXml = (xml: string, filename: string, extraWarnings: string[] = []) => {
    const parsed = parseNmapXml(xml, filename, t);
    const legacy = loadHostNotes();
    const pendingMigration: Array<{ index: number; notes: string }> = [];

    parsed.hosts = parsed.hosts.map((host, index) => {
      const legacyNote = legacy[hostNotesKey(filename, host.key)];
      if (!host.hasXmlNote && legacyNote) {
        pendingMigration.push({ index, notes: legacyNote });
        return { ...host, notes: legacyNote };
      }
      return host;
    });

    if (pendingMigration.length > 0) {
      void Promise.all(
        pendingMigration.map(({ index, notes }) =>
          fetch('/api/scans/note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: filename, index, notes }),
          }),
        ),
      )
        .then((responses) => {
          if (responses.every((response) => response.ok)) forgetHostNotes([filename]);
        })
        .catch(() => {
          // Si no se puede migrar, la nota sigue visible en esta sesión.
        });
    }

    setScan({ ...parsed, warnings: [...extraWarnings, ...parsed.warnings] });
    void refreshScreenshots();
    setHideWarning(false);
    setRenamingScan(false);
    setViewKey((key) => key + 1);
  };

  const renameSavedScan = (name: string) => {
    setScan((current) => {
      if (!current || current.filename === name) return current;
      const savedNotes = loadHostNotes();
      current.hosts.forEach((host) => {
        const oldKey = hostNotesKey(current.filename, host.key);
        const value = savedNotes[oldKey];
        if (value === undefined) return;
        delete savedNotes[oldKey];
        savedNotes[hostNotesKey(name, host.key)] = value;
      });
      saveHostNotes(savedNotes);
      return { ...current, filename: name };
    });
  };

  const persistHostNote = (hostKey: string) => {
    const current = scanRef.current;
    const notes = noteValues.current.get(hostKey);
    if (!current || notes === undefined) return;
    noteValues.current.delete(hostKey);
    const index = Number(/^host-(\d+)$/.exec(hostKey)?.[1] ?? -1);
    if (index < 0) return;
    void fetch('/api/scans/note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: current.filename, index, notes }),
    }).catch(() => {
      // El XML no se ha podido actualizar; la nota sigue en la vista actual.
    });
  };

  const flushHostNotes = (hostKey: string) => {
    const timer = noteTimers.current.get(hostKey);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      noteTimers.current.delete(hostKey);
    }
    persistHostNote(hostKey);
  };

  const updateHostNotes = (hostKey: string, notes: string) => {
    noteValues.current.set(hostKey, notes);
    setScan((current) => {
      if (!current) return current;
      const hosts = current.hosts.map((host) =>
        host.key === hostKey ? { ...host, notes } : host,
      );
      const next = { ...current, hosts };
      scanRef.current = next;
      return next;
    });
    const previous = noteTimers.current.get(hostKey);
    if (previous !== undefined) window.clearTimeout(previous);
    noteTimers.current.set(
      hostKey,
      window.setTimeout(() => {
        noteTimers.current.delete(hostKey);
        persistHostNote(hostKey);
      }, 500),
    );
  };

  const openPorts = scan
    ? scan.hosts.reduce(
        (total, host) => total + host.ports.filter((port) => port.state === 'open').length,
        0,
      )
    : 0;
  const startDate = scan?.start ? new Date(scan.start) : null;
  const validStartDate = startDate && !Number.isNaN(startDate.getTime()) ? startDate : null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          type="button"
          className="brand"
          onClick={resetScan}
          title={t('app.newScan')}
          aria-label={t('app.newScanAria')}
        >
          <span className="brand-mark"><Radar size={22} strokeWidth={2} /></span>
          <h1>Nmap Atlas</h1>
        </button>
        {scan && (
          <div className="header-right">
            <div className="header-file" title={scan.filename || t('app.unnamedXml')}>
              <span className="dot dot-green" />
              {!renamingScan && (
                <span className="header-file-name">{scan.filename || t('app.scanLoaded')}</span>
              )}
              <RenameScan
                filename={scan.filename}
                onRenamed={renameSavedScan}
                onEditingChange={setRenamingScan}
              />
              {!renamingScan && <span className="muted">
                {' · '}
                {t('app.hosts', { count: formatNumber(scan.hosts.length) })}
                {' · '}
                {t('app.openPorts', { count: formatNumber(openPorts) })}
                {validStartDate && (
                  <>
                    {' · '}
                    {formatDateTime(validStartDate, { dateStyle: 'medium', timeStyle: 'short' })}
                  </>
                )}
              </span>}
            </div>
            <button className="btn btn-ghost" onClick={resetScan}>
              <RotateCcw size={15} /> {t('app.newScan')}
            </button>
          </div>
        )}
      </header>

      {scan?.warnings.length ? !hideWarning && (
        <div className="warning-banner" role="status">
          <AlertTriangle size={15} />
          <span>{scan.warnings.join(' ')}</span>
          <button className="icon-button" onClick={() => setHideWarning(true)} title={t('app.hideWarning')}>
            <X size={14} />
          </button>
        </div>
      ) : null}

      {scan ? (
        <Workspace
          key={`${viewKey}:${locale}`}
          scan={scan}
          onNotesChange={updateHostNotes}
          onNotesCommit={flushHostNotes}
        />
      ) : (
        <UploadView
          key={uploadKey}
          onLoad={loadXml}
          onDeleteSaved={(name) => forgetHostNotes([name])}
          onDeleteAllSaved={forgetHostNotes}
        />
      )}
    </div>
  );
}
