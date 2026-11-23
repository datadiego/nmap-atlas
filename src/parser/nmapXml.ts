import type {
  ExtraPortGroup,
  ExtraPortReason,
  HostAddress,
  Hostname,
  NmapHost,
  NmapPort,
  NmapScan,
  NmapScript,
  OsClass,
  OsMatch,
  PortState,
  RunStats,
  ScanInfo,
  ServiceInfo,
} from '../types';
import { tGlobal, type TFunction } from '../i18n';

const attr = (el: Element | null | undefined, name: string): string =>
  el?.getAttribute(name) ?? '';

const children = (el: Element | null | undefined, tag: string): Element[] =>
  el ? Array.from(el.children).filter((child) => child.tagName.toLowerCase() === tag) : [];

const child = (el: Element | null | undefined, tag: string): Element | null =>
  children(el, tag)[0] ?? null;

const num = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Convierte el output de un <script> (que puede contener <table>/<elem>) a texto legible. */
function serializeScriptOutput(el: Element): string {
  const lines: string[] = [];

  const walk = (node: Node, depth: number, prefix: string) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim() ?? '';
      if (!text) return;
      text.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (trimmed) lines.push(`${'  '.repeat(depth)}${prefix}${trimmed}`);
      });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    const key = element.getAttribute('key') ?? '';

    if (tag === 'table') {
      if (key) lines.push(`${'  '.repeat(depth)}${key}:`);
      Array.from(element.childNodes).forEach((n) => walk(n, key ? depth + 1 : depth, ''));
      return;
    }
    if (tag === 'elem') {
      const value = element.textContent?.trim() ?? '';
      lines.push(`${'  '.repeat(depth)}${key ? `${key}: ` : ''}${value}`);
      return;
    }
    Array.from(element.childNodes).forEach((n) => walk(n, depth, prefix));
  };

  Array.from(el.childNodes).forEach((n) => walk(n, 0, ''));
  return lines.join('\n');
}

function parseScripts(parent: Element | null): NmapScript[] {
  return children(parent, 'script').map((script) => ({
    id: attr(script, 'id'),
    output: serializeScriptOutput(script),
  }));
}

function parsePort(el: Element): NmapPort {
  const serviceEl = child(el, 'service');
  const service: ServiceInfo | undefined = serviceEl
    ? {
        name: attr(serviceEl, 'name'),
        product: attr(serviceEl, 'product'),
        version: attr(serviceEl, 'version'),
        extraInfo: attr(serviceEl, 'extrainfo'),
        method: attr(serviceEl, 'method'),
        conf: num(attr(serviceEl, 'conf')),
        ostype: attr(serviceEl, 'ostype'),
        devicetype: attr(serviceEl, 'devicetype'),
        cpe: children(serviceEl, 'cpe').map((cpe) => cpe.textContent?.trim() ?? ''),
        scripts: parseScripts(serviceEl),
      }
    : undefined;

  return {
    protocol: attr(el, 'protocol'),
    portId: attr(el, 'portid'),
    state: (attr(child(el, 'state'), 'state') || 'unknown') as PortState,
    reason: attr(child(el, 'state'), 'reason'),
    reasonTtl: attr(child(el, 'state'), 'reason_ttl'),
    service,
    scripts: parseScripts(el),
  };
}

function parseExtraPorts(portsEl: Element | null): ExtraPortGroup[] {
  return children(portsEl, 'extraports').map((group) => {
    const reasons: ExtraPortReason[] = children(group, 'extrareasons').map((reason) => ({
      reason: attr(reason, 'reason'),
      count: num(attr(reason, 'count')),
      proto: attr(reason, 'proto'),
      ports: attr(reason, 'ports'),
    }));
    return {
      state: (attr(group, 'state') || 'unknown') as PortState,
      count: num(attr(group, 'count')),
      reasons,
    };
  });
}

function parseOsMatches(osEl: Element | null): OsMatch[] {
  return children(osEl, 'osmatch').map((match) => ({
    name: attr(match, 'name'),
    accuracy: num(attr(match, 'accuracy')),
    line: attr(match, 'line'),
  }));
}

