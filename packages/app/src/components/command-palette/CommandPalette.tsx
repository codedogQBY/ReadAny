/**
 * CommandPalette — Cmd+Shift+P command palette for quick access to settings and actions.
 *
 * Features:
 * - Fuzzy search across all settings and actions
 * - Keyboard navigation (Arrow keys + Enter + Escape)
 * - Recent commands tracking (localStorage)
 * - Category grouping (Settings / Actions)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";
import {
  Settings,
  Sun,
  Moon,
  BookOpen,
  Volume2,
  Languages,
  Brain,
  Info,
  Search,
  Keyboard,
  type LucideIcon,
} from "lucide-react";

// ── Types ──

type CommandCategory = "settings" | "actions";

interface CommandItem {
  id: string;
  label: string;
  keywords: string[];
  category: CommandCategory;
  icon?: LucideIcon;
  action: () => void;
  shortcut?: string;
}

interface SearchResult {
  item: CommandItem;
  score: number;
  matchPositions: number[];
}

// ── Fuzzy search ──

function fuzzyMatch(query: string, target: string): { score: number; positions: number[] } | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  const positions: number[] = [];
  let prevMatchIdx = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      positions.push(ti);
      score += 1;
      // Bonus for consecutive matches
      if (ti === prevMatchIdx + 1) score += 2;
      // Bonus for word boundary
      if (ti === 0 || t[ti - 1] === " " || t[ti - 1] === "-" || t[ti - 1] === "_") score += 3;
      prevMatchIdx = ti;
      qi++;
    }
  }

  if (qi < q.length) return null;
  // Penalize longer targets
  score -= target.length * 0.1;
  return { score, positions };
}

function searchCommands(query: string, items: CommandItem[]): SearchResult[] {
  if (!query.trim()) return [];
  const results: SearchResult[] = [];

  for (const item of items) {
    const searchTexts = [item.label, ...item.keywords];
    let bestScore = -Infinity;
    let bestPositions: number[] = [];

    for (const text of searchTexts) {
      const match = fuzzyMatch(query, text);
      if (match && match.score > bestScore) {
        bestScore = match.score;
        bestPositions = text === item.label ? match.positions : [];
      }
    }

    if (bestScore > -Infinity) {
      results.push({ item, score: bestScore, matchPositions: bestPositions });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 30);
}

// ── Recent commands ──

const RECENT_KEY = "readany-recent-commands";
const MAX_RECENT = 5;

function trackRecent(commandId: string) {
  try {
    const ids = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") as string[];
    const updated = [commandId, ...ids.filter((id) => id !== commandId)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  } catch { /* ignore */ }
}

function getRecentIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

// ── Highlight component ──

function HighlightText({ text, positions }: { text: string; positions: number[] }) {
  if (!positions.length) return <span>{text}</span>;
  const posSet = new Set(positions);
  return (
    <span>
      {text.split("").map((char, i) => (
        <span key={i} className={posSet.has(i) ? "text-primary font-semibold" : ""}>
          {char}
        </span>
      ))}
    </span>
  );
}

