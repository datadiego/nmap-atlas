import { useState } from 'react';
import { AlertTriangle, Radar, RotateCcw, X } from 'lucide-react';
import type { NmapScan } from './types';
import { parseNmapXml } from './parser/nmapXml';
import { forgetHostNotes, hostNotesKey, loadHostNotes, saveHostNotes } from './notes';
import { useI18n } from './i18n/I18nProvider';
import RenameScan from './components/RenameScan';
import UploadView from './components/UploadView';
import Workspace from './components/Workspace';

export default function App() {
  const { t, locale, formatNumber, formatDateTime } = useI18n();
  const [scan, setScan] = useState<NmapScan | null>(null);
  const [hideWarning, setHideWarning] = useState(false);
  const [uploadKey, setUploadKey] = useState(0);
  const [viewKey, setViewKey] = useState(0);
  const [renamingScan, setRenamingScan] = useState(false);

  const resetScan = () => {
    setScan(null);
    setHideWarning(false);
    setRenamingScan(false);
    setUploadKey((key) => key + 1);
  };

  const loadXml = (xml: string, filename: string, extraWarnings: string[] = []) => {
    const parsed = parseNmapXml(xml, filename, t);
    const savedNotes = loadHostNotes();
    parsed.hosts = parsed.hosts.map((host) => ({
      ...host,
      notes: savedNotes[hostNotesKey(filename, host.key)] ?? '',
    }));
    setScan({ ...parsed, warnings: [...extraWarnings, ...parsed.warnings] });
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

  const updateHostNotes = (hostKey: string, notes: string) => {
    setScan((current) => {
      if (!current) return current;
      const savedNotes = loadHostNotes();
      const key = hostNotesKey(current.filename, hostKey);
      if (notes.trim()) savedNotes[key] = notes;
      else delete savedNotes[key];
      saveHostNotes(savedNotes);
      return {
        ...current,
        hosts: current.hosts.map((host) =>
          host.key === hostKey ? { ...host, notes } : host,
        ),
      };
    });
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
        <Workspace key={`${viewKey}:${locale}`} scan={scan} onNotesChange={updateHostNotes} />
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
