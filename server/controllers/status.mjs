import { count } from '../../db/repositories/scans.mjs';
import { getNmapVersion } from '../nmap.mjs';
import { getIpcCalcVersion } from '../ipcalc.mjs';
import { getGowitnessVersion, screenshotDir } from '../gowitness.mjs';

export async function get(c) {
  const { config, db } = c.var;
  const [nmapVersion, ipcalcVersion, gowitnessVersion] = await Promise.all([
    getNmapVersion(config),
    getIpcCalcVersion(config),
    getGowitnessVersion(config),
  ]);
  const command = config.nmapCommand ?? ['nmap'];
  const privileged = Boolean(config.nmapPrivileged)
    || command.includes('--privileged')
    || command.length > 1;

  return c.json({
    ok: true,
    nmapAvailable: Boolean(nmapVersion),
    nmapVersion,
    nmapCommand: command.join(' '),
    privileged,
    dbPath: config.dbPath,
    scansDir: config.scansDir ?? '',
    saving: config.save,
    savedScans: count(db),
    ipcalcAvailable: Boolean(ipcalcVersion),
    ipcalcVersion,
    gowitnessAvailable: Boolean(gowitnessVersion),
    gowitnessVersion,
    screenshotsDir: screenshotDir(config),
  });
}
