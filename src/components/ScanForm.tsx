import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Calculator, LoaderCircle, Play, Terminal, X } from 'lucide-react';
import type { ApiStatus, ScanResult } from '../types';
import { playSuccessSound } from '../audio';
import { useI18n } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n';
import {
  DEFAULT_FORM_VALUES,
  loadRememberedForm,
  loadRememberSettings,
  saveRememberedForm,
  type RememberedForm,
  type RememberSettings,
} from '../remember';
import IpcCalcPanel from './IpcCalcPanel';

interface Props {
  status: ApiStatus | null | undefined;
  onLoad: (xml: string, filename: string, warnings?: string[]) => void;
}

interface ScanProgress {
  bytes: number;
  hostHints: number;
  hosts: number;
  log: string[];
}

interface ScanOption {
  flag: string;
  labelKey: TranslationKey;
  docKey: TranslationKey;
  docsUrl: string;
}

interface OptionTooltip {
  option: ScanOption;
  x: number;
  y: number;
  placement: 'top' | 'bottom';
}

const PROFILES = [
  { id: 'quick', labelKey: 'profile.quick', flags: ['-F', '--open'], hintKey: 'profile.quickHint' },
  { id: 'hosts', labelKey: 'profile.hosts', flags: ['-sn', '-n', '--max-retries=1'], hintKey: 'profile.hostsHint' },
  {
    id: 'deep',
    labelKey: 'profile.deep',
    flags: [
      '-sn', '-PR', '-PE', '-PP', '-PM',
      '-PS80,443,5223', '-PA80,443', '-PU5353,1900',
      '-n', '--max-retries=2',
    ],
    hintKey: 'profile.deepHint',
  },
  { id: 'service', labelKey: 'profile.service', flags: ['-sV', '-sC', '--open'], hintKey: 'profile.serviceHint' },
  { id: 'full', labelKey: 'profile.full', flags: ['-sV', '-sC', '-O', '-p-'], hintKey: 'profile.fullHint' },
  { id: 'custom', labelKey: 'profile.custom', flags: [], hintKey: 'profile.customHint' },
] as const;