function parseOsClasses(osEl: Element | null): OsClass[] {
  // Nmap suele poner <osclass> como hermano de <osmatch>, aunque algunos
  // escaneos/versiones lo anidan dentro del propio <osmatch>.
  const direct = children(osEl, 'osclass');
  const nested = children(osEl, 'osmatch').flatMap((match) => children(match, 'osclass'));
  const all = [...direct, ...nested].filter(
    (element, index, array) =>
      array.findIndex((other) => other.outerHTML === element.outerHTML) === index,
  );
  return all.map((osClass) => ({
    type: attr(osClass, 'type'),
    vendor: attr(osClass, 'vendor'),
    osFamily: attr(osClass, 'osfamily'),
    osGen: attr(osClass, 'osgen'),
    accuracy: num(attr(osClass, 'accuracy')),
    cpe: children(osClass, 'cpe').map((cpe) => cpe.textContent?.trim() ?? ''),
  }));
}

function parseHost(el: Element, index: number): NmapHost {
  const addresses: HostAddress[] = children(el, 'address').map((address) => ({
    addr: attr(address, 'addr'),
    type: attr(address, 'addrtype'),
    vendor: attr(address, 'vendor'),
  }));
  const hostnames: Hostname[] = children(child(el, 'hostnames'), 'hostname').map((hostname) => ({
    name: attr(hostname, 'name'),
    type: attr(hostname, 'type'),
  }));
  const portsEl = child(el, 'ports');
  const timesEl = child(el, 'times');

  return {
    key: `host-${index}`,
    start: attr(el, 'starttime'),
    end: attr(el, 'endtime'),
    state: attr(child(el, 'status'), 'state'),
    reason: attr(child(el, 'status'), 'reason'),
    addresses,
    hostnames,
    ports: children(portsEl, 'port').map(parsePort),
    extraPorts: parseExtraPorts(portsEl),
    os: parseOsMatches(child(el, 'os')),
    osClasses: parseOsClasses(child(el, 'os')),
    uptime: attr(child(el, 'uptime'), 'seconds'),
    distance: attr(child(el, 'distance'), 'value'),
    times: timesEl
      ? {
          srtt: attr(timesEl, 'srtt'),
          rttvar: attr(timesEl, 'rttvar'),
          to: attr(timesEl, 'to'),
        }
      : null,
    scripts: parseScripts(child(el, 'hostscript')),
    notes: '',
  };
}

function parseRunStats(doc: Document): RunStats | null {
  const runstats = child(doc.documentElement, 'runstats');
  if (!runstats) return null;
  const hosts = child(runstats, 'hosts');
  const finished = child(runstats, 'finished');
  return {
    hostsUp: num(attr(hosts, 'up')),
    hostsDown: num(attr(hosts, 'down')),
    hostsTotal: num(attr(hosts, 'total')),
    elapsed: attr(finished, 'elapsed'),
    summary: attr(finished, 'summary'),
    finishedStr: attr(finished, 'timestr'),
  };
}

/**
 * Nmap puede dejar XML incompletos si el escaneo se interrumpe. Recorremos las
 * etiquetas y cerramos las que queden abiertas para poder visualizar lo capturado.
 */
function repairTruncatedXml(xml: string): string | null {
  const lastGt = xml.lastIndexOf('>');
  const lastLt = xml.lastIndexOf('<');
  const text = lastLt > lastGt ? xml.slice(0, lastLt) : xml;
  const stack: string[] = [];
  let i = 0;

  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end === -1) break;
      i = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end === -1) break;
      i = end + 3;
      continue;
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end === -1) break;
      i = end + 2;
      continue;
    }
    if (text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }

    const gt = text.indexOf('>', lt + 1);
    if (gt === -1) break;
    const raw = text.slice(lt + 1, gt).trim();
    i = gt + 1;

    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      if (stack[stack.length - 1] === name) stack.pop();
    } else if (!raw.endsWith('/')) {
      const name = raw.split(/[\s/]/)[0];
      if (name) stack.push(name);
    }
  }

  if (stack.length === 0) return null;
  return `${text}\n${stack.reverse().map((name) => `</${name}>`).join('\n')}\n`;
}

