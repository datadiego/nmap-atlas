import { createContext } from 'react';

/** Estado compartido de los bloques NSE de los puertos dentro de una ficha de host. */
export const ScriptsOpenContext = createContext<{
  open: boolean;
  setOpen: (value: boolean) => void;
} | null>(null);
