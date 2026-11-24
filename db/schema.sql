-- Nmap Atlas · esquema completo (se aplica en cada arranque)
-- SQLite es la única fuente de verdad: XML, notas, capturas y ajustes.

CREATE TABLE IF NOT EXISTS app_settings (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  locale               TEXT NOT NULL DEFAULT 'es' CHECK (locale IN ('es', 'en')),
  theme                TEXT NOT NULL DEFAULT 'gruvbox',
  view_mode            TEXT NOT NULL DEFAULT 'hierarchy'
                       CHECK (view_mode IN ('grid', 'hierarchy', 'list', 'screenshots', 'raw')),
  remember_json        TEXT NOT NULL DEFAULT '{}',
  remembered_form_json TEXT NOT NULL DEFAULT '{}',
  hide_warning         INTEGER NOT NULL DEFAULT 0 CHECK (hide_warning IN (0, 1)),
  updated_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scans (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL UNIQUE,
  source             TEXT NOT NULL CHECK (source IN ('nmap', 'upload')),
  scanner            TEXT NOT NULL DEFAULT '',
  args               TEXT NOT NULL DEFAULT '',
  command            TEXT NOT NULL DEFAULT '',
  nmap_version       TEXT NOT NULL DEFAULT '',
  xml_output_version TEXT NOT NULL DEFAULT '',
  start_raw          TEXT NOT NULL DEFAULT '',
  startstr           TEXT NOT NULL DEFAULT '',
  started_at         INTEGER,
  duration_ms        INTEGER NOT NULL DEFAULT 0,
  exit_code          INTEGER,
  stderr             TEXT NOT NULL DEFAULT '',
  warnings_json      TEXT NOT NULL DEFAULT '[]',
  raw_xml            TEXT NOT NULL,
  raw_text           TEXT NOT NULL DEFAULT '',
  raw_size           INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS scans_created_at_idx ON scans(created_at DESC);

CREATE TABLE IF NOT EXISTS scan_infos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id      INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  ordinal      INTEGER NOT NULL DEFAULT 0,
  type         TEXT NOT NULL DEFAULT '',
  protocol     TEXT NOT NULL DEFAULT '',
  num_services INTEGER NOT NULL DEFAULT 0,
  services     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS scan_infos_scan_idx ON scan_infos(scan_id, ordinal);

CREATE TABLE IF NOT EXISTS run_stats (
  scan_id      INTEGER PRIMARY KEY REFERENCES scans(id) ON DELETE CASCADE,
  hosts_up     INTEGER NOT NULL DEFAULT 0,
  hosts_down   INTEGER NOT NULL DEFAULT 0,
  hosts_total  INTEGER NOT NULL DEFAULT 0,
  elapsed      TEXT NOT NULL DEFAULT '',
  summary      TEXT NOT NULL DEFAULT '',
  finished_str TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS scan_jobs (
  id                TEXT PRIMARY KEY,
  scan_id           INTEGER REFERENCES scans(id) ON DELETE SET NULL,
  target            TEXT NOT NULL DEFAULT '',
  command           TEXT NOT NULL DEFAULT '',
  payload_json      TEXT NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'finished', 'cancelled', 'failed')),
  percent           REAL NOT NULL DEFAULT 0,
  processed         INTEGER NOT NULL DEFAULT 0,
  total             INTEGER NOT NULL DEFAULT 0,
  bytes             INTEGER NOT NULL DEFAULT 0,
  host_hints        INTEGER NOT NULL DEFAULT 0,
  hosts             INTEGER NOT NULL DEFAULT 0,
  current_address   TEXT NOT NULL DEFAULT '',
  current_approx    INTEGER NOT NULL DEFAULT 0,
  exit_code         INTEGER,
  duration_ms       INTEGER NOT NULL DEFAULT 0,
  stderr            TEXT NOT NULL DEFAULT '',
  gowitness_status  TEXT,
  gowitness_message TEXT NOT NULL DEFAULT '',
  event_count       INTEGER NOT NULL DEFAULT 0,
  started_at        INTEGER NOT NULL,
  finished_at       INTEGER
);
CREATE INDEX IF NOT EXISTS scan_jobs_started_at_idx ON scan_jobs(started_at DESC);

CREATE TABLE IF NOT EXISTS scan_job_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id  TEXT NOT NULL REFERENCES scan_jobs(id) ON DELETE CASCADE,
  at      INTEGER NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scan_job_events_job_idx ON scan_job_events(job_id, at);

CREATE TABLE IF NOT EXISTS hosts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id   INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  ordinal   INTEGER NOT NULL,
  host_key  TEXT NOT NULL,
  start_raw TEXT NOT NULL DEFAULT '',
  end_raw   TEXT NOT NULL DEFAULT '',
  state     TEXT NOT NULL DEFAULT '',
  reason    TEXT NOT NULL DEFAULT '',
  uptime    TEXT NOT NULL DEFAULT '',
  distance  TEXT NOT NULL DEFAULT '',
  srtt      TEXT NOT NULL DEFAULT '',
  rttvar    TEXT NOT NULL DEFAULT '',
  to_rtt    TEXT NOT NULL DEFAULT '',
  notes     TEXT NOT NULL DEFAULT '',
  UNIQUE (scan_id, ordinal),
  UNIQUE (scan_id, host_key)
);
CREATE INDEX IF NOT EXISTS hosts_scan_idx ON hosts(scan_id);

