import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HostScreenshot, NmapHost, ScreenshotIndex } from './types';

interface ScreenshotsContextValue {
  screenshots: ScreenshotIndex;
  refresh: () => Promise<void>;
  forHost: (host: NmapHost) => Array<{ key: string; port: string; shot: HostScreenshot }>;
}

const EMPTY: ScreenshotIndex = {};

const ScreenshotsContext = createContext<ScreenshotsContextValue>({
  screenshots: EMPTY,
  refresh: async () => {},
  forHost: () => [],
});

export function ScreenshotsProvider({ children }: { children: ReactNode }) {
  const [screenshots, setScreenshots] = useState<ScreenshotIndex>(EMPTY);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/screenshots');
      if (!response.ok) return;
      const data = (await response.json()) as { screenshots?: ScreenshotIndex };
      setScreenshots(data.screenshots && typeof data.screenshots === 'object'
        ? data.screenshots
        : EMPTY);
    } catch {
      // Sin servidor no hay capturas; el resto de la aplicación sigue funcionando.
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const forHost = useCallback(
    (host: NmapHost) => {
      const addresses = [host.key, ...host.addresses.map((address) => address.addr)];
      const names = host.hostnames.map((hostname) => hostname.name);
      const found: Array<{ key: string; port: string; shot: HostScreenshot }> = [];
      const seen = new Set<string>();
      for (const [key, shot] of Object.entries(screenshots)) {
        // Los índices antiguos pueden incluir páginas de error: no cuentan
        // como captura realizada ni activan el filtro del toolbar.
        if (shot.code < 200 || shot.code >= 400) continue;
        const at = key.lastIndexOf(':');
        const hostPart = key.slice(0, at);
        const port = key.slice(at + 1);
        if (![...addresses, ...names].includes(hostPart)) continue;
        if (seen.has(shot.file)) continue;
        seen.add(shot.file);
        found.push({ key, port, shot });
      }
      return found.sort((a, b) => Number(a.port) - Number(b.port));
    },
    [screenshots],
  );

  const value = useMemo(() => ({ screenshots, refresh, forHost }), [screenshots, refresh, forHost]);
  return <ScreenshotsContext.Provider value={value}>{children}</ScreenshotsContext.Provider>;
}

export const useScreenshots = () => useContext(ScreenshotsContext);

export const screenshotUrl = (file: string) =>
  `/api/screenshots/${encodeURIComponent(file)}/image`;