const OPTION_GROUPS: { titleKey: TranslationKey; options: ScanOption[] }[] = [
  {
    titleKey: 'group.scanTechnique',
    options: [
      {
        flag: '-sS', labelKey: 'option.sS.label',
        docKey: 'option.sS.doc',
        docsUrl: 'https://nmap.org/book/man-port-scanning-techniques.html',
      },
      {
        flag: '-sT', labelKey: 'option.sT.label',
        docKey: 'option.sT.doc',
        docsUrl: 'https://nmap.org/book/man-port-scanning-techniques.html',
      },
      {
        flag: '-sU', labelKey: 'option.sU.label',
        docKey: 'option.sU.doc',
        docsUrl: 'https://nmap.org/book/man-port-scanning-techniques.html',
      },
      {
        flag: '-sn', labelKey: 'option.sn.label',
        docKey: 'option.sn.doc',
        docsUrl: 'https://nmap.org/book/man-host-discovery.html',
      },
      {
        flag: '-sL', labelKey: 'option.sL.label',
        docKey: 'option.sL.doc',
        docsUrl: 'https://nmap.org/book/man-host-discovery.html',
      },
      {
        flag: '-A', labelKey: 'option.A.label',
        docKey: 'option.A.doc',
        docsUrl: 'https://nmap.org/book/man-misc-options.html',
      },
    ],
  },
  {
    titleKey: 'group.servicesOs',
    options: [
      {
        flag: '-sV', labelKey: 'option.sV.label',
        docKey: 'option.sV.doc',
        docsUrl: 'https://nmap.org/book/man-version-detection.html',
      },
      {
        flag: '--version-light', labelKey: 'option.versionlight.label',
        docKey: 'option.versionlight.doc',
        docsUrl: 'https://nmap.org/book/man-version-detection.html',
      },
      {
        flag: '-sC', labelKey: 'option.sC.label',
        docKey: 'option.sC.doc',
        docsUrl: 'https://nmap.org/book/man-nse.html',
      },
      {
        flag: '-O', labelKey: 'option.O.label',
        docKey: 'option.O.doc',
        docsUrl: 'https://nmap.org/book/man-os-detection.html',
      },
      {
        flag: '--osscan-limit', labelKey: 'option.osscanlimit.label',
        docKey: 'option.osscanlimit.doc',
        docsUrl: 'https://nmap.org/book/man-os-detection.html',
      },
    ],
  },
  {
    titleKey: 'group.discoveryPorts',
    options: [
      {
        flag: '-Pn', labelKey: 'option.Pn.label',
        docKey: 'option.Pn.doc',
        docsUrl: 'https://nmap.org/book/man-host-discovery.html',
      },
      {
        flag: '-PE', labelKey: 'option.PE.label',
        docKey: 'option.PE.doc',
        docsUrl: 'https://nmap.org/book/man-host-discovery.html',
      },
      {
        flag: '-F', labelKey: 'option.F.label',
        docKey: 'option.F.doc',
        docsUrl: 'https://nmap.org/book/man-port-specification.html',
      },
      {
        flag: '-p-', labelKey: 'option.p.label',
        docKey: 'option.p.doc',
        docsUrl: 'https://nmap.org/book/man-port-specification.html',
      },
      {
        flag: '--max-retries=1', labelKey: 'option.maxretries1.label',
        docKey: 'option.maxretries1.doc',
        docsUrl: 'https://nmap.org/book/man-performance.html',
      },
    ],
  },
  {
    titleKey: 'group.dnsNetworkOutput',
    options: [
      {
        flag: '-n', labelKey: 'option.n.label',
        docKey: 'option.n.doc',
        docsUrl: 'https://nmap.org/book/man-target-specification.html',
      },
      {
        flag: '-R', labelKey: 'option.R.label',
        docKey: 'option.R.doc',
        docsUrl: 'https://nmap.org/book/man-target-specification.html',
      },
      {
        flag: '-6', labelKey: 'option.6.label',
        docKey: 'option.6.doc',
        docsUrl: 'https://nmap.org/book/man-misc-options.html',
      },
      {
        flag: '--open', labelKey: 'option.open.label',
        docKey: 'option.open.doc',
        docsUrl: 'https://nmap.org/book/man-output.html',
      },
      {
        flag: '--traceroute', labelKey: 'option.traceroute.label',
        docKey: 'option.traceroute.doc',
        docsUrl: 'https://nmap.org/book/man-host-discovery.html',
      },
    ],
  },
];

// Técnicas incompatibles entre sí y opciones de DNS contrapuestas.
const EXCLUSIVE_FLAGS: Record<string, readonly string[]> = {
  '-sS': ['-sT', '-sn', '-sL'],
  '-sT': ['-sS', '-sn', '-sL'],
  '-sn': ['-sS', '-sT', '-sU', '-sL', '-A'],
  '-sL': ['-sS', '-sT', '-sU', '-sn', '-A'],
  '-A': ['-sn', '-sL'],
  '-n': ['-R'],
  '-R': ['-n'],
};

const TIMINGS = ['-T0', '-T1', '-T2', '-T3', '-T4', '-T5'] as const;
const TIMEOUTS: ReadonlyArray<{ value: string; label: string; labelKey?: TranslationKey }> = [
  { value: '', label: '', labelKey: 'scan.timeoutDefault' },
  { value: '300000', label: '5 min' },
  { value: '900000', label: '15 min' },
  { value: '1800000', label: '30 min' },
  { value: '3600000', label: '1 h' },
  { value: '7200000', label: '2 h' },
];
const HOST_TIMEOUTS: ReadonlyArray<{ value: string; label: string; labelKey?: TranslationKey }> = [
  { value: '', label: '', labelKey: 'scan.noLimit' },
  { value: '15000', label: '15 s' },
  { value: '30000', label: '30 s' },
  { value: '60000', label: '1 min' },
  { value: '120000', label: '2 min' },
  { value: '300000', label: '5 min' },
] as const;
const STATUS_KEY = 'nmap-atlas:status-dismissed';
const KNOWN_FLAGS = new Set<string>([
  ...PROFILES.flatMap((item) => item.flags),
  ...OPTION_GROUPS.flatMap((group) => group.options.map((option) => option.flag)),
]);
const defaultOptionsFor = (profileId: string) =>
  new Set(PROFILES.find((item) => item.id === profileId)?.flags ?? []);

