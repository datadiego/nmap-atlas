import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Calculator, LoaderCircle, Play, Terminal, X } from 'lucide-react';
import type { ApiStatus, ScanResult } from '../types';
import { playSuccessSound } from '../audio';
import {
  DEFAULT_FORM_VALUES,
  loadRememberedForm,
  loadRememberSettings,
  saveRememberedForm,
  type RememberedForm,
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
  label: string;
  doc: string;
  docsUrl: string;
}

interface OptionTooltip {
  option: ScanOption;
  x: number;
  y: number;
  placement: 'top' | 'bottom';
}

const PROFILES = [
  { id: 'quick', label: 'Rápido', flags: ['-F', '--open'], hint: '100 puertos comunes, solo abiertos' },
  { id: 'hosts', label: 'Detectar hosts', flags: ['-sn', '-n', '--max-retries=1'], hint: 'Descubrimiento rápido, sin escanear puertos' },
  { id: 'service', label: 'Servicios', flags: ['-sV', '-sC', '--open'], hint: 'Versión + scripts NSE' },
  { id: 'full', label: 'Completo', flags: ['-sV', '-sC', '-O', '-p-'], hint: 'Todos los puertos + SO' },
  { id: 'custom', label: 'Personalizado', flags: [], hint: 'Solo las opciones marcadas' },
] as const;

