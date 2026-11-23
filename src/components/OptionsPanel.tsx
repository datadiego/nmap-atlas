import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';
import { languageName, locales, type Locale } from '../i18n';
import {
  DEFAULT_REMEMBER,
  REMEMBER_FIELDS,
  forgetRememberedFields,
  loadRememberSettings,
  saveRememberSettings,
  type RememberField,
  type RememberSettings,
} from '../remember';

export default function OptionsPanel() {
  const { t, locale, setLocale } = useI18n();
  const [remember, setRemember] = useState<RememberSettings>(loadRememberSettings);
  const allRemembered = REMEMBER_FIELDS.every(({ id }) => remember[id]);

  const toggleField = (field: RememberField) => {
    const next = { ...remember, [field]: !remember[field] };
    setRemember(next);
    if (remember[field]) forgetRememberedFields(next, [field]);
    else saveRememberSettings(next);
  };

  const toggleAll = () => {
    if (allRemembered) {
      const next = { ...DEFAULT_REMEMBER };
      setRemember(next);
      forgetRememberedFields(
        next,
        REMEMBER_FIELDS.map(({ id }) => id),
      );
    } else {
      const next = Object.fromEntries(
        REMEMBER_FIELDS.map(({ id }) => [id, true])
      ) as RememberSettings;
      setRemember(next);
      saveRememberSettings(next);
    }
  };

  return (
    <div className="options-panel">
      <section className="options-card">
        <h2><Settings2 size={16} /> {t('options.title')}</h2>
        <fieldset>
          <legend>{t('options.remember')}</legend>
          <div className="options-card-list">
            {REMEMBER_FIELDS.map(({ id, labelKey }) => (
              <label className="scan-check" key={id}>
                <input type="checkbox" checked={remember[id]} onChange={() => toggleField(id)} />
                <span>{t(labelKey)}</span>
              </label>
            ))}
          </div>
          <div className="options-card-all">
            <label className="scan-check">
              <input type="checkbox" checked={allRemembered} onChange={toggleAll} />
              <span>{t('options.rememberAll')}</span>
            </label>
          </div>
        </fieldset>
        <div className="options-card-field">
          <label className="scan-label" htmlFor="options-locale">{t('options.language')}</label>
          <select
            id="options-locale"
            className="scan-input"
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
          >
            {(Object.keys(locales) as Locale[]).map((code) => (
              <option key={code} value={code}>
                {languageName(locale, code)}
              </option>
            ))}
          </select>
        </div>
      </section>
    </div>
  );
}
