import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { byteLength } from '../../core/fs.mjs';
import { ValidationError } from '../errors.mjs';

/**
 * Parser del XML de Nmap, ejecutado en el servidor.
 * Produce el JSON que consume el cliente; SQLite es la única fuente de verdad.
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  isArray: (name) => [
    'host', 'port', 'address', 'hostname', 'script', 'cpe', 'extraports',
    'extrareasons', 'osmatch', 'osclass', 'scaninfo', 'atlas-note',
    'trace', 'hop',
  ].includes(name),
});

const asArray = (value) => value === undefined || value === null
  ? []
  : Array.isArray(value) ? value : [value];

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const attr = (node, name) => decodeXml(node?.[`@_${name}`] ?? '');
const num = (value) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

function textOf(node) {
  if (typeof node === 'string' || typeof node === 'number') return decodeXml(node).trim();
  if (!node || typeof node !== 'object') return '';
  if (Array.isArray(node)) return node.map(textOf).filter(Boolean).join('\n');
  return decodeXml(node['#text'] ?? '').trim();
}

function serializeScriptOutput(node, depth = 0, inheritedKey = '') {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string' || typeof node === 'number') {
    const value = decodeXml(node).trim();
    return value ? `${'  '.repeat(depth)}${inheritedKey ? `${inheritedKey}: ` : ''}${value}` : '';
  }
  if (Array.isArray(node)) {
    return node.map((item) => serializeScriptOutput(item, depth, inheritedKey)).filter(Boolean).join('\n');
  }

  const lines = [];
  const key = attr(node, 'key') || inheritedKey;
  const ownText = textOf(node['#text']);
  if (ownText) {
    ownText.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (trimmed) lines.push(`${'  '.repeat(depth)}${key ? `${key}: ` : ''}${trimmed}`);
    });
  }

  for (const [tag, value] of Object.entries(node)) {
    if (tag.startsWith('@_') || tag === '#text') continue;
    if (tag === 'table') {
      const tableKey = attr(value, 'key') || key;
      if (tableKey) lines.push(`${'  '.repeat(depth)}${tableKey}:`);
      const inner = serializeScriptOutput(value, tableKey ? depth + 1 : depth, '');
      if (inner) lines.push(inner);
      continue;
    }
    if (tag === 'elem') {
      const elemKey = attr(value, 'key');
      const elementValue = textOf(value);
      if (elementValue) {
        lines.push(`${'  '.repeat(depth)}${elemKey ? `${elemKey}: ` : ''}${elementValue}`);
      }
      continue;
    }
    const inner = serializeScriptOutput(value, depth, key);
    if (inner) lines.push(inner);
  }

  if (!lines.length) {
    const raw = attr(node, 'output');
    if (raw) lines.push(`${'  '.repeat(depth)}${key ? `${key}: ` : ''}${raw}`);
  }
  return lines.join('\n');
}

function parseScripts(parent) {
  return asArray(parent?.script).map((script) => ({
    id: attr(script, 'id'),
    output: serializeScriptOutput(script) || attr(script, 'output'),
  }));
}

function parseService(el) {
  const service = asArray(el?.service)[0];
  if (!service) return undefined;
  return {
    name: attr(service, 'name'),
    product: attr(service, 'product'),
    version: attr(service, 'version'),
    extraInfo: attr(service, 'extrainfo'),
    method: attr(service, 'method'),
    conf: num(attr(service, 'conf')),
    ostype: attr(service, 'ostype'),
    devicetype: attr(service, 'devicetype'),
    cpe: asArray(service.cpe).map((item) => textOf(item)),
    scripts: parseScripts(service),
  };
}

function parsePort(el) {
  const state = asArray(el.state)[0];
  return {
    protocol: attr(el, 'protocol'),
    portId: String(attr(el, 'portid')),
    state: attr(state, 'state') || 'unknown',
    reason: attr(state, 'reason'),
    reasonTtl: attr(state, 'reason_ttl'),
    service: parseService(el),
    scripts: parseScripts(el),
  };
}

function parseExtraPorts(portsEl) {
  return asArray(portsEl?.extraports).map((group) => ({
    state: attr(group, 'state') || 'unknown',
    count: num(attr(group, 'count')),
    reasons: asArray(group.extrareasons).map((reason) => ({
      reason: attr(reason, 'reason'),
      count: num(attr(reason, 'count')),
      proto: attr(reason, 'proto'),
      ports: attr(reason, 'ports'),
    })),
  }));
}

function parseOs(osEl) {
  const matches = asArray(osEl?.osmatch);
  const directClasses = asArray(osEl?.osclass);
  const nestedClasses = matches.flatMap((match) => asArray(match.osclass));
  const seen = new Set();
  const classes = [...directClasses, ...nestedClasses].filter((osClass) => {
    const key = JSON.stringify(osClass);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    os: matches.map((match) => ({
      name: attr(match, 'name'),
      accuracy: num(attr(match, 'accuracy')),
      line: attr(match, 'line'),
    })),
    osClasses: classes.map((osClass) => ({
      type: attr(osClass, 'type'),
      vendor: attr(osClass, 'vendor'),
      osFamily: attr(osClass, 'osfamily'),
      osGen: attr(osClass, 'osgen'),
      accuracy: num(attr(osClass, 'accuracy')),
      cpe: asArray(osClass.cpe).map((item) => textOf(item)),
    })),
  };
}

function parseTraces(el) {
  return asArray(el.trace).map((trace) => ({
    port: attr(trace, 'port'),
    proto: attr(trace, 'proto'),
    hops: asArray(trace.hop).map((hop) => ({
      ttl: num(attr(hop, 'ttl')),
      ipaddr: attr(hop, 'ipaddr'),
      rtt: attr(hop, 'rtt'),
      host: attr(hop, 'host'),
    })),
  }));
}

function parseHost(el, index) {
  const noteEl = asArray(el['atlas-note'])[0];
  const times = asArray(el.times)[0];
  const { os, osClasses } = parseOs(asArray(el.os)[0]);

  return {
    key: `host-${index}`,
    start: attr(el, 'starttime'),
    end: attr(el, 'endtime'),
    state: attr(asArray(el.status)[0], 'state'),
    reason: attr(asArray(el.status)[0], 'reason'),
    addresses: asArray(el.address).map((address) => ({
      addr: attr(address, 'addr'),
      type: attr(address, 'addrtype'),
      vendor: attr(address, 'vendor'),
    })),
    hostnames: asArray(asArray(el.hostnames)[0]?.hostname).map((hostname) => ({
      name: attr(hostname, 'name'),
      type: attr(hostname, 'type'),
    })),
    ports: asArray(asArray(el.ports)[0]?.port).map(parsePort),
    extraPorts: parseExtraPorts(asArray(el.ports)[0]),
    os,
    osClasses,
    uptime: attr(asArray(el.uptime)[0], 'seconds'),
    distance: attr(asArray(el.distance)[0], 'value'),
    times: times
      ? {
          srtt: attr(times, 'srtt'),
          rttvar: attr(times, 'rttvar'),
          to: attr(times, 'to'),
        }
      : null,
    traces: parseTraces(el),
    scripts: parseScripts(asArray(el.hostscript)[0]),
    notes: textOf(noteEl),
  };
}

function parseRunStats(root) {
  const runstats = asArray(root?.runstats)[0];
  if (!runstats) return null;
  const hosts = asArray(runstats.hosts)[0];
  const finished = asArray(runstats.finished)[0];
  return {
    hostsUp: num(attr(hosts, 'up')),
    hostsDown: num(attr(hosts, 'down')),
    hostsTotal: num(attr(hosts, 'total')),
    elapsed: attr(finished, 'elapsed'),
    summary: attr(finished, 'summary'),
    finishedStr: attr(finished, 'timestr'),
  };
}

function looksTruncated(xml) {
  return /<nmaprun[\s>]/i.test(xml) && !/<\/nmaprun\s*>/i.test(xml);
}

/** Cierra etiquetas pendientes para poder mostrar escaneos interrumpidos. */
export function repairTruncatedXml(xml) {
  const lastGt = xml.lastIndexOf('>');
  const lastLt = xml.lastIndexOf('<');
  const text = lastLt > lastGt ? xml.slice(0, lastLt) : xml;
  const stack = [];
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

  if (!stack.length) return null;
  return `${text}\n${stack.reverse().map((name) => `</${name}>`).join('\n')}\n`;
}

