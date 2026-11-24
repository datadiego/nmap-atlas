import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import App from './App';
import { I18nProvider } from './i18n/I18nProvider';
import { applyTheme, loadTheme } from './theme';
import { loadAppSettings } from './settings';
import { migrateLegacyNotes } from './notes';
import { ScreenshotsProvider } from './screenshots';

async function bootstrap() {
  await loadAppSettings();
  await migrateLegacyNotes();
  applyTheme(loadTheme());

  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <I18nProvider>
        <ScreenshotsProvider>
          <App />
        </ScreenshotsProvider>
      </I18nProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