// ── Main component ──

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { t } = useTranslation();
  const setShowSettings = useAppStore((s) => s.setShowSettings);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build command registry
  const commands = useMemo<CommandItem[]>(() => {
    const openSettings = () => {
      setShowSettings(true);
      onClose();
    };

    return [
      // ── Settings commands ──
      {
        id: "settings.general",
        label: t("settings.general_title"),
        keywords: ["general", "settings", "theme", "language", "通用", "设置", "主题", "语言"],
        category: "settings",
        icon: Settings,
        action: openSettings,
      },
      {
        id: "settings.reading",
        label: t("settings.reading_title"),
        keywords: ["reading", "font", "layout", "size", "阅读", "字体", "排版"],
        category: "settings",
        icon: BookOpen,
        action: openSettings,
      },
      {
        id: "settings.ai",
        label: t("settings.ai_title"),
        keywords: ["ai", "model", "endpoint", "openai", "claude", "模型", "端点"],
        category: "settings",
        icon: Brain,
        action: openSettings,
      },
      {
        id: "settings.vectorModel",
        label: t("settings.vm_title"),
        keywords: ["vector", "embedding", "semantic", "search", "向量", "嵌入", "语义"],
        category: "settings",
        icon: Search,
        action: openSettings,
      },
      {
        id: "settings.tts",
        label: t("tts.settingsTitle"),
        keywords: ["tts", "speech", "voice", "read aloud", "edge", "语音", "朗读"],
        category: "settings",
        icon: Volume2,
        action: openSettings,
      },
      {
        id: "settings.translation",
        label: t("settings.translation_title"),
        keywords: ["translation", "translate", "language", "翻译", "语言"],
        category: "settings",
        icon: Languages,
        action: openSettings,
      },
      {
        id: "settings.about",
        label: t("settings.about"),
        keywords: ["about", "version", "info", "关于", "版本"],
        category: "settings",
        icon: Info,
        action: openSettings,
      },
      // ── Action commands ──
      {
        id: "action.settings",
        label: t("common.settings"),
        keywords: ["settings", "preferences", "设置", "偏好"],
        category: "actions",
        icon: Settings,
        action: openSettings,
        shortcut: "⌘,",
      },
      {
        id: "action.theme.light",
        label: `${t("settings.theme")}: ${t("settings.light")}`,
        keywords: ["theme", "light", "bright", "主题", "浅色"],
        category: "actions",
        icon: Sun,
        action: () => {
          document.documentElement.setAttribute("data-theme", "light");
          localStorage.setItem("readany-theme", "light");
          onClose();
        },
      },
      {
        id: "action.theme.dark",
        label: `${t("settings.theme")}: ${t("settings.dark")}`,
        keywords: ["theme", "dark", "night", "主题", "深色", "夜间"],
        category: "actions",
        icon: Moon,
        action: () => {
          document.documentElement.setAttribute("data-theme", "dark");
          localStorage.setItem("readany-theme", "dark");
          onClose();
        },
      },
      {
        id: "action.theme.sepia",
        label: `${t("settings.theme")}: ${t("settings.sepia")}`,
        keywords: ["theme", "sepia", "eye", "warm", "主题", "护眼"],
        category: "actions",
        icon: Sun,
        action: () => {
          document.documentElement.setAttribute("data-theme", "sepia");
          localStorage.setItem("readany-theme", "sepia");
          onClose();
        },
      },
      {
        id: "action.shortcuts",
        label: t("commandPalette.placeholder"),
        keywords: ["command", "palette", "shortcut", "keyboard", "命令", "快捷键"],
        category: "actions",
        icon: Keyboard,
        action: () => { /* already open */ },
        shortcut: "⌘⇧P",
      },
    ];
  }, [t, setShowSettings, onClose]);

  // Search results
  const results = useMemo(() => searchCommands(query, commands), [query, commands]);

  // Recent commands (when no query)
  const recentCommands = useMemo(() => {
    if (query.trim()) return [];
    const recentIds = getRecentIds();
    return recentIds
      .map((id) => commands.find((c) => c.id === id))
      .filter(Boolean) as CommandItem[];
  }, [query, commands]);

  // Flat list for keyboard navigation
  const flatItems = useMemo(() => {
    if (query.trim()) {
      return results.map((r) => r.item);
    }
    return recentCommands;
  }, [query, results, recentCommands]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Execute command
  const executeCommand = useCallback(
    (item: CommandItem) => {
      trackRecent(item.id);
      onClose();
      requestAnimationFrame(() => item.action());
    },
    [onClose],
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (flatItems[selectedIndex]) {
            executeCommand(flatItems[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "Tab":
          e.preventDefault();
          break;
      }
    },
    [flatItems, selectedIndex, executeCommand, onClose],
  );

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!open) return null;

  // Group results by category
  const grouped = useMemo(() => {
    if (!query.trim()) return null;
    const groups: Record<CommandCategory, SearchResult[]> = { settings: [], actions: [] };
    for (const r of results) {
      groups[r.item.category].push(r);
    }
    return groups;
  }, [query, results]);

  let itemIndex = 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />

      {/* Palette */}
      <div
        className="relative z-10 w-[520px] max-h-[400px] overflow-hidden rounded-xl border bg-background shadow-2xl animate-in fade-in slide-in-from-top-2 duration-150"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder={t("commandPalette.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results list */}
        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1">
          {!query.trim() && recentCommands.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("commandPalette.hint")}
            </div>
          )}

          {!query.trim() && recentCommands.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("commandPalette.recent")}
              </div>
              {recentCommands.map((item) => {
                const idx = itemIndex++;
                return (
                  <CommandRow
                    key={item.id}
                    item={item}
                    isSelected={idx === selectedIndex}
                    dataIndex={idx}
                    onClick={() => executeCommand(item)}
                    onHover={() => setSelectedIndex(idx)}
                  />
                );
              })}
            </>
          )}

          {query.trim() && results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("commandPalette.noResults", { query })}
            </div>
          )}

          {grouped &&
            (["settings", "actions"] as CommandCategory[]).map((cat) => {
              const catResults = grouped[cat];
              if (!catResults.length) return null;
              return (
                <div key={cat}>
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t(`commandPalette.${cat}`)}
                  </div>
                  {catResults.map((r) => {
                    const idx = itemIndex++;
                    return (
                      <CommandRow
                        key={r.item.id}
                        item={r.item}
                        isSelected={idx === selectedIndex}
                        dataIndex={idx}
                        matchPositions={r.matchPositions}
                        onClick={() => executeCommand(r.item)}
                        onHover={() => setSelectedIndex(idx)}
                      />
                    );
                  })}
                </div>
              );
            })}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-3 border-t px-3 py-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-muted px-1 py-0.5">↑↓</kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-muted px-1 py-0.5">↵</kbd> select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border bg-muted px-1 py-0.5">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Row component ──

function CommandRow({
  item,
  isSelected,
  dataIndex,
  matchPositions,
  onClick,
  onHover,
}: {
  item: CommandItem;
  isSelected: boolean;
  dataIndex: number;
  matchPositions?: number[];
  onClick: () => void;
  onHover: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      data-index={dataIndex}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
        isSelected ? "bg-primary/10 text-foreground" : "text-foreground/80 hover:bg-muted/60",
      )}
      onClick={onClick}
      onMouseEnter={onHover}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
      <span className="flex-1 truncate">
        {matchPositions?.length ? (
          <HighlightText text={item.label} positions={matchPositions} />
        ) : (
          item.label
        )}
      </span>
      {item.shortcut && (
        <kbd className="ml-2 shrink-0 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {item.shortcut}
        </kbd>
      )}
    </button>
  );
}
