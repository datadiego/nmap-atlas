import { createContext } from 'react';

export interface GraphActions {
  activeHost: string | null;
  childrenByHost: Record<string, string[]>;
  toggleHost: (hostId: string) => void;
}

export const GraphActionsContext = createContext<GraphActions>({
  activeHost: null,
  childrenByHost: {},
  toggleHost: () => {},
});
