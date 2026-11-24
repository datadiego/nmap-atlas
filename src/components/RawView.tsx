import { useEffect, useState } from 'react';
import { Check, Copy, Download, FileText } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';

interface Props {
  name: string;
}

export default function RawView({ name }: Props) {
  const { t, formatNumber } = useI18n();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setText('');
    fetch(`/api/scans/${encodeURIComponent(name)}/raw`)
      .then(async (response) => {
        const body = await response.text();
        if (!response.ok) throw new Error(body.trim() || String(response.status));
        return body;
      })
      .then((body) => { if (active) setText(body); })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [name]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError(t('raw.copyError'));
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}.nmap`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const lines = text ? text.split('\n').length : 0;

  return (
    <div className="raw-view">
      <div className="raw-head">
        <div className="raw-title">
          <FileText size={15} />
          <strong>{name}</strong>
          {!loading && !error && text && (
            <span>{formatNumber(lines)} {lines === 1 ? t('raw.line') : t('raw.lines')}</span>
          )}
        </div>
        <div className="raw-actions">
          <button onClick={() => void copy()} disabled={!text} title={t('raw.copy')}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? t('raw.copied') : t('raw.copy')}</span>
          </button>
          <button onClick={download} disabled={!text} title={t('raw.download')}>
            <Download size={14} />
            <span>{t('raw.download')}</span>
          </button>
        </div>
      </div>

      {loading && <p className="raw-state">{t('raw.loading')}</p>}
      {!loading && error && <p className="raw-state raw-error">{error}</p>}
      {!loading && !error && !text && <p className="raw-state">{t('raw.empty')}</p>}
      {!loading && !error && text && <pre className="raw-pre">{text}</pre>}
    </div>
  );
}
