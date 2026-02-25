/**
 * GeneralSettings — app-level settings
 */

export function GeneralSettings() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">General</h3>
        <p className="text-sm text-muted-foreground">App appearance and behavior</p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Theme</p>
            <p className="text-xs text-muted-foreground">Choose your preferred theme</p>
          </div>
          {/* TODO: Theme selector */}
          <select className="rounded-md border border-border px-2 py-1 text-sm">
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="sepia">Sepia</option>
          </select>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Auto-save interval</p>
            <p className="text-xs text-muted-foreground">How often to save reading progress</p>
          </div>
          <select className="rounded-md border border-border px-2 py-1 text-sm">
            <option value="15000">15s</option>
            <option value="30000">30s</option>
            <option value="60000">1min</option>
          </select>
        </div>
      </div>
    </div>
  );
}
