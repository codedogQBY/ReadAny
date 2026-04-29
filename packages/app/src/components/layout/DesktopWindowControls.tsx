import { cn } from "@readany/core/utils";
import type { Window as TauriWindow } from "@tauri-apps/api/window";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

const NO_DRAG_STYLE = { WebkitAppRegion: "no-drag" } as Record<string, string>;
const WINDOW_LOG_PREFIX = "[DesktopWindowControls]";

type DesktopWindowControlsProps = {
  className?: string;
  headerRef?: RefObject<HTMLElement | null>;
  showOnMac?: boolean;
  showMinimize?: boolean;
  showMaximize?: boolean;
  showClose?: boolean;
};

export function DesktopWindowControls({
  className,
  headerRef,
  showOnMac = false,
  showMinimize = true,
  showMaximize = true,
  showClose = true,
}: DesktopWindowControlsProps) {
  const [isTauriPlatform, setIsTauriPlatform] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isMacPlatform, setIsMacPlatform] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const winRef = useRef<TauriWindow | null>(null);
  const touchState = useRef({
    lastPointerTime: 0,
    pointerStartPosition: { x: 0, y: 0 },
    isDragging: false,
  });

  const logInfo = (...args: unknown[]) => {
    console.info(WINDOW_LOG_PREFIX, ...args);
  };

  const logError = (...args: unknown[]) => {
    console.error(WINDOW_LOG_PREFIX, ...args);
  };

  const getWindow = async (source: string) => {
    if (winRef.current) return winRef.current;

    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const currentWindow = getCurrentWindow();
      winRef.current = currentWindow;
      logInfo("resolved current window", { source });
      return currentWindow;
    } catch (error) {
      logError("failed to resolve current window", { source, error });
      return null;
    }
  };

  const syncWindowState = async (appWindow: TauriWindow, source: string) => {
    try {
      const [maximized, fullscreen] = await Promise.all([
        appWindow.isMaximized(),
        appWindow.isFullscreen(),
      ]);
      setIsMaximized(maximized);
      setIsFullscreen(fullscreen);
      logInfo("synced window state", { source, maximized, fullscreen });
    } catch (error) {
      logError("failed to sync window state", { source, error });
    }
  };

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    const isTauri = "__TAURI_INTERNALS__" in window;
    const isMac = ua.includes("mac");
    setIsMacPlatform(isMac);
    setIsTauriPlatform(isTauri);
    logInfo("platform detection", { isTauri, isMac, showOnMac });
    setIsVisible(isTauri && (!isMac || showOnMac));
  }, [showOnMac]);

  useEffect(() => {
    if (!isVisible) return;

    let isMounted = true;
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const currentWindow = getCurrentWindow();
        winRef.current = currentWindow;
        logInfo("window API ready");

        const syncCurrentWindowState = async () => {
          if (!isMounted) return;
          await syncWindowState(currentWindow, "setup");
        };

        await syncCurrentWindowState();
        unlisten = await currentWindow.onResized(() => {
          void syncCurrentWindowState();
        });
      } catch (error) {
        logError("failed to initialize window API", error);
      }
    };

    void setup();

    return () => {
      isMounted = false;
      unlisten?.();
    };
  }, [isVisible]);

  useEffect(() => {
    if (!isTauriPlatform || !headerRef?.current) return;

    const headerElement = headerRef.current;

    const isExcludedElement = (target: HTMLElement) =>
      Boolean(
        target.closest(".desktop-window-button") ||
          target.closest("button") ||
          target.closest("a") ||
          target.closest("input") ||
          target.closest("textarea") ||
          target.closest("select") ||
          target.closest("[data-no-window-drag]"),
      );

    const handleMouseDown = async (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const appWindow = await getWindow("mouse-down");
      if (!target || isExcludedElement(target) || !appWindow || e.buttons !== 1) return;

      if (e.detail === 2) {
        try {
          const isFullscreen = await appWindow.isFullscreen();
          if (isFullscreen) {
            await appWindow.setFullscreen(false);
            await appWindow.unmaximize();
          } else {
            await appWindow.toggleMaximize();
          }
          const maximized = await appWindow.isMaximized();
          setIsMaximized(maximized);
          logInfo("header double click toggle maximize", { isFullscreen, maximized });
        } catch (error) {
          logError("header double click toggle maximize failed", error);
        }
        return;
      }

      appWindow.startDragging().catch((error) => {
        logError("start dragging failed", error);
      });
    };

    const handlePointerDown = async (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const appWindow = await getWindow("pointer-down");
      if (!target || isExcludedElement(target) || !appWindow) return;
      if (e.pointerType === "mouse") return;

      e.preventDefault();

      const currentTime = Date.now();
      const timeDiff = currentTime - touchState.current.lastPointerTime;
      touchState.current.pointerStartPosition = { x: e.clientX, y: e.clientY };

      if (timeDiff < 300) {
        try {
          const isFullscreen = await appWindow.isFullscreen();
          if (isFullscreen) {
            await appWindow.setFullscreen(false);
            await appWindow.unmaximize();
          } else {
            await appWindow.toggleMaximize();
          }
          const maximized = await appWindow.isMaximized();
          setIsMaximized(maximized);
          logInfo("header touch double tap toggle maximize", { isFullscreen, maximized });
        } catch (error) {
          logError("header touch double tap toggle maximize failed", error);
        }
        return;
      }

      touchState.current.lastPointerTime = currentTime;
      touchState.current.isDragging = false;
    };

    const handlePointerMove = async (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const appWindow = await getWindow("pointer-move");
      if (!target || isExcludedElement(target) || !appWindow) return;
      if (e.pointerType === "mouse" || touchState.current.isDragging) return;

      e.preventDefault();

      const deltaX = Math.abs(e.clientX - touchState.current.pointerStartPosition.x);
      const deltaY = Math.abs(e.clientY - touchState.current.pointerStartPosition.y);
      if (deltaX > 5 || deltaY > 5) {
        touchState.current.isDragging = true;
        try {
          await appWindow.startDragging();
        } catch (error) {
          logError("touch dragging failed", error);
        }
      }
    };

    const handlePointerUp = () => {
      touchState.current.isDragging = false;
    };

    headerElement.addEventListener("mousedown", handleMouseDown);
    headerElement.addEventListener("pointerdown", handlePointerDown);
    headerElement.addEventListener("pointermove", handlePointerMove);
    headerElement.addEventListener("pointerup", handlePointerUp);
    headerElement.addEventListener("pointercancel", handlePointerUp);

    return () => {
      headerElement.removeEventListener("mousedown", handleMouseDown);
      headerElement.removeEventListener("pointerdown", handlePointerDown);
      headerElement.removeEventListener("pointermove", handlePointerMove);
      headerElement.removeEventListener("pointerup", handlePointerUp);
      headerElement.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [headerRef, isTauriPlatform]);

  if (!isVisible) return null;

  const handleMinimize = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    logInfo("minimize button clicked");
    void (async () => {
      const appWindow = await getWindow("button-minimize");
      if (!appWindow) return;

      try {
        await appWindow.minimize();
        logInfo("minimize succeeded");
      } catch (error) {
        logError("minimize failed", error);
      }
    })();
  };

  const handleToggleMaximize = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    logInfo("toggle maximize button clicked");
    const appWindow = await getWindow("button-toggle-maximize");
    if (!appWindow) return;

    try {
      if (isMacPlatform) {
        const fullscreen = await appWindow.isFullscreen();
        await appWindow.setFullscreen(!fullscreen);
        await syncWindowState(appWindow, "button-toggle-fullscreen");
        logInfo("toggle fullscreen succeeded", { fullscreenBefore: fullscreen });
      } else {
        const fullscreen = await appWindow.isFullscreen();
        if (fullscreen) {
          await appWindow.setFullscreen(false);
          await appWindow.unmaximize();
        } else {
          await appWindow.toggleMaximize();
        }
        await syncWindowState(appWindow, "button-toggle-maximize");
        logInfo("toggle maximize succeeded", { isFullscreenBefore: fullscreen });
      }
    } catch (error) {
      logError("toggle maximize failed", error);
    }
  };

  const handleClose = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    logInfo("close button clicked");
    void (async () => {
      const appWindow = await getWindow("button-close");
      if (!appWindow) return;

      try {
        await appWindow.close();
        logInfo("close succeeded");
      } catch (error) {
        logError("close failed", error);
      }
    })();
  };

  return (
    <div
      className={cn("flex h-full shrink-0 items-center pr-1", className)}
      style={NO_DRAG_STYLE}
      data-no-window-drag
      data-tauri-drag-region="false"
    >
      {showMinimize && (
        <button
          type="button"
          className="desktop-window-button flex h-8 w-11 items-center justify-center text-neutral-500 transition-colors hover:bg-black/5"
          onClick={handleMinimize}
          title="最小化"
          style={NO_DRAG_STYLE}
          data-no-window-drag
          data-tauri-drag-region="false"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" aria-hidden="true">
            <rect width="10" height="1" fill="currentColor" />
          </svg>
        </button>
      )}

      {showMaximize && (
        <button
          type="button"
          className="desktop-window-button flex h-8 w-11 items-center justify-center text-neutral-500 transition-colors hover:bg-black/5"
          onClick={(e) => {
            void handleToggleMaximize(e);
          }}
          title={
            isMacPlatform
              ? isFullscreen
                ? "退出全屏"
                : "进入全屏"
              : isMaximized
                ? "还原"
                : "最大化"
          }
          style={NO_DRAG_STYLE}
          data-no-window-drag
          data-tauri-drag-region="false"
        >
          {isMacPlatform ? (
            isFullscreen ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path
                  d="M1.5 4V1.5H4M6 1.5H8.5V4M8.5 6V8.5H6M4 8.5H1.5V6"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path
                  d="M4 1.5H1.5V4M6 1.5H8.5V4M8.5 6V8.5H6M4 8.5H1.5V6"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                />
              </svg>
            )
          ) : isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path
                d="M3 1.5H8.5V7H7.3V2.7H3V1.5ZM1.5 3H7V8.5H1.5V3Z"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          ) : (
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
              <rect
                x="0.8"
                y="0.8"
                width="7.4"
                height="7.4"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          )}
        </button>
      )}

      {showClose && (
        <button
          type="button"
          className="desktop-window-button flex h-8 w-11 items-center justify-center text-neutral-500 transition-colors hover:bg-red-600 hover:text-white"
          onClick={handleClose}
          title="关闭"
          style={NO_DRAG_STYLE}
          data-no-window-drag
          data-tauri-drag-region="false"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