/** Elimina las notas heredadas del XML antes de guardarlo en SQLite. */
export function stripAtlasNotes(xml) {
  return xml
    .replace(/<atlas-note\b[^>]*>[\s\S]*?<\/atlas-note\s*>/gi, '')
    .replace(/<atlas-note\b[^>]*\/>/gi, '');
}

export function parseNmapXml(xml, filename = '') {
  if (!xml || !xml.trim()) throw new ValidationError('El XML está vacío.');

  const warnings = [];
  let source = xml;
  let validation = XMLValidator.validate(source);
  if (validation !== true && looksTruncated(xml)) {
    const repaired = repairTruncatedXml(xml);
    if (repaired) {
      const repairedValidation = XMLValidator.validate(repaired);
      if (repairedValidation === true) {
        source = repaired;
        validation = true;
        warnings.push('XML incompleto: se han cerrado las etiquetas pendientes.');
      }
    }
  }
  if (validation !== true) {
    throw new ValidationError(`El XML no es válido: ${validation.err?.msg ?? 'error desconocido'}`);
  }

  const doc = parser.parse(source);
  const root = doc?.nmaprun;
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new ValidationError('El XML no contiene <nmaprun>.');
  }
  if (warnings.length === 0 && looksTruncated(source)) {
    warnings.push('XML incompleto: se han cerrado las etiquetas pendientes.');
  }

  return {
    scanner: attr(root, 'scanner') || 'nmap',
    args: attr(root, 'args'),
    start: attr(root, 'start'),
    startstr: attr(root, 'startstr'),
    version: attr(root, 'version'),
    xmloutputversion: attr(root, 'xmloutputversion'),
    scanInfos: asArray(root.scaninfo).map((info) => ({
      type: attr(info, 'type'),
      protocol: attr(info, 'protocol'),
      numServices: num(attr(info, 'numservices')),
      services: attr(info, 'services'),
    })),
    hosts: asArray(root.host).map(parseHost),
    runStats: parseRunStats(root),
    filename,
    rawSize: byteLength(xml),
    warnings,
  };
}
