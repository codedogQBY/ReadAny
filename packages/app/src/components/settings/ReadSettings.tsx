/**
 * ReadSettings — reading view settings (font, layout, etc.)
 */
import { useSettingsStore } from "@/stores/settings-store";

export function ReadSettingsPanel() {
  const { readSettings, updateReadSettings } = useSettingsStore();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Reading</h3>
        <p className="text-sm text-muted-foreground">Customize your reading experience</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Font Size: {readSettings.fontSize}px</label>
          <input
            type="range"
            min={12}
            max={32}
            value={readSettings.fontSize}
            onChange={(e) => updateReadSettings({ fontSize: Number(e.target.value) })}
            className="w-full"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Line Height: {readSettings.lineHeight}</label>
          <input
            type="range"
            min={1.2}
            max={2.5}
            step={0.1}
            value={readSettings.lineHeight}
            onChange={(e) => updateReadSettings({ lineHeight: Number(e.target.value) })}
            className="w-full"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Font Family</label>
          <select
            value={readSettings.fontFamily}
            onChange={(e) => updateReadSettings({ fontFamily: e.target.value as "sans" | "serif" | "mono" })}
            className="rounded-md border border-border px-2 py-1 text-sm"
          >
            <option value="sans">Sans-serif</option>
            <option value="serif">Serif</option>
            <option value="mono">Monospace</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">View Mode</label>
          <select
            value={readSettings.viewMode}
            onChange={(e) => updateReadSettings({ viewMode: e.target.value as "paginated" | "scroll" })}
            className="rounded-md border border-border px-2 py-1 text-sm"
          >
            <option value="paginated">Paginated</option>
            <option value="scroll">Scroll</option>
          </select>
        </div>
      </div>
    </div>
  );
}
