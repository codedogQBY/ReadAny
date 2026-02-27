/**
 * Iframe event handlers — bridges events from foliate-js iframe content
 * documents to the main window via postMessage.
 *
 * Reference: readest iframeEventHandlers.ts
 *
 * foliate-js renders book content inside iframes (shadow DOM).
 * Events (keyboard, mouse, touch) happening inside iframes don't bubble
 * to the main window. This module attaches listeners to iframe documents
 * and forwards them via window.postMessage so React hooks can consume them.
 */

const LONG_HOLD_THRESHOLD = 500;

let longHoldTimeout: ReturnType<typeof setTimeout> | null = null;

let keyboardState = {
  key: "",
  code: "",
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
};

const getKeyStatus = (
  event?: MouseEvent | WheelEvent | TouchEvent,
) => {
  if (event && "ctrlKey" in event) {
    return {
      key: keyboardState.key,
      code: keyboardState.code,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    };
  }
  return { ...keyboardState };
};

export const handleKeydown = (
  bookKey: string,
  event: KeyboardEvent,
) => {
  keyboardState = {
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  };

  if (["Backspace"].includes(event.key)) {
    event.preventDefault();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
  }

  window.postMessage(
    {
      type: "iframe-keydown",
      bookKey,
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    },
    "*",
  );
};

export const handleKeyup = (
  bookKey: string,
  event: KeyboardEvent,
) => {
  keyboardState = {
    key: "",
    code: "",
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  };

  window.postMessage(
    {
      type: "iframe-keyup",
      bookKey,
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    },
    "*",
  );
};

export const handleMousedown = (
  bookKey: string,
  event: MouseEvent,
) => {
  longHoldTimeout = setTimeout(() => {
    longHoldTimeout = null;
  }, LONG_HOLD_THRESHOLD);

  window.postMessage(
    {
      type: "iframe-mousedown",
      bookKey,
      button: event.button,
      screenX: event.screenX,
      screenY: event.screenY,
      clientX: event.clientX,
      clientY: event.clientY,
      ...getKeyStatus(event),
    },
    "*",
  );
};

export const handleMouseup = (
  bookKey: string,
  event: MouseEvent,
) => {
  const isLongHold = !longHoldTimeout;
  if (longHoldTimeout) {
    clearTimeout(longHoldTimeout);
    longHoldTimeout = null;
  }
  if ([3, 4].includes(event.button)) {
    event.preventDefault();
  }
  window.postMessage(
    {
      type: "iframe-mouseup",
      bookKey,
      button: event.button,
      screenX: event.screenX,
      screenY: event.screenY,
      clientX: event.clientX,
      clientY: event.clientY,
      isLongHold,
      ...getKeyStatus(event),
    },
    "*",
  );
};

/** Single-click detection with double-click exclusion */
let clickTimer: ReturnType<typeof setTimeout> | null = null;
let clickCount = 0;

export const handleClick = (
  bookKey: string,
  event: MouseEvent,
) => {
  // Ignore clicks on interactive elements (links, buttons, inputs)
  const target = event.target as HTMLElement;
  if (target?.closest?.("a, button, input, textarea, select, [role='button']")) return;

  clickCount++;
  if (clickCount === 1) {
    clickTimer = setTimeout(() => {
      // Single click confirmed (not a double click)
      window.postMessage(
        {
          type: "iframe-single-click",
          bookKey,
          screenX: event.screenX,
          screenY: event.screenY,
          clientX: event.clientX,
          clientY: event.clientY,
        },
        "*",
      );
      clickCount = 0;
    }, 250);
  } else {
    // Double click — cancel single click
    if (clickTimer) clearTimeout(clickTimer);
    clickCount = 0;
  }
};

export const handleWheel = (
  bookKey: string,
  event: WheelEvent,
) => {
  event.preventDefault();
  window.postMessage(
    {
      type: "iframe-wheel",
      bookKey,
      deltaMode: event.deltaMode,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      ...getKeyStatus(event),
    },
    "*",
  );
};

const handleTouchEv = (
  bookKey: string,
  event: TouchEvent,
  type: string,
) => {
  const touch = event.targetTouches[0];
  const touches = [];
  if (touch) {
    touches.push({
      clientX: touch.clientX,
      clientY: touch.clientY,
      screenX: touch.screenX,
      screenY: touch.screenY,
    });
  }
  window.postMessage(
    {
      type,
      bookKey,
      timeStamp: Date.now(),
      targetTouches: touches,
      ...getKeyStatus(event),
    },
    "*",
  );
};

export const handleTouchStart = (
  bookKey: string,
  event: TouchEvent,
) => handleTouchEv(bookKey, event, "iframe-touchstart");

export const handleTouchMove = (
  bookKey: string,
  event: TouchEvent,
) => handleTouchEv(bookKey, event, "iframe-touchmove");

export const handleTouchEnd = (
  bookKey: string,
  event: TouchEvent,
) => handleTouchEv(bookKey, event, "iframe-touchend");

/**
 * Register all iframe event handlers on a loaded document.
 * Called each time a new section is loaded by foliate-view.
 */
export function registerIframeEventHandlers(
  bookKey: string,
  doc: Document,
): void {
  // Avoid double-registering
  // biome-ignore lint: runtime flag on Document
  if ((doc as any).__readany_events_registered) return;
  // biome-ignore lint: runtime flag on Document
  (doc as any).__readany_events_registered = true;

  console.log("[iframe-events] Registered handlers for bookKey:", bookKey);

  doc.addEventListener("keydown", handleKeydown.bind(null, bookKey));
  doc.addEventListener("keyup", handleKeyup.bind(null, bookKey));
  doc.addEventListener(
    "mousedown",
    handleMousedown.bind(null, bookKey),
  );
  doc.addEventListener(
    "mouseup",
    handleMouseup.bind(null, bookKey),
  );
  doc.addEventListener(
    "click",
    handleClick.bind(null, bookKey),
  );
  doc.addEventListener("wheel", handleWheel.bind(null, bookKey), {
    passive: false,
  });
  doc.addEventListener(
    "touchstart",
    handleTouchStart.bind(null, bookKey),
  );
  doc.addEventListener(
    "touchmove",
    handleTouchMove.bind(null, bookKey),
  );
  doc.addEventListener(
    "touchend",
    handleTouchEnd.bind(null, bookKey),
  );
}
