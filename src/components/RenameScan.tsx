import { useEffect, useState, type KeyboardEvent } from 'react';
import { Check, LoaderCircle, Pencil, X } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';

interface Props {
  filename: string;
  onRenamed: (name: string) => void;
  onEditingChange?: (editing: boolean) => void;
}

function normalizeName(raw: string): string {
  const base = raw
    .trim()
    .replace(/\.xml$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 76);
  return base ? `${base}.xml` : '';
}

export default function RenameScan({ filename, onRenamed, onEditingChange }: Props) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(filename.replace(/\.xml$/i, ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const updateEditing = (next: boolean) => {
    setEditing(next);
    onEditingChange?.(next);
  };

  useEffect(() => {
    setValue(filename.replace(/\.xml$/i, ''));
    setError('');
    updateEditing(false);
    // El setter de estado de React es estable; solo queremos reaccionar al nombre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename]);

  if (!/\.xml$/i.test(filename)) return null;

  const translateError = (message: string) => {
    if (message.includes('Ya existe')) return t('app.renameExists');
    if (message.includes('no existe')) return t('app.renameMissing');
    if (message.includes('no válido')) return t('app.renameInvalid');
    return message || t('app.renameError');
  };

  const cancel = () => {
    setValue(filename.replace(/\.xml$/i, ''));
    setError('');
    updateEditing(false);
  };

  const save = async () => {
    const name = normalizeName(value);
    if (!name) {
      setError(t('app.renameInvalid'));
      return;
    }
    if (name === filename) {
      cancel();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/scans/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: filename, to: name }),
      });
      const data = (await response.json().catch(() => ({}))) as { name?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? t('app.renameError'));
      onRenamed(data.name ?? name);
      updateEditing(false);
    } catch (err) {
      setError(translateError(err instanceof Error ? err.message : ''));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  };

  if (editing) {
    return (
      <span className="rename-scan" onClick={(event) => event.stopPropagation()}>
        <input
          autoFocus
          className={`rename-input${error ? ' invalid' : ''}`}
          value={value}
          placeholder={t('app.renamePlaceholder')}
          aria-label={t('app.renameTitle')}
          aria-invalid={Boolean(error)}
          title={error || t('app.renameTitle')}
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="rename-action"
          title={t('app.renameSave')}
          aria-label={t('app.renameSave')}
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}
        </button>
        <button
          type="button"
          className="rename-action"
          title={t('app.renameCancel')}
          aria-label={t('app.renameCancel')}
          disabled={busy}
          onClick={cancel}
        >
          <X size={13} />
        </button>
      </span>
    );
  }

  return (
    <span className="rename-scan">
      <button
        type="button"
        className="rename-button"
        title={error || t('app.renameTitle')}
        aria-label={t('app.renameTitle')}
        onClick={() => { setError(''); updateEditing(true); }}
      >
        <Pencil size={12} />
      </button>
    </span>
  );
}
