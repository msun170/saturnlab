import { useState, useEffect } from 'react';
import { getSettings, saveSettings } from '../../lib/ipc';
import type { AppSettings } from '../../lib/ipc';

/** Number input that lets the user freely type (including empty) and validates on save. */
function NumInput({ value, onChange, min, max, unit }: {
  value: number; onChange: (v: number) => void; min: number; max: number; unit: string;
}) {
  const [raw, setRaw] = useState(String(value));

  // Sync if external value changes
  useEffect(() => { setRaw(String(value)); }, [value]);

  return (
    <div className="settings-input-group">
      <input
        type="text"
        inputMode="numeric"
        value={raw}
        onChange={(e) => {
          const v = e.target.value;
          // Allow empty or digits only
          if (v === '' || /^\d+$/.test(v)) {
            setRaw(v);
            const num = parseInt(v, 10);
            if (!isNaN(num)) onChange(num);
          }
        }}
        onBlur={() => {
          // On blur, clamp to valid range
          const num = parseInt(raw, 10);
          if (isNaN(num) || num < min) { setRaw(String(min)); onChange(min); }
          else if (num > max) { setRaw(String(max)); onChange(max); }
        }}
      />
      <span>{unit}</span>
    </div>
  );
}

interface SettingsPanelProps {
  onClose: () => void;
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then(setSettings).catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!settings) return;

    // Validate: no zero or negative values
    if (settings.layer_b_delay_seconds < 1 || settings.layer_a_delay_seconds < 1 ||
        settings.autosave_interval_seconds < 1 || settings.editor_font_size < 1) {
      setSaveError('All values must be greater than 0');
      setTimeout(() => setSaveError(null), 3000);
      return;
    }

    try {
      await saveSettings(settings);
      const { useAppStore } = await import('../../store');
      useAppStore.getState().setAppSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    }
  };

  const update = (patch: Partial<AppSettings>) => {
    if (settings) setSettings({ ...settings, ...patch });
  };

  if (!settings) return <div className="settings-panel"><p>Loading settings...</p></div>;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>

        <div className="settings-body">
          {/* Kernel */}
          <div className="settings-section">
            <h3>Kernel</h3>

            <div className="settings-row">
              <label>Auto-stop inactive kernels</label>
              <select
                value={settings.kernel_auto_stop_minutes ?? 'never'}
                onChange={(e) => {
                  const val = e.target.value;
                  update({ kernel_auto_stop_minutes: val === 'never' ? null : parseInt(val, 10) });
                }}
              >
                <option value="never">Never</option>
                <option value="30">After 30 minutes</option>
                <option value="60">After 1 hour</option>
                <option value="120">After 2 hours</option>
              </select>
            </div>
          </div>

          {/* Memory Layers */}
          <div className="settings-section">
            <h3>Memory Layers</h3>

            <div className="settings-row">
              <label>Background suspension delay</label>
              <NumInput value={settings.layer_b_delay_seconds} min={10} max={300} unit="seconds"
                onChange={(v) => update({ layer_b_delay_seconds: v })} />
            </div>

            <div className="settings-row">
              <label>UI suspension delay</label>
              <NumInput value={settings.layer_a_delay_seconds} min={60} max={3600} unit="seconds"
                onChange={(v) => update({ layer_a_delay_seconds: v })} />
            </div>
          </div>

          {/* Editor */}
          <div className="settings-section">
            <h3>Editor</h3>

            <div className="settings-row">
              <label>Show line numbers</label>
              <input
                type="checkbox"
                checked={settings.show_line_numbers}
                onChange={(e) => update({ show_line_numbers: e.target.checked })}
              />
            </div>

            <div className="settings-row">
              <label>Font size</label>
              <NumInput value={settings.editor_font_size} min={8} max={32} unit="px"
                onChange={(v) => update({ editor_font_size: v })} />
            </div>

            <div className="settings-row">
              <label>Auto-save interval</label>
              <NumInput value={settings.autosave_interval_seconds} min={5} max={600} unit="seconds"
                onChange={(v) => update({ autosave_interval_seconds: v })} />
            </div>
          </div>
        </div>

        <div className="settings-footer">
          {saveError && <span className="settings-error">{saveError}</span>}
          {saved && <span className="settings-saved">Settings saved!</span>}
          <button className="settings-cancel-btn" onClick={onClose}>Cancel</button>
          <button className="settings-save-btn" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
