import { ChevronDown, ChevronRight, ChevronsDownUp, PanelRightClose } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface Entry {
  id: string;
  element: HTMLElement;
  text: string;
  level: number;
}

interface Turn {
  id: string;
  element: HTMLElement;
  question: string;
  entries: Entry[];
}

/** Group rendered text headings by question; reasoning, tools and diagrams are excluded. */
export function AnswerOutline({
  contentRef,
  onClose,
  overlay,
}: {
  contentRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  overlay: boolean;
}) {
  const { t } = useTranslation();
  const [outline, setOutline] = useState<{
    turns: Turn[];
    current: string | null;
    active: HTMLElement | null;
  }>({ turns: [], current: null, active: null });
  // An explicit choice wins over automatic following, including collapsing the current turn.
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    let frame = 0;
    let dirty = true;
    let turns: Turn[] = [];
    const ids = new WeakMap<HTMLElement, string>();
    let nextId = 0;
    const getId = (element: HTMLElement) => {
      let id = element.dataset.chatId ?? ids.get(element);
      if (!id) {
        id = `outline-${nextId++}`;
        ids.set(element, id);
      }
      return id;
    };
    const update = () => {
      frame = 0;
      const scroller = content.querySelector<HTMLElement>("[data-chat-scroll]");
      if (!scroller || !scroller.clientHeight) return;
      if (dirty) {
        turns = [];
        for (const message of scroller.querySelectorAll<HTMLElement>("[data-chat-role]")) {
          if (message.dataset.chatRole === "user") {
            turns.push({
              id: getId(message),
              element: message,
              question: message.querySelector("[data-user-text]")?.textContent?.trim() ?? "",
              entries: [],
            });
          } else if (message.dataset.chatRole === "assistant") {
            if (!turns.length)
              turns.push({ id: getId(message), element: message, question: "", entries: [] });
            const turn = turns[turns.length - 1];
            for (const element of message.querySelectorAll<HTMLElement>(
              "[data-answer-text] h1, [data-answer-text] h2, [data-answer-text] h3",
            )) {
              const text = element.textContent?.trim();
              if (text)
                turn.entries.push({
                  id: getId(element),
                  element,
                  text,
                  level: Number(element.tagName[1]),
                });
            }
          }
        }
        dirty = false;
      }
      const viewport = scroller.getBoundingClientRect();
      const readingLine = viewport.top + Math.min(80, viewport.height / 4);
      let currentTurn = turns[0];
      for (const turn of turns) {
        if (turn.element.getBoundingClientRect().top <= readingLine) currentTurn = turn;
        else break;
      }
      let active: HTMLElement | null = null;
      for (const entry of currentTurn?.entries ?? []) {
        if (entry.element.getBoundingClientRect().top <= readingLine) active = entry.element;
        else break;
      }
      const current = currentTurn?.id ?? null;
      setOutline((old) =>
        old.turns === turns && old.current === current && old.active === active
          ? old
          : { turns, current, active },
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const mutation = new MutationObserver(() => {
      dirty = true;
      schedule();
    });
    mutation.observe(content, { subtree: true, childList: true, characterData: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(content);
    content.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      mutation.disconnect();
      resize.disconnect();
      content.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [contentRef]);

  useEffect(() => {
    if (!outline.current) return;
    const nav = navRef.current;
    const active =
      (outline.active ? nav?.querySelector<HTMLElement>('[aria-current="location"]') : null) ??
      nav?.querySelector<HTMLElement>('[data-current-turn="true"]');
    if (active && nav) {
      const bounds = nav.getBoundingClientRect();
      const rect = active.getBoundingClientRect();
      if (rect.top < bounds.top) nav.scrollTop += rect.top - bounds.top;
      else if (rect.bottom > bounds.bottom) nav.scrollTop += rect.bottom - bounds.bottom;
    }
  }, [outline.current, outline.active]);

  const jumpTo = (element: HTMLElement) => {
    const scroller = contentRef.current?.querySelector<HTMLElement>("[data-chat-scroll]");
    if (!scroller || !element.isConnected) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({
      top:
        scroller.scrollTop +
        element.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        24,
      behavior: reducedMotion ? "instant" : "smooth",
    });
    if (!reducedMotion)
      element.animate([{ backgroundColor: "var(--muted)" }, { backgroundColor: "transparent" }], {
        duration: 1000,
      });
  };

  return (
    <aside
      aria-label={t("chat.answerOutline")}
      className={`flex w-80 max-w-[85%] shrink-0 flex-col border-l border-border/60 bg-background ${overlay ? "absolute inset-y-0 right-0 z-20 shadow-lg" : ""}`}
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 px-3">
        <h2 className="text-base font-medium">{t("chat.answerOutline")}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              setManual(Object.fromEntries(outline.turns.map((turn) => [turn.id, false])))
            }
            title={t("chat.collapseAllTurns")}
            aria-label={t("chat.collapseAllTurns")}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronsDownUp className="size-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title={t("chat.collapseOutline")}
            aria-label={t("chat.collapseOutline")}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PanelRightClose className="size-4" />
          </button>
        </div>
      </div>
      <nav
        ref={navRef}
        aria-label={t("chat.answerOutline")}
        className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4"
      >
        {outline.turns.map((turn, index) => {
          const expanded = manual[turn.id] ?? outline.current === turn.id;
          const question = turn.question || t("chat.outlineTurn", { number: index + 1 });
          const minimumLevel = Math.min(...turn.entries.map((entry) => entry.level));
          return (
            <div key={turn.id} className="mb-2">
              <div
                className={`relative rounded-md ${outline.current === turn.id ? "bg-primary/5 text-primary" : "text-muted-foreground"}`}
                data-current-turn={outline.current === turn.id}
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-label={t(expanded ? "chat.collapseTurn" : "chat.expandTurn", { question })}
                  onClick={() => setManual((old) => ({ ...old, [turn.id]: !expanded }))}
                  className="absolute left-0.5 top-2 z-10 flex size-6 items-center justify-center rounded hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {expanded ? (
                    <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronRight className="size-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  title={question}
                  onClick={() => jumpTo(turn.element)}
                  className="block w-full min-w-0 rounded-md px-1.5 py-2 text-left text-sm leading-6 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="line-clamp-3 indent-6">
                    {index + 1}. {question}
                  </span>
                </button>
              </div>
              {expanded && (
                <div className="ml-2 border-l border-border/60 pl-0.5 pt-1">
                  {turn.entries.length ? (
                    turn.entries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        aria-current={outline.active === entry.element ? "location" : undefined}
                        title={entry.text}
                        onClick={() => jumpTo(entry.element)}
                        className={`mb-0.5 block w-full rounded-md border-l-2 py-1.5 pr-1.5 text-left text-sm leading-6 transition-colors focus-visible:ring-2 focus-visible:ring-ring ${outline.active === entry.element ? "border-primary bg-primary/5 text-primary" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                        style={{ paddingLeft: 8 + (entry.level - minimumLevel) * 10 }}
                      >
                        <span className="line-clamp-3">{entry.text}</span>
                      </button>
                    ))
                  ) : (
                    <p className="px-2 py-3 text-sm text-muted-foreground">{t("chat.noOutline")}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!outline.turns.length && (
          <p className="px-1 py-6 text-sm text-muted-foreground">{t("chat.noOutline")}</p>
        )}
      </nav>
    </aside>
  );
}
