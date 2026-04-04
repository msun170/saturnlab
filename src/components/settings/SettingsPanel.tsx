import { useState, useEffect } from 'react';
import { getSettings, saveSettings } from '../../lib/ipc';
import type { AppSettings } from '../../lib/ipc';

interface SettingsPanelProps {
  onClose: () => void;
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings).catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    try {
      await saveSettings(settings);
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
              <div className="settings-input-group">
                <input
                  type="number"
                  min="10"
                  max="300"
                  value={settings.layer_b_delay_seconds}
                  onChange={(e) => update({ layer_b_delay_seconds: parseInt(e.target.value, 10) || 30 })}
                />
                <span>seconds</span>
              </div>
            </div>

            <div className="settings-row">
              <label>UI suspension delay</label>
              <div className="settings-input-group">
                <input
                  type="number"
                  min="60"
                  max="3600"
                  value={settings.layer_a_delay_seconds}
                  onChange={(e) => update({ layer_a_delay_seconds: parseInt(e.target.value, 10) || 300 })}
                />
                <span>seconds</span>
              </div>
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
              <div className="settings-input-group">
                <input
                  type="number"
                  min="10"
                  max="24"
                  value={settings.editor_font_size}
                  onChange={(e) => update({ editor_font_size: parseInt(e.target.value, 10) || 14 })}
                />
                <span>px</span>
              </div>
            </div>

            <div className="settings-row">
              <label>Auto-save interval</label>
              <div className="settings-input-group">
                <input
                  type="number"
                  min="10"
                  max="600"
                  value={settings.autosave_interval_seconds}
                  onChange={(e) => update({ autosave_interval_seconds: parseInt(e.target.value, 10) || 30 })}
                />
                <span>seconds</span>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-footer">
          {saved && <span className="settings-saved">Settings saved!</span>}
          <button className="settings-cancel-btn" onClick={onClose}>Cancel</button>
          <button className="settings-save-btn" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
