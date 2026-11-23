import type { RefObject } from 'react';
import { ArrowUp } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';

interface Props {
  targetRef: RefObject<HTMLElement>;
}

/** Botón flotante para volver al inicio del contenedor con scroll. */
export default function ScrollToTop({ targetRef }: Props) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="scroll-to-top"
      title={t('common.scrollTop')}
      aria-label={t('common.scrollTop')}
      onClick={() => {
        // Según el alto del contenido puede desplazarse el contenedor o la
        // ventana completa; cubrimos los dos casos.
        targetRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }}
    >
      <ArrowUp size={18} />
    </button>
  );
}
