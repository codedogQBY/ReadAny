export const hasActiveTextSelection = (contents) => {
  for (const { doc } of contents ?? []) {
    const selection = doc?.getSelection?.();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return true;
  }
  return false;
};

export class PaginatorTouchTracker {
  state;
  scrolled = false;

  start(touch, timeStamp, startPosition) {
    this.state = {
      x: touch?.screenX,
      y: touch?.screenY,
      t: timeStamp,
      vx: 0,
      xy: 0,
      dx: 0,
      dy: 0,
      dt: 0,
      scrollVelocity: 0,
      scrollSamples: [],
      startX: touch?.screenX,
      startY: touch?.screenY,
      startPosition,
      didPreventDefault: false,
    };
    this.scrolled = false;
    return this.state;
  }

  markScrolled() {
    this.scrolled = true;
  }

  cancel() {
    const restorePosition =
      this.scrolled && Number.isFinite(this.state?.startPosition) ? this.state.startPosition : null;
    this.state = undefined;
    this.scrolled = false;
    return restorePosition;
  }

  takeSelectionStart(currentPosition) {
    const position = Number.isFinite(this.state?.startPosition)
      ? this.state.startPosition
      : currentPosition;
    this.state = undefined;
    this.scrolled = false;
    return position;
  }

  finish() {
    const state = this.scrolled ? (this.state ?? null) : null;
    this.state = undefined;
    this.scrolled = false;
    return state;
  }
}

export class SelectionPositionGuard {
  position;
  navigating = false;

  get active() {
    return Number.isFinite(this.position);
  }

  begin(position) {
    if (!this.active && Number.isFinite(position)) this.position = position;
  }

  correctionFor(currentPosition) {
    if (!this.active || this.navigating || !Number.isFinite(currentPosition)) return null;
    return Math.abs(currentPosition - this.position) > 0.5 ? this.position : null;
  }

  beginNavigation() {
    if (this.active) this.navigating = true;
  }

  finishNavigation(position) {
    if (this.active && Number.isFinite(position)) this.position = position;
    this.navigating = false;
  }

  end() {
    this.position = undefined;
    this.navigating = false;
  }
}