/** Perfil con el que se abre el formulario, teniendo en cuenta lo recordado. */
const initialProfileFor = (remember: RememberSettings, saved: Partial<RememberedForm>) => {
  const profile = saved.profile;
  return remember.profile && typeof profile === 'string' && PROFILES.some((item) => item.id === profile)
    ? profile
    : DEFAULT_FORM_VALUES.profile;
};

const newScanId = () =>
  globalThis.crypto?.randomUUID?.() ?? `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const formatElapsed = (ms: number) => {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours
    ? `${hours}h ${minutes}m ${seconds}s`
    : minutes
      ? `${minutes}m ${seconds}s`
      : `${seconds}s`;
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function ScanForm({ status, onLoad }: Props) {
  const { t, formatNumber } = useI18n();
  const [remember] = useState(loadRememberSettings);
  const [rememberedForm] = useState<Partial<RememberedForm>>(loadRememberedForm);
  const initialProfile = initialProfileFor(remember, rememberedForm);
  const [target, setTarget] = useState(() =>
    remember.target && typeof rememberedForm.target === 'string'
      ? rememberedForm.target
      : DEFAULT_FORM_VALUES.target,
  );
  const [profile, setProfile] = useState<string>(initialProfile);
  const [ports, setPorts] = useState(() =>
    remember.ports && typeof rememberedForm.ports === 'string'
      ? rememberedForm.ports
      : DEFAULT_FORM_VALUES.ports,
  );
  const [timing, setTiming] = useState<string>(() =>
    remember.timing && typeof rememberedForm.timing === 'string'
      ? rememberedForm.timing
      : initialProfile === 'hosts'
        ? '-T5'
        : DEFAULT_FORM_VALUES.timing,
  );
  const [options, setOptions] = useState<Set<string>>(() => {
    const saved = rememberedForm.options;
    if (remember.options && Array.isArray(saved)) {
      return new Set(
        saved.filter((flag): flag is string => typeof flag === 'string' && KNOWN_FLAGS.has(flag)),
      );
    }
    return defaultOptionsFor(initialProfile);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showIpcCalc, setShowIpcCalc] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState(() =>
    remember.timeout && typeof rememberedForm.timeout === 'string'
      ? rememberedForm.timeout
      : DEFAULT_FORM_VALUES.timeout,
  );
  const [hostTimeoutMs, setHostTimeoutMs] = useState(() =>
    remember.hostTimeout && typeof rememberedForm.hostTimeout === 'string'
      ? rememberedForm.hostTimeout
      : DEFAULT_FORM_VALUES.hostTimeout,
  );
  const [scanId, setScanId] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [progress, setProgress] = useState<ScanProgress>({
    bytes: 0,
    hostHints: 0,
    hosts: 0,
    log: [],
  });
  const logRef = useRef<HTMLDivElement>(null);
  const [cancelling, setCancelling] = useState(false);
  const [dismissedStatus, setDismissedStatus] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STATUS_KEY);
    } catch {
      return null;
    }
  });
  const [tooltip, setTooltip] = useState<OptionTooltip | null>(null);
  const tooltipTimer = useRef<number | null>(null);
  const tooltipShowTimer = useRef<number | null>(null);

  const autoCommand = useMemo(() => {
    const flags = [
      ...(hostTimeoutMs ? ['--host-timeout', `${hostTimeoutMs}ms`] : []),
      ...options,
      timing,
    ];
    if (ports.trim() && !options.has('-p-')) flags.push('-p', ports.trim());
    return [status?.nmapCommand || 'nmap', ...flags, '-oX', '-', target.trim() || t('scan.targetPlaceholderCommand')].join(' ');
  }, [target, ports, timing, options, hostTimeoutMs, status?.nmapCommand, t]);
  const [command, setCommand] = useState(autoCommand);

  const largeDiscovery = useMemo(() => {
    if (!(profile === 'hosts' || options.has('-sn') || /(^|\s)-sn(\s|$)/.test(command))) return null;
    const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(target.trim());
    if (!match) return null;
    const prefix = Number(match[2]);
    if (prefix > 20) return null;
    return { prefix, count: 2 ** (32 - prefix) };
  }, [target, profile, options, command]);

  useEffect(() => { setCommand(autoCommand); }, [autoCommand]);

  useEffect(() => {
    if (!busy) {
      setElapsedMs(0);
      return;
    }
    const start = Date.now();
    const timer = window.setInterval(() => setElapsedMs(Date.now() - start), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (!busy || !scanId) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/scan/progress?id=${encodeURIComponent(scanId)}`);
        if (!response.ok) return;
        const data = (await response.json()) as ScanProgress & { ok: boolean };
        if (active && data.ok) {
          setProgress({
            bytes: data.bytes,
            hostHints: data.hostHints,
            hosts: data.hosts,
            log: Array.isArray(data.log) ? data.log : [],
          });
        }
      } catch {
        // Si falla el sondeo, el escaneo sigue y se vuelve a intentar.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [busy, scanId]);

  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [progress.log.length]);

  useEffect(() => {
    if (!tooltip) return;
    const close = () => {
      if (tooltipTimer.current !== null) window.clearTimeout(tooltipTimer.current);
      if (tooltipShowTimer.current !== null) window.clearTimeout(tooltipShowTimer.current);
      setTooltip(null);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [tooltip]);

  useEffect(() => () => {
    if (tooltipTimer.current !== null) window.clearTimeout(tooltipTimer.current);
    if (tooltipShowTimer.current !== null) window.clearTimeout(tooltipShowTimer.current);
  }, []);

  useEffect(() => {
    const saved: Partial<RememberedForm> = {};
    if (remember.target) saved.target = target;
    if (remember.ports) saved.ports = ports;
    if (remember.profile) saved.profile = profile;
    if (remember.timeout) saved.timeout = timeoutMs;
    if (remember.hostTimeout) saved.hostTimeout = hostTimeoutMs;
    if (remember.timing) saved.timing = timing;
    if (remember.options) saved.options = [...options];
    saveRememberedForm(remember, saved);
  }, [remember, target, ports, profile, timeoutMs, hostTimeoutMs, timing, options]);

  const showOptionTooltip = (option: ScanOption, element: HTMLElement) => {
    if (tooltipTimer.current !== null) {
      window.clearTimeout(tooltipTimer.current);
      tooltipTimer.current = null;
    }
    if (tooltipShowTimer.current !== null) window.clearTimeout(tooltipShowTimer.current);
    // Solo aparece si el ratón se queda medio segundo sobre la opción: al recorrer
    // las opciones hacia el enlace no se van abriendo tooltips intermedios.
    tooltipShowTimer.current = window.setTimeout(() => {
      tooltipShowTimer.current = null;
      const rect = element.getBoundingClientRect();
      const width = 340;
      const margin = 12;
      const gap = 10;
      const x = Math.min(
        Math.max(margin, rect.left + rect.width / 2 - width / 2),
        Math.max(margin, window.innerWidth - width - margin),
      );
      const placement = rect.top > 240 ? 'top' : 'bottom';
      setTooltip({
        option,
        x,
        y: placement === 'top' ? rect.top - gap : rect.bottom + gap,
        placement,
      });
    }, 500);
  };

  const hideOptionTooltip = () => {
    if (tooltipShowTimer.current !== null) {
      window.clearTimeout(tooltipShowTimer.current);
      tooltipShowTimer.current = null;
    }
    if (tooltipTimer.current !== null) window.clearTimeout(tooltipTimer.current);
    tooltipTimer.current = window.setTimeout(() => setTooltip(null), 200);
  };

  const hideOptionTooltipNow = () => {
    if (tooltipTimer.current !== null) {
      window.clearTimeout(tooltipTimer.current);
      tooltipTimer.current = null;
    }
    if (tooltipShowTimer.current !== null) {
      window.clearTimeout(tooltipShowTimer.current);
      tooltipShowTimer.current = null;
    }
    setTooltip(null);
  };

  const keepOptionTooltip = () => {
    if (tooltipTimer.current !== null) {
      window.clearTimeout(tooltipTimer.current);
      tooltipTimer.current = null;
    }
    if (tooltipShowTimer.current !== null) {
      window.clearTimeout(tooltipShowTimer.current);
      tooltipShowTimer.current = null;
    }
  };

  const selectProfile = (id: string) => {
    const flags: readonly string[] = PROFILES.find((item) => item.id === id)?.flags ?? [];
    setProfile(id);
    // Los flags sin casilla (p. ej. --max-retries=1) también viajan en options.
    setOptions(new Set(flags));
    if (flags.includes('-p-')) setPorts('');
    if (id === 'hosts') setTiming('-T5');
  };

  const toggleOption = (flag: string) => {
    const wasChecked = options.has(flag);
    setOptions((current) => {
      const next = new Set(current);
      if (next.has(flag)) next.delete(flag);
      else {
        for (const conflicting of EXCLUSIVE_FLAGS[flag] ?? []) next.delete(conflicting);
        // -sL solo enumera objetivos: no admite análisis de puertos ni de servicios.
        if (flag === '-sL') {
          for (const current of [...next]) {
            if (!['-n', '-R', '-6'].includes(current)) next.delete(current);
          }
        }
        next.add(flag);
      }
      return next;
    });
    // «Todos los puertos» y una lista concreta de puertos se excluyen entre sí.
    if (flag === '-p-' && !wasChecked) setPorts('');
  };

  const apiError = async (response: Response) => {
    try {
      const data = (await response.json()) as { error?: string };
      return data.error ?? t('scan.errorStatus', { status: response.status });
    } catch {
      return t('scan.errorStatus', { status: response.status });
    }
  };

  const cancelScan = async () => {
    if (!scanId || cancelling) return;
    setCancelling(true);
    try {
      await fetch('/api/scan/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: scanId }),
      });
    } catch {
      // El escaneo termina igual; el aviso llegará en el XML resultante.
    }
  };

  const runScan = async () => {
    setError('');
    if (status === null) {
      setError(t('scan.runNoServer'));
      return;
    }
    const id = newScanId();
    setScanId(id);
    setProgress({ bytes: 0, hostHints: 0, hosts: 0, log: [] });
    setBusy(true);
    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          profile,
          ports,
          timing,
          options: [...options],
          command,
          timeoutMs: timeoutMs || undefined,
          hostTimeoutMs: hostTimeoutMs || undefined,
          id,
        }),
      });
      if (!response.ok) throw new Error(await apiError(response));
      const result = (await response.json()) as ScanResult;
      const warnings: string[] = [];
      // El stderr del servidor está en español: las regex no deben traducirse.
      if (/Escaneo detenido tras/.test(result.stderr)) {
        warnings.push(t('scan.warningTimeout'));
      } else if (/Escaneo cancelado por el usuario/.test(result.stderr)) {
        warnings.push(t('scan.warningCancelled'));
      } else if (result.exitCode !== 0) {
        warnings.push(t('scan.warningExit', { code: result.exitCode ?? 0 }));
      }
      onLoad(result.xml, result.savedAs ?? `nmap ${target}.xml`, warnings);
      playSuccessSound();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('scan.runError'));
    } finally {
      setBusy(false);
      setScanId(null);
      setCancelling(false);
    }
  };

  const nmapReady = Boolean(status?.nmapAvailable);
  const statusKey = nmapReady
    ? `nmap:${status?.nmapVersion}:${status?.scansDir}:${status?.privileged}`
    : status
      ? `no-nmap:${status.nmapCommand}`
      : 'no-api';

  const dismissStatus = () => {
    setDismissedStatus(statusKey);
    try {
      localStorage.setItem(STATUS_KEY, statusKey);
    } catch {
      // Si el almacenamiento no está disponible, el aviso se oculta igual en esta sesión.
    }
  };

  return (
    <div className="scan-form">
      {dismissedStatus !== statusKey && (
        <div className={`scan-status ${nmapReady ? 'ok' : 'error'}`}>
          {nmapReady ? (
            <>
              <Terminal size={15} />
              <span>
                Nmap <strong>{status?.nmapVersion}</strong> {t('scan.detected')}
                {status?.privileged && t('scan.privileged')}{t('scan.xmlSavedIn')}
                <code>{status?.scansDir}</code>
              </span>
            </>
          ) : (
            <>
              <AlertCircle size={15} />
              <span>
                {status ? t('scan.noNmap') : t('scan.noServer')}
              </span>
            </>
          )}
          <button
            type="button"
            className="icon-button scan-status-close"
            aria-label={t('scan.hideStatus')}
            title={t('scan.hideStatus')}
            onClick={dismissStatus}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="scan-field scan-field-target">
        <label className="scan-label" htmlFor="scan-target">{t('scan.target')}</label>
        <div className="target-row">
          <input
            id="scan-target"
            className="scan-input"
            value={target}
            spellCheck={false}
            placeholder={t('scan.targetPlaceholder')}
            onChange={(event) => setTarget(event.target.value)}
          />
          <button
            type="button"
            className={`btn btn-ghost ipcalc-toggle ${showIpcCalc ? 'active' : ''}`}
            onClick={() => setShowIpcCalc((value) => !value)}
            aria-expanded={showIpcCalc}
            title={t('scan.calcRangeTitle')}
          >
            <Calculator size={15} /> {t('scan.calcRange')}
          </button>
        </div>
        {showIpcCalc && (
          <IpcCalcPanel
            initialTarget={target}
            version={status?.ipcalcVersion}
            onUse={(cidr) => { setTarget(cidr); setShowIpcCalc(false); }}
            onClose={() => setShowIpcCalc(false)}
          />
        )}
        {largeDiscovery && (
          <div className="scan-notice scan-notice-warn" role="note">
            <AlertCircle size={14} />
            <span>
              {t('scan.largeDiscovery', {
                prefix: largeDiscovery.prefix,
                count: formatNumber(largeDiscovery.count),
              })}
            </span>
          </div>
        )}
      </div>

      <div className="scan-field scan-field-profile">
        <label className="scan-label" htmlFor="scan-profile">{t('scan.profile')}</label>
        <select
          id="scan-profile"
          className="scan-input"
          value={profile}
          onChange={(event) => selectProfile(event.target.value)}
        >
          {PROFILES.map((item) => (
            <option key={item.id} value={item.id}>{t(item.labelKey)} — {t(item.hintKey)}</option>
          ))}
        </select>
      </div>

      <div className="scan-field scan-field-timing">
        <label className="scan-label" htmlFor="scan-timing">{t('scan.timing')}</label>
        <select
          id="scan-timing"
          className="scan-input"
          value={timing}
          onChange={(event) => setTiming(event.target.value)}
        >
          {TIMINGS.map((value) => (
            <option key={value} value={value}>{value.replace('-T', 'T')}</option>
          ))}
        </select>
      </div>

      <div className="scan-field scan-field-timeout">
        <label className="scan-label" htmlFor="scan-timeout">{t('scan.timeout')}</label>
        <select
          id="scan-timeout"
          className="scan-input"
          value={timeoutMs}
          onChange={(event) => setTimeoutMs(event.target.value)}
        >
          {TIMEOUTS.map((item) => (
            <option key={item.value} value={item.value}>{item.labelKey ? t(item.labelKey) : item.label}</option>
          ))}
        </select>
      </div>

      <div className="scan-field scan-field-hosttimeout">
        <label className="scan-label" htmlFor="scan-host-timeout">{t('scan.hostTimeout')}</label>
        <select
          id="scan-host-timeout"
          className="scan-input"
          value={hostTimeoutMs}
          onChange={(event) => setHostTimeoutMs(event.target.value)}
        >
          {HOST_TIMEOUTS.map((item) => (
            <option key={item.value} value={item.value}>{item.labelKey ? t(item.labelKey) : item.label}</option>
          ))}
        </select>
      </div>

      <div className="scan-field scan-field-ports">
        <label className="scan-label" htmlFor="scan-ports">{t('scan.ports')}</label>
        <input
          id="scan-ports"
          className="scan-input"
          value={ports}
          spellCheck={false}
          placeholder={t('scan.portsPlaceholder')}
          onChange={(event) => {
            setPorts(event.target.value);
            if (event.target.value.trim()) {
              setOptions((current) => {
                if (!current.has('-p-')) return current;
                const next = new Set(current);
                next.delete('-p-');
                return next;
              });
            }
          }}
        />
      </div>

      <fieldset className="scan-options">
        <legend>{t('scan.additionalOptions')}</legend>
        <div className="scan-option-groups">
          {OPTION_GROUPS.map((group) => (
            <section className="scan-option-group" key={group.titleKey}>
              <h4 className="scan-option-group-title">{t(group.titleKey)}</h4>
              <div className="scan-option-grid">
                {group.options.map((option) => (
                  <label
                    key={option.flag}
                    className="scan-check"
                    onMouseEnter={(event) => showOptionTooltip(option, event.currentTarget)}
                    onMouseLeave={hideOptionTooltip}
                    onFocus={(event) => showOptionTooltip(option, event.currentTarget)}
                    onBlur={hideOptionTooltipNow}
                  >
                    <input
                      type="checkbox"
                      checked={options.has(option.flag)}
                      aria-describedby={`option-doc-${option.flag.replace(/[^A-Za-z0-9]/g, '')}`}
                      onChange={() => toggleOption(option.flag)}
                    />
                    <span><code>{option.flag}</code> {t(option.labelKey)}</span>
                    <span id={`option-doc-${option.flag.replace(/[^A-Za-z0-9]/g, '')}`} className="sr-only">
                      {t(option.docKey)}
                    </span>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
      </fieldset>

      <div className="command-preview">
        <span>{t('scan.command')}</span>
        <textarea
          className="command-input"
          value={command}
          spellCheck={false}
          rows={1}
          aria-label={t('scan.command')}
          onChange={(event) => setCommand(event.target.value)}
        />
      </div>

      {error && (
        <div className="error-banner scan-error" role="alert">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="scan-actions">
        <button
          className="btn btn-primary scan-run"
          disabled={!command.trim() || status === undefined || busy}
          onClick={() => void runScan()}
        >
          {busy ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />}
          {busy ? t('scan.running') : t('scan.run')}
        </button>
        {busy && (
          <>
            <span className="scan-elapsed">
              {formatElapsed(elapsedMs)} · {t('scan.limit', {
                label: (() => {
                  const item = TIMEOUTS.find((entry) => entry.value === timeoutMs);
                  return item?.labelKey ? t(item.labelKey) : (item?.label ?? t('scan.defaultShort'));
                })(),
              })}
            </span>
            <button
              type="button"
              className="btn btn-ghost scan-cancel"
              onClick={() => void cancelScan()}
              disabled={cancelling}
            >
              <X size={15} /> {cancelling ? t('scan.cancelling') : t('scan.cancel')}
            </button>
          </>
        )}
      </div>

      {busy && (
        <div className="scan-progress">
          <div className="scan-progress-head">
            <span>
              {progress.hosts > 0
                ? t('scan.progressHosts')
                : progress.hostHints > 0
                  ? t('scan.progressDiscovery')
                  : t('scan.progressPreparing')}
            </span>
            <code>{formatBytes(progress.bytes)}</code>
          </div>
          <div className="scan-progress-track"><i /></div>
          <div className="scan-log" ref={logRef} role="log" aria-live="polite" aria-label={t('scan.log')}>
            {progress.log.length === 0 && <div className="scan-log-empty">{t('scan.logEmpty')}</div>}
            {progress.log.map((line, index) => {
              const match = /^(\d{2}:\d{2}:\d{2})  (.*)$/.exec(line);
              return (
                <div className="scan-log-line" key={index}>
                  {match ? (
                    <>
                      <time>{match[1]}</time>
                      <span>{match[2]}</span>
                    </>
                  ) : (
                    <span>{line}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tooltip && (
        <div
          id="scan-option-tooltip"
          className={`scan-tooltip ${tooltip.placement}`}
          role="tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
          onMouseEnter={keepOptionTooltip}
          onMouseLeave={hideOptionTooltip}
        >
          <strong><code>{tooltip.option.flag}</code> {t(tooltip.option.labelKey)}</strong>
          <p>{t(tooltip.option.docKey)}</p>
          <a href={tooltip.option.docsUrl} target="_blank" rel="noreferrer">
            {t('scan.tooltipManual')}
          </a>
        </div>
      )}
    </div>
  );
}