const OPTION_GROUPS: { title: string; options: ScanOption[] }[] = [
  {
    title: 'Técnica de escaneo',
    options: [
      {
        flag: '-sS', label: 'SYN (requiere root)',
        doc: 'Escaneo TCP SYN (half-open): envía un SYN sin completar la conexión. Es rápido, discreto y distingue puertos abiertos, cerrados y filtrados. Necesita permisos para enviar paquetes crudos.',
        docsUrl: 'https://nmap.org/book/man-port-scanning-techniques.html',
      },
      {
        flag: '-sT', label: 'Connect TCP',
        doc: 'Escaneo TCP connect(): usa la llamada connect del sistema operativo. Es la alternativa cuando no puedes enviar paquetes crudos, aunque es más lento y los equipos suelen registrar la conexión.',
        docsUrl: 'https://nmap.org/book/man-port-scanning-techniques.html',
      },
      {
        flag: '-sU', label: 'UDP',
        doc: 'Escaneo UDP: envía datagramas y clasifica los puertos según las respuestas ICMP. Puede combinarse con un escaneo TCP, pero es lento y muchos sistemas limitan esos mensajes.',
        docsUrl: 'https://nmap.org/book/man-port-scanning-techniques.html',
      },
      {
        flag: '-sn', label: 'Solo hosts',
        doc: 'Descubre qué hosts responden sin escanear sus puertos (ping scan). Útil para inventariar una red o vigilar su disponibilidad; admite combinarse con otras sondas de descubrimiento.',
        docsUrl: 'https://nmap.org/book/man-host-discovery.html',
      },
      {
        flag: '-sL', label: 'Solo listar',
        doc: 'List scan: enumera los objetivos sin enviarles paquetes. Por defecto hace DNS inverso; sirve para comprobar un rango antes de lanzar un escaneo real.',
        docsUrl: 'https://nmap.org/book/man-host-discovery.html',
      },
      {
        flag: '-A', label: 'Agresivo',
        doc: 'Activa a la vez detección de SO (-O), versiones (-sV), scripts NSE (-sC) y traceroute. Es más intrusivo: úsalo solo en redes con permiso.',
        docsUrl: 'https://nmap.org/book/man-misc-options.html',
      },
    ],
  },
  {
    title: 'Servicios y SO',
    options: [
      {
        flag: '-sV', label: 'Versión de servicios',
        doc: 'Interroga los puertos abiertos para identificar protocolo, aplicación, versión, tipo de dispositivo y CPE usando la base de sondas nmap-service-probes.',
        docsUrl: 'https://nmap.org/book/man-version-detection.html',
      },
      {
        flag: '--version-light', label: 'Versiones ligera',
        doc: 'Atajo para --version-intensity 2: usa solo las sondas más habituales. Acelera la detección de versiones a costa de identificar menos servicios.',
        docsUrl: 'https://nmap.org/book/man-version-detection.html',
      },
      {
        flag: '-sC', label: 'Scripts NSE',
        doc: 'Ejecuta los scripts del conjunto por defecto del motor NSE (equivalente a --script=default). Algunos se consideran intrusivos: no los uses contra redes ajenas sin permiso.',
        docsUrl: 'https://nmap.org/book/man-nse.html',
      },
      {
        flag: '-O', label: 'Detección de SO',
        doc: 'Determina el sistema operativo remoto mediante la huella de la pila TCP/IP: compara las respuestas con nmap-os-db y muestra el SO probable y su CPE.',
        docsUrl: 'https://nmap.org/book/man-os-detection.html',
      },
      {
        flag: '--osscan-limit', label: 'Limitar detección SO',
        doc: 'Limita -O a hosts con al menos un puerto abierto y otro cerrado. Ahorra bastante tiempo, sobre todo en escaneos -Pn con muchos hosts.',
        docsUrl: 'https://nmap.org/book/man-os-detection.html',
      },
    ],
  },
  {
    title: 'Descubrimiento y puertos',
    options: [
      {
        flag: '-Pn', label: 'Sin ping previo',
        doc: 'Omite el descubrimiento de hosts y trata como activa cada dirección objetivo, aplicando el escaneo solicitado a todas. En un rango grande puede tardar mucho.',
        docsUrl: 'https://nmap.org/book/man-host-discovery.html',
      },
      {
        flag: '-PE', label: 'Ping ICMP',
        doc: 'Descubrimiento mediante ICMP echo (el ping clásico). Muchos hosts y firewalls bloquean estas peticiones, así que conviene combinarlo con otras sondas.',
        docsUrl: 'https://nmap.org/book/man-host-discovery.html',
      },
      {
        flag: '-F', label: 'Escaneo rápido',
        doc: 'Escanea solo los 100 puertos más frecuentes en lugar de los 1.000 por defecto, según los datos de nmap-services.',
        docsUrl: 'https://nmap.org/book/man-port-specification.html',
      },
      {
        flag: '-p-', label: 'Todos los puertos',
        doc: 'Equivale a -p 1-65535: escanea todos los puertos en lugar del rango habitual. Es mucho más lento, especialmente en varios hosts.',
        docsUrl: 'https://nmap.org/book/man-port-specification.html',
      },
      {
        flag: '--max-retries=1', label: 'Menos reintentos',
        doc: 'Reduce a uno las retransmisiones de las sondas de puertos. Acelera mucho los escaneos de hosts con limitación de velocidad, pero puede dejar puertos sin detectar.',
        docsUrl: 'https://nmap.org/book/man-performance.html',
      },
    ],
  },
  {
    title: 'DNS, red y salida',
    options: [
      {
        flag: '-n', label: 'Sin resolución DNS',
        doc: 'Nunca hace resolución DNS inversa de las IPs activas. Ahorra tiempo en rangos grandes, aunque se pierden los nombres de host en los resultados.',
        docsUrl: 'https://nmap.org/book/man-target-specification.html',
      },
      {
        flag: '-R', label: 'Resolver todas las IPs',
        doc: 'Fuerza la resolución DNS inversa de todas las direcciones objetivo, incluso de las que no responden. Es lo contrario de -n y puede añadir mucho tiempo.',
        docsUrl: 'https://nmap.org/book/man-target-specification.html',
      },
      {
        flag: '-6', label: 'IPv6',
        doc: 'Activa el escaneo IPv6 para las funciones habituales (descubrimiento, puertos, versiones y NSE). El objetivo debe indicarse con sintaxis IPv6 o como nombre de host.',
        docsUrl: 'https://nmap.org/book/man-misc-options.html',
      },
      {
        flag: '--open', label: 'Solo abiertos',
        doc: 'Muestra únicamente hosts con algún puerto abierto, abierto|filtrado o no filtrado, y solo esos puertos. Oculta los estados cerrado y filtrado para reducir el ruido.',
        docsUrl: 'https://nmap.org/book/man-output.html',
      },
      {
        flag: '--traceroute', label: 'Traceroute',
        doc: 'Traza la ruta hasta cada host tras el escaneo, usando el puerto y protocolo con más probabilidades de llegar. No funciona con connect (-sT) ni con idle (-sI).',
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
const TIMEOUTS = [
  { value: '', label: 'Por defecto (CLI)' },
  { value: '300000', label: '5 min' },
  { value: '900000', label: '15 min' },
  { value: '1800000', label: '30 min' },
  { value: '3600000', label: '1 h' },
  { value: '7200000', label: '2 h' },
] as const;
const HOST_TIMEOUTS = [
  { value: '', label: 'Sin límite' },
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
  const [remember] = useState(loadRememberSettings);
  const [rememberedForm] = useState<Partial<RememberedForm>>(loadRememberedForm);
  const [target, setTarget] = useState(() =>
    remember.target && typeof rememberedForm.target === 'string'
      ? rememberedForm.target
      : DEFAULT_FORM_VALUES.target,
  );
  const [profile, setProfile] = useState<string>(() => {
    const saved = rememberedForm.profile;
    return remember.profile && typeof saved === 'string' && PROFILES.some((item) => item.id === saved)
      ? saved
      : DEFAULT_FORM_VALUES.profile;
  });
  const [ports, setPorts] = useState(() =>
    remember.ports && typeof rememberedForm.ports === 'string'
      ? rememberedForm.ports
      : DEFAULT_FORM_VALUES.ports,
  );
  const [timing, setTiming] = useState<string>(() =>
    remember.timing && typeof rememberedForm.timing === 'string'
      ? rememberedForm.timing
      : DEFAULT_FORM_VALUES.timing,
  );
  const [options, setOptions] = useState<Set<string>>(() => {
    const saved = rememberedForm.options;
    if (remember.options && Array.isArray(saved)) {
      return new Set(
        saved.filter((flag): flag is string => typeof flag === 'string' && KNOWN_FLAGS.has(flag)),
      );
    }
    return defaultOptionsFor(DEFAULT_FORM_VALUES.profile);
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
    return [status?.nmapCommand || 'nmap', ...flags, '-oX', '-', target.trim() || '<objetivo>'].join(' ');
  }, [target, ports, timing, options, hostTimeoutMs, status?.nmapCommand]);
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
      return data.error ?? `Error ${response.status}`;
    } catch {
      return `Error ${response.status}`;
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
      setError('No hay conexión con el servidor local. Inicia Nmap Atlas desde la CLI para escanear.');
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
      if (/Escaneo detenido tras/.test(result.stderr)) {
        warnings.push('El escaneo se detuvo por el tiempo límite; se ha cargado la parte capturada.');
      } else if (/Escaneo cancelado por el usuario/.test(result.stderr)) {
        warnings.push('Escaneo cancelado; se ha cargado la parte capturada.');
      } else if (result.exitCode !== 0) {
        warnings.push(`nmap terminó con código ${result.exitCode}; el XML puede estar incompleto.`);
      }
      onLoad(result.xml, result.savedAs ?? `nmap ${target}.xml`, warnings);
      playSuccessSound();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo ejecutar el escaneo.');
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
                Nmap <strong>{status?.nmapVersion}</strong> detectado
                {status?.privileged && ' (con permisos elevados)'} · los XML se guardan en{' '}
                <code>{status?.scansDir}</code>
              </span>
            </>
          ) : (
            <>
              <AlertCircle size={15} />
              <span>
                {status
                  ? 'No se encontró el ejecutable nmap. Instálalo y reinicia la CLI.'
                  : 'No se pudo conectar con el servidor local. Inicia Nmap Atlas desde la CLI para escanear.'}
              </span>
            </>
          )}
          <button
            type="button"
            className="icon-button scan-status-close"
            aria-label="Ocultar aviso"
            title="Ocultar aviso"
            onClick={dismissStatus}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="scan-field scan-field-target">
        <label className="scan-label" htmlFor="scan-target">Objetivo</label>
        <div className="target-row">
          <input
            id="scan-target"
            className="scan-input"
            value={target}
            spellCheck={false}
            placeholder="127.0.0.1  ·  192.168.1.0/24  ·  ejemplo.local"
            onChange={(event) => setTarget(event.target.value)}
          />
          <button
            type="button"
            className={`btn btn-ghost ipcalc-toggle ${showIpcCalc ? 'active' : ''}`}
            onClick={() => setShowIpcCalc((value) => !value)}
            aria-expanded={showIpcCalc}
            title="Calcular rangos con ipcalc"
          >
            <Calculator size={15} /> Calcular rango
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
              Un <code>/{largeDiscovery.prefix}</code> son {largeDiscovery.count.toLocaleString('es-ES')} IPs:
              el descubrimiento puede tardar varios minutos. «Tiempo por host» no acelera esta fase.
            </span>
          </div>
        )}
      </div>

      <div className="scan-field scan-field-profile">
        <label className="scan-label" htmlFor="scan-profile">Perfil</label>
        <select
          id="scan-profile"
          className="scan-input"
          value={profile}
          onChange={(event) => selectProfile(event.target.value)}
        >
          {PROFILES.map((item) => (
            <option key={item.id} value={item.id}>{item.label} — {item.hint}</option>
          ))}
        </select>
      </div>

      <div className="scan-field scan-field-timing">
        <label className="scan-label" htmlFor="scan-timing">Velocidad</label>
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
        <label className="scan-label" htmlFor="scan-timeout">Tiempo límite</label>
        <select
          id="scan-timeout"
          className="scan-input"
          value={timeoutMs}
          onChange={(event) => setTimeoutMs(event.target.value)}
        >
          {TIMEOUTS.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
      </div>

      <div className="scan-field scan-field-hosttimeout">
        <label className="scan-label" htmlFor="scan-host-timeout">Tiempo por host</label>
        <select
          id="scan-host-timeout"
          className="scan-input"
          value={hostTimeoutMs}
          onChange={(event) => setHostTimeoutMs(event.target.value)}
        >
          {HOST_TIMEOUTS.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
      </div>

      <div className="scan-field scan-field-ports">
        <label className="scan-label" htmlFor="scan-ports">Puertos (opcional)</label>
        <input
          id="scan-ports"
          className="scan-input"
          value={ports}
          spellCheck={false}
          placeholder="Ej.: 22,80,443 o 1-1024"
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
        <legend>Opciones adicionales</legend>
        <div className="scan-option-groups">
          {OPTION_GROUPS.map((group) => (
            <section className="scan-option-group" key={group.title}>
              <h4 className="scan-option-group-title">{group.title}</h4>
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
                    <span><code>{option.flag}</code> {option.label}</span>
                    <span id={`option-doc-${option.flag.replace(/[^A-Za-z0-9]/g, '')}`} className="sr-only">
                      {option.doc}
                    </span>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
      </fieldset>

      <div className="command-preview">
        <span>Comando que se ejecutará</span>
        <textarea
          className="command-input"
          value={command}
          spellCheck={false}
          rows={1}
          aria-label="Comando que se ejecutará"
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
          {busy ? 'Escaneando…' : 'Ejecutar y analizar'}
        </button>
        {busy && (
          <>
            <span className="scan-elapsed">
              {formatElapsed(elapsedMs)} · límite {TIMEOUTS.find((item) => item.value === timeoutMs)?.label ?? 'por defecto'}
            </span>
            <button
              type="button"
              className="btn btn-ghost scan-cancel"
              onClick={() => void cancelScan()}
              disabled={cancelling}
            >
              <X size={15} /> {cancelling ? 'Cancelando…' : 'Cancelar escaneo'}
            </button>
          </>
        )}
      </div>

      {busy && (
        <div className="scan-progress">
          <div className="scan-progress-head">
            <span>
              {progress.hosts > 0
                ? 'Analizando hosts'
                : progress.hostHints > 0
                  ? 'Descubriendo hosts'
                  : 'Preparando escaneo'}
            </span>
            <code>{formatBytes(progress.bytes)}</code>
          </div>
          <div className="scan-progress-track"><i /></div>
          <div className="scan-log" ref={logRef} role="log" aria-live="polite" aria-label="Log del escaneo">
            {progress.log.length === 0 && <div className="scan-log-empty">Esperando salida de nmap…</div>}
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
          <strong><code>{tooltip.option.flag}</code> {tooltip.option.label}</strong>
          <p>{tooltip.option.doc}</p>
          <a href={tooltip.option.docsUrl} target="_blank" rel="noreferrer">
            Ver en el manual oficial de Nmap ↗
          </a>
        </div>
      )}
    </div>
  );
}
