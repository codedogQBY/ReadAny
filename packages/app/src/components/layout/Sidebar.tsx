import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import {
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Hash,
  HelpCircle,
  MessageSquare,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  Puzzle,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface NavItem {
  tabType: "home" | "chat" | "notes" | "skills";
  labelKey: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  expandable?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { tabType: "home", labelKey: "sidebar.library", icon: BookOpen, expandable: true },
  { tabType: "chat", labelKey: "sidebar.chat", icon: MessageSquare },
  { tabType: "notes", labelKey: "sidebar.notes", icon: NotebookPen },
  { tabType: "skills", labelKey: "sidebar.skills", icon: Puzzle },
];

export function HomeSidebar() {
  const { t, i18n } = useTranslation();
  const { activeTabId, setActiveTab, addTab } = useAppStore();
  const {
    filter,
    setFilter,
    allTags,
    activeTag,
    activeGroupId,
    groups,
    setActiveTag,
    setActiveGroupId,
    addTag,
    removeTag,
    renameTag,
    removeGroup,
  } = useLibraryStore();
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [isLibraryExpanded, setIsLibraryExpanded] = useState(true);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [isTagsExpanded, setIsTagsExpanded] = useState(false);
  const newTagInputRef = useRef<HTMLInputElement>(null);

  // Determine which home sub-view is active
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === activeTabId));
  const activeType = activeTab?.type ?? "home";

  const handleNavClick = (tabType: "home" | "chat" | "notes" | "skills") => {
    if (tabType === "home") {
      setActiveTab("home");
    } else {
      // Add the tab if it doesn't exist, then activate
      // Use translated title for the tab
      const item = NAV_ITEMS.find((n) => n.tabType === tabType);
      const title = item ? t(item.labelKey) : tabType;
      addTab({ id: tabType, type: tabType, title });
      setActiveTab(tabType);
    }
  };

  const handleStatsClick = () => {
    addTab({ id: "stats", type: "home" as const, title: t("stats.title") });
    // Use a special convention: we set activeTab to "stats" but type is home
    // Actually, let's keep it simple — stats is a home sub-view triggered by a special tab id
    setActiveTab("stats");
  };

  return (
    <aside className="z-40 flex h-full min-h-0 w-48 shrink-0 select-none flex-col overflow-hidden">
      <div className="px-2 pt-2">
        {isSearchVisible ? (
          <div className="flex w-full items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 transition-colors">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              type="text"
              placeholder={`${t("common.search")}...`}
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              value={filter.search}
              onChange={(e) => {
                setFilter({ search: e.target.value });
                if (e.target.value && activeType !== "home") setActiveTab("home");
              }}
              onBlur={() => {
                if (!filter.search) setIsSearchVisible(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setFilter({ search: "" });
                  setIsSearchVisible(false);
                }
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => setIsSearchVisible(true)}
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="text-sm">{t("common.search")}</span>
          </button>
        )}
      </div>
      <nav className="flex min-h-0 flex-1 flex-col space-y-1 overflow-y-auto px-1 pt-2 pl-2">
        {NAV_ITEMS.map((item) => {
          const isActive = activeType === item.tabType;
          const Icon = item.icon;
          return (
            <div key={item.tabType}>
              {item.expandable ? (
                <div className="flex w-full items-center">
                  <button
                    type="button"
                    className={`flex flex-1 items-center gap-2 rounded-md p-1 py-1 text-left text-sm transition-colors hover:bg-muted ${isActive ? "text-foreground" : "text-muted-foreground"}`}
                    onClick={() => handleNavClick(item.tabType)}
                  >
                    <div className="flex flex-1 items-center gap-2">
                      <Icon size={16} className="shrink-0" />
                      <span className="font-medium text-sm">{t(item.labelKey)}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsLibraryExpanded(!isLibraryExpanded);
                    }}
                  >
                    {isLibraryExpanded ? (
                      <ChevronDown size={16} className="shrink-0" />
                    ) : (
                      <ChevronRight size={16} className="shrink-0" />
                    )}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-md p-1 py-1 text-left text-sm transition-colors hover:bg-muted ${isActive ? "text-foreground" : "text-muted-foreground"}`}
                  onClick={() => handleNavClick(item.tabType)}
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="font-medium text-sm">{t(item.labelKey)}</span>
                </button>
              )}
              {item.expandable && isLibraryExpanded && (
                <div className="ml-6 mt-1 space-y-0.5">
                  {/* All Books */}
                  <button
                    type="button"
                    className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted ${
                      activeType === "home" && !activeTag && !activeGroupId
                        ? "bg-muted text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => {
                      setActiveTag("");
                      setActiveGroupId("");
                      handleNavClick("home");
                    }}
                  >
                    <span>{t("sidebar.allBooks")}</span>
                  </button>

                  {/* Group chips — horizontal, like mobile */}
                  {groups.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {groups.map((group) => (
                        <button
                          key={group.id}
                          type="button"
                          className={`rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
                            activeGroupId === group.id
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                          }`}
                          onClick={() => {
                            setActiveGroupId(group.id);
                            handleNavClick("home");
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            const action = window.confirm(
                              `${group.name}\n\n确定删除此分组？书籍不会被删除。`,
                            );
                            if (action) void removeGroup(group.id);
                          }}
                        >
                          {group.name}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Tag list */}
                  {(() => {
                    const MAX_VISIBLE = 3;
                    const needsCollapse = allTags.length > MAX_VISIBLE;
                    const visibleTags =
                      needsCollapse && !isTagsExpanded
                        ? (() => {
                            // Always include active tag in visible set
                            const first = allTags.slice(0, MAX_VISIBLE);
                            if (
                              activeTag &&
                              !first.includes(activeTag) &&
                              allTags.includes(activeTag)
                            ) {
                              first[MAX_VISIBLE - 1] = activeTag;
                            }
                            return first;
                          })()
                        : allTags;
                    return (
                      <>
                        <div
                          className={
                            needsCollapse && isTagsExpanded ? "max-h-40 overflow-y-auto" : ""
                          }
                        >
                          {visibleTags.map((tag) => (
                            <div key={tag} className="group/tag relative flex items-center">
                              {editingTag === tag ? (
                                <input
                                  type="text"
                                  className="w-full rounded-md border border-primary/40 bg-background px-2 py-1 text-xs outline-none"
                                  value={editingName}
                                  onChange={(e) => setEditingName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      renameTag(tag, editingName);
                                      setEditingTag(null);
                                    } else if (e.key === "Escape") {
                                      setEditingTag(null);
                                    }
                                  }}
                                  onBlur={() => {
                                    if (editingName.trim() && editingName.trim() !== tag) {
                                      renameTag(tag, editingName);
                                    }
                                    setEditingTag(null);
                                  }}
                                />
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className={`flex flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted ${
                                      activeTag === tag
                                        ? "bg-muted text-foreground font-medium"
                                        : "text-muted-foreground hover:text-foreground"
                                    }`}
                                    onClick={() => {
                                      setActiveTag(tag);
                                      handleNavClick("home");
                                    }}
                                  >
                                    <Hash size={11} className="shrink-0 opacity-50" />
                                    <span className="truncate">{tag}</span>
                                  </button>
                                  {/* Tag context menu using DropdownMenu (Portal-based, won't be clipped) */}
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button
                                        type="button"
                                        className="absolute right-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover/tag:opacity-100"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <MoreHorizontal size={12} />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="min-w-28">
                                      <DropdownMenuItem
                                        className="text-xs"
                                        onClick={() => {
                                          setEditingTag(tag);
                                          setEditingName(tag);
                                        }}
                                      >
                                        <Pencil size={12} className="mr-2" />
                                        {t("sidebar.renameTag")}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        className="text-xs text-destructive focus:text-destructive"
                                        onClick={() => removeTag(tag)}
                                      >
                                        <Trash2 size={12} className="mr-2" />
                                        {t("sidebar.deleteTag")}
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </>
                              )}
                            </div>
                          ))}
                        </div>

                        {needsCollapse && (
                          <button
                            type="button"
                            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
                            onClick={() => setIsTagsExpanded(!isTagsExpanded)}
                          >
                            <ChevronsUpDown size={11} className="shrink-0" />
                            <span>
                              {isTagsExpanded
                                ? t("sidebar.collapseTags")
                                : t("sidebar.expandTags", { count: allTags.length - MAX_VISIBLE })}
                            </span>
                          </button>
                        )}
                      </>
                    );
                  })()}

                  {/* Uncategorized */}
                  <button
                    type="button"
                    className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted ${
                      activeTag === "__uncategorized__"
                        ? "bg-muted text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => {
                      setActiveTag("__uncategorized__");
                      handleNavClick("home");
                    }}
                  >
                    <Hash size={11} className="shrink-0 opacity-50" />
                    <span className="truncate">{t("sidebar.uncategorized")}</span>
                  </button>

                  {/* Add tag input */}
                  {isAddingTag ? (
                    <div className="flex items-center gap-1 px-1">
                      <input
                        ref={newTagInputRef}
                        type="text"
                        className="w-full rounded-md border border-primary/40 bg-background px-2 py-1 text-xs outline-none"
                        placeholder={t("sidebar.tagPlaceholder")}
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newTagName.trim()) {
                            addTag(newTagName.trim());
                            setNewTagName("");
                            setIsAddingTag(false);
                          } else if (e.key === "Escape") {
                            setNewTagName("");
                            setIsAddingTag(false);
                          }
                        }}
                        onBlur={() => {
                          if (newTagName.trim()) addTag(newTagName.trim());
                          setNewTagName("");
                          setIsAddingTag(false);
                        }}
                      />
                      <button
                        type="button"
                        className="p-0.5 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setNewTagName("");
                          setIsAddingTag(false);
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={() => setIsAddingTag(true)}
                    >
                      <Plus size={11} className="shrink-0" />
                      <span>{t("sidebar.addTag")}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="shrink-0 space-y-1 px-2 py-3">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md p-1 py-1 text-left text-muted-foreground text-sm hover:bg-muted hover:text-foreground"
          onClick={handleStatsClick}
        >
          <BarChart3 size={16} className="shrink-0" />
          <span className="text-sm">{t("stats.title")}</span>
        </button>
        <a
          href={`https://codedogqby.github.io/ReadAny/${i18n.language === "zh" ? "zh/" : ""}support/`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center gap-2 rounded-md p-1 py-1 text-left text-muted-foreground text-sm hover:bg-muted hover:text-foreground"
        >
          <HelpCircle size={16} className="shrink-0" />
          <span className="text-sm">{t("settings.supportCenter")}</span>
        </a>
        <button
          id="tour-settings"
          type="button"
          className="flex w-full items-center gap-2 rounded-md p-1 py-1 text-left text-muted-foreground text-sm hover:bg-muted hover:text-foreground"
          onClick={() => setShowSettings(true)}
        >
          <Settings size={16} className="shrink-0" />
          <span className="text-sm">{t("common.settings")}</span>
        </button>
      </div>
    </aside>
  );
}
