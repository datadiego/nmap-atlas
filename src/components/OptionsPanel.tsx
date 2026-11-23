import { useState } from 'react';
import { Settings2 } from 'lucide-react';
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
        REMEMBER_FIELDS.map(({ id }) => [id, true]),
      ) as RememberSettings;
      setRemember(next);
      saveRememberSettings(next);
    }
  };

  return (
    <div className="options-panel">
      <section className="options-card">
        <h2><Settings2 size={16} /> Opciones</h2>
        <fieldset>
          <legend>Recordar ajustes</legend>
          <div className="options-card-list">
            {REMEMBER_FIELDS.map(({ id, label }) => (
              <label className="scan-check" key={id}>
                <input type="checkbox" checked={remember[id]} onChange={() => toggleField(id)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="options-card-all">
            <label className="scan-check">
              <input type="checkbox" checked={allRemembered} onChange={toggleAll} />
              <span>Recordar todo</span>
            </label>
          </div>
        </fieldset>
      </section>
    </div>
  );
}