/**
 * Detecta un XML de Nmap cortado antes del cierre de <nmaprun>. Se comprueba
 * sobre el contenido, no sobre el mensaje de error del navegador, que varía
 * según el idioma y el motor (Chrome, Firefox, Safari...).
 */
function looksTruncated(xml: string): boolean {
  return /<nmaprun[\s>]/i.test(xml) && !/<\/nmaprun\s*>/i.test(xml);
}

/** Parsea un XML de Nmap. Lanza un Error descriptivo si no es válido. */
export function parseNmapXml(xml: string, filename = '', t: TFunction = tGlobal): NmapScan {
  if (!xml || !xml.trim()) throw new Error(t('parser.xmlEmpty'));

  const warnings: string[] = [];
  let doc = new DOMParser().parseFromString(xml, 'text/xml');
  let parserError = doc.querySelector('parsererror');

  if (parserError && looksTruncated(xml)) {
    // No analizamos el texto del error: cada navegador lo localiza de forma
    // distinta (Chrome habla de "Premature end", Firefox de "elemento raíz").
    const repaired = repairTruncatedXml(xml);
    if (repaired) {
      const repairedDoc = new DOMParser().parseFromString(repaired, 'text/xml');
      if (!repairedDoc.querySelector('parsererror')) {
        doc = repairedDoc;
        parserError = null;
        warnings.push(t('parser.xmlIncomplete'));
      }
    }
  }

  if (parserError) {
    const message = parserError.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    throw new Error(t('parser.xmlInvalid', { message: message.slice(0, 220) }));
  }

  const root = doc.documentElement;
  if (root.tagName.toLowerCase() !== 'nmaprun') {
    throw new Error(t('parser.notNmap'));
  }

  const scanInfos: ScanInfo[] = children(root, 'scaninfo').map((info) => ({
    type: attr(info, 'type'),
    protocol: attr(info, 'protocol'),
    numServices: num(attr(info, 'numservices')),
    services: attr(info, 'services'),
  }));

  return {
    scanner: attr(root, 'scanner') || 'nmap',
    args: attr(root, 'args'),
    start: attr(root, 'start'),
    startstr: attr(root, 'startstr'),
    version: attr(root, 'version'),
    xmloutputversion: attr(root, 'xmloutputversion'),
    scanInfos,
    hosts: children(root, 'host').map(parseHost),
    runStats: parseRunStats(doc),
    filename,
    rawSize: new Blob([xml]).size,
    warnings,
  };
}

/** Subred /24 (o /48 en IPv6) a la que pertenece un host; se usa para agrupar nodos. */
export function subnetOf(host: NmapHost, t: TFunction = tGlobal): string {
  const ipv4 = host.addresses.find((address) => address.type === 'ipv4')?.addr;
  if (ipv4) {
    const octets = ipv4.split('.');
    if (octets.length === 4) return `${octets.slice(0, 3).join('.')}.0/24`;
  }

  const ipv6 = host.addresses.find((address) => address.type === 'ipv6')?.addr;
  if (ipv6) {
    const groups = ipv6.split(':').filter(Boolean);
    if (groups.length >= 3) return `${groups.slice(0, 3).join(':')}::/48`;
    return `${ipv6}/48`;
  }

  const mac = host.addresses.find((address) => address.type === 'mac');
  return mac ? t('parser.noIp') : t('parser.noAddress');
}

/** Nombre legible preferido para un host. */
export function hostLabel(host: NmapHost, t: TFunction = tGlobal): string {
  const named = host.hostnames.find((hostname) => hostname.name && hostname.type !== 'PTR');
  if (named) return named.name;
  if (host.hostnames[0]?.name) return host.hostnames[0].name;
  return host.addresses[0]?.addr ?? t('parser.hostFallback', { key: host.key });
}
