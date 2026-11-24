export type PortState =
  | 'open'
  | 'closed'
  | 'filtered'
  | 'unfiltered'
  | 'open|filtered'
  | 'closed|filtered'
  | 'unknown';

export interface ScanInfo {
  type: string;
  protocol: string;
  numServices: number;
  services: string;
}

export interface NmapScript {
  id: string;
  output: string;
}

export interface ServiceInfo {
  name: string;
  product: string;
  version: string;
  extraInfo: string;
  method: string;
  conf: number;
  ostype: string;
  devicetype: string;
  cpe: string[];
  scripts: NmapScript[];
}

export interface NmapPort {
  protocol: string;
  portId: string;
  state: PortState;
  reason: string;
  reasonTtl: string;
  service?: ServiceInfo;
  scripts: NmapScript[];
}

export interface ExtraPortReason {
  reason: string;
  count: number;
  proto: string;
  ports: string;
}

export interface ExtraPortGroup {
  state: PortState;
  count: number;
  reasons: ExtraPortReason[];
}

export interface OsClass {
  type: string;
  vendor: string;
  osFamily: string;
  osGen: string;
  accuracy: number;
  cpe: string[];
}

export interface OsMatch {
  name: string;
  accuracy: number;
  line: string;
}

export interface HostAddress {
  addr: string;
  type: string;
  vendor: string;
}

export interface Hostname {
  name: string;
  type: string;
}

export interface NmapHost {
  key: string;
  start: string;
  end: string;
  state: string;
  reason: string;
  addresses: HostAddress[];
  hostnames: Hostname[];
  ports: NmapPort[];
  extraPorts: ExtraPortGroup[];
  os: OsMatch[];
  osClasses: OsClass[];
  uptime: string;
  distance: string;
  times: { srtt: string; rttvar: string; to: string } | null;
  scripts: NmapScript[];
  notes: string;
}

export interface RunStats {
  hostsUp: number;
  hostsDown: number;
  hostsTotal: number;
  elapsed: string;
  summary: string;
  finishedStr: string;
}

export interface NmapScan {
  scanner: string;
  args: string;
  start: string;
  startstr: string;
  version: string;
  xmloutputversion: string;
  scanInfos: ScanInfo[];
  hosts: NmapHost[];
  runStats: RunStats | null;
  filename: string;
  rawSize: number;
  warnings: string[];
}

/** Captura de gowitness, indexada por `ip:puerto` (o `host:puerto`). */
export interface HostScreenshot {
  file: string;
  url: string;
  title: string;
  code: number;
}

export type ScreenshotIndex = Record<string, HostScreenshot>;

export interface ApiStatus {
  ok: boolean;
  nmapAvailable: boolean;
  nmapVersion: string | null;
  nmapCommand: string;
  privileged: boolean;
  dbPath?: string;
  scansDir: string;
  saving: boolean;
  savedScans: number;
  ipcalcAvailable: boolean;
  ipcalcVersion: string | null;
  gowitnessAvailable: boolean;
  gowitnessVersion: string | null;
  screenshotsDir: string;
}

export interface IpcCalcResult {
  input: string;
  family: 'IPv4' | 'IPv6';
  address?: string;
  fulladdress?: string;
  network?: string;
  fullnetwork?: string;
  netmask?: string;
  prefix?: string;
  cidr?: string;
  broadcast?: string;
  addrspace?: string;
  minaddr?: string;
  maxaddr?: string;
  addresses?: string;
}

export interface SavedScan {
  name: string;
  size: number;
  mtime: string;
}

export interface ScanResult {
  xml: string;
  scan?: NmapScan;
  command: string;
  durationMs: number;
  exitCode: number | null;
  stderr: string;
  savedAs: string | null;
  gowitness: string | null;
  timeoutMs: number;
}