CREATE TABLE IF NOT EXISTS host_addresses (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL DEFAULT 0,
  addr    TEXT NOT NULL DEFAULT '',
  type    TEXT NOT NULL DEFAULT '',
  vendor  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS host_addresses_host_idx ON host_addresses(host_id, ordinal);

CREATE TABLE IF NOT EXISTS host_names (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL DEFAULT 0,
  name    TEXT NOT NULL DEFAULT '',
  type    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS host_names_host_idx ON host_names(host_id, ordinal);

CREATE TABLE IF NOT EXISTS traceroutes (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id  INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  ordinal  INTEGER NOT NULL DEFAULT 0,
  port     TEXT NOT NULL DEFAULT '',
  proto    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS traceroutes_host_idx ON traceroutes(host_id, ordinal);

CREATE TABLE IF NOT EXISTS trace_hops (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id  INTEGER NOT NULL REFERENCES traceroutes(id) ON DELETE CASCADE,
  ordinal   INTEGER NOT NULL DEFAULT 0,
  ttl       INTEGER NOT NULL DEFAULT 0,
  ipaddr    TEXT NOT NULL DEFAULT '',
  rtt       TEXT NOT NULL DEFAULT '',
  host      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS trace_hops_trace_idx ON trace_hops(trace_id, ordinal);

CREATE TABLE IF NOT EXISTS ports (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id            INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  ordinal            INTEGER NOT NULL DEFAULT 0,
  protocol           TEXT NOT NULL,
  port_id            INTEGER NOT NULL,
  state              TEXT NOT NULL DEFAULT 'unknown',
  reason             TEXT NOT NULL DEFAULT '',
  reason_ttl         TEXT NOT NULL DEFAULT '',
  service_name       TEXT NOT NULL DEFAULT '',
  service_product    TEXT NOT NULL DEFAULT '',
  service_version    TEXT NOT NULL DEFAULT '',
  service_extra_info TEXT NOT NULL DEFAULT '',
  service_method     TEXT NOT NULL DEFAULT '',
  service_conf       INTEGER NOT NULL DEFAULT 0,
  service_ostype     TEXT NOT NULL DEFAULT '',
  service_devicetype TEXT NOT NULL DEFAULT '',
  UNIQUE (host_id, protocol, port_id)
);
CREATE INDEX IF NOT EXISTS ports_host_idx ON ports(host_id, ordinal);

CREATE TABLE IF NOT EXISTS service_cpes (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  port_id INTEGER NOT NULL REFERENCES ports(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL DEFAULT 0,
  value   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS service_cpes_port_idx ON service_cpes(port_id, ordinal);

CREATE TABLE IF NOT EXISTS os_matches (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id  INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  ordinal  INTEGER NOT NULL DEFAULT 0,
  name     TEXT NOT NULL DEFAULT '',
  accuracy INTEGER NOT NULL DEFAULT 0,
  line     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS os_matches_host_idx ON os_matches(host_id, ordinal);

CREATE TABLE IF NOT EXISTS os_classes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id   INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  ordinal   INTEGER NOT NULL DEFAULT 0,
  type      TEXT NOT NULL DEFAULT '',
  vendor    TEXT NOT NULL DEFAULT '',
  os_family TEXT NOT NULL DEFAULT '',
  os_gen    TEXT NOT NULL DEFAULT '',
  accuracy  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS os_classes_host_idx ON os_classes(host_id, ordinal);

CREATE TABLE IF NOT EXISTS os_class_cpes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  os_class_id INTEGER NOT NULL REFERENCES os_classes(id) ON DELETE CASCADE,
  ordinal     INTEGER NOT NULL DEFAULT 0,
  value       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS os_class_cpes_class_idx ON os_class_cpes(os_class_id, ordinal);

CREATE TABLE IF NOT EXISTS extra_port_groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id    INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  ordinal    INTEGER NOT NULL DEFAULT 0,
  state      TEXT NOT NULL DEFAULT 'unknown',
  port_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS extra_port_groups_host_idx ON extra_port_groups(host_id, ordinal);

CREATE TABLE IF NOT EXISTS extra_port_reasons (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id  INTEGER NOT NULL REFERENCES extra_port_groups(id) ON DELETE CASCADE,
  ordinal   INTEGER NOT NULL DEFAULT 0,
  reason    TEXT NOT NULL DEFAULT '',
  count     INTEGER NOT NULL DEFAULT 0,
  proto     TEXT NOT NULL DEFAULT '',
  ports     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS extra_port_reasons_group_idx ON extra_port_reasons(group_id, ordinal);

-- Un solo lugar para los scripts de host, puerto y servicio. El CHECK evita
-- que un script quede sin dueño o con más de uno.
CREATE TABLE IF NOT EXISTS scripts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id         INTEGER REFERENCES hosts(id) ON DELETE CASCADE,
  port_id         INTEGER REFERENCES ports(id) ON DELETE CASCADE,
  service_port_id INTEGER REFERENCES ports(id) ON DELETE CASCADE,
  ordinal         INTEGER NOT NULL DEFAULT 0,
  script_id       TEXT NOT NULL DEFAULT '',
  output          TEXT NOT NULL DEFAULT '',
  CHECK ((host_id IS NOT NULL) + (port_id IS NOT NULL) + (service_port_id IS NOT NULL) = 1)
);
CREATE INDEX IF NOT EXISTS scripts_owner_idx ON scripts(host_id, port_id, service_port_id, ordinal);

CREATE TABLE IF NOT EXISTS screenshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id       INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  host_id       INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
  port_id       INTEGER REFERENCES ports(id) ON DELETE SET NULL,
  cache_key     TEXT NOT NULL,
  data          BLOB NOT NULL,
  mime          TEXT NOT NULL,
  byte_size     INTEGER NOT NULL,
  original_file TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL DEFAULT '',
  code          INTEGER NOT NULL,
  successful    INTEGER NOT NULL CHECK (successful IN (0, 1)),
  probed_at     INTEGER,
  created_at    INTEGER NOT NULL,
  UNIQUE (scan_id, cache_key)
);
CREATE INDEX IF NOT EXISTS screenshots_scan_idx ON screenshots(scan_id);
CREATE INDEX IF NOT EXISTS screenshots_host_idx ON screenshots(host_id);
CREATE INDEX IF NOT EXISTS screenshots_success_idx ON screenshots(scan_id, successful);
