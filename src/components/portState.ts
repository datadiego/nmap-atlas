import type { TranslationKey } from '../i18n';

export const stateKeys: Record<string, TranslationKey> = {
  open: 'state.open',
  closed: 'state.closed',
  filtered: 'state.filtered',
  unfiltered: 'state.unfiltered',
  'open|filtered': 'state.openFiltered',
  'closed|filtered': 'state.closedFiltered',
  unknown: 'state.unknown',
};
