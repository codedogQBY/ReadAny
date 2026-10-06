export const SCROLL_SAMPLE_WINDOW_MS = 100
// Speeds are CSS pixels per millisecond. The lower stop threshold lets a
// started gesture settle without starting inertia for tiny release movements.
export const MIN_INERTIA_START_SPEED = 0.02
const MIN_INERTIA_END_SPEED = 0.015
const FRICTION_TAU_MS = 325

// Samples are chronological { delta (px), dt (ms), time (event timestamp) }.
export const estimateScrollVelocity = (samples, releasedAt) => {
    const cutoff = releasedAt - SCROLL_SAMPLE_WINDOW_MS
    const recent = samples.filter(sample => sample.time > cutoff)
    if (!recent.length) return 0
    // Clip the first interval to the window; time held still before release
    // contributes zero distance, but remains part of the duration.
    const duration = releasedAt - Math.max(cutoff, recent[0].time - recent[0].dt)
    const distance = recent.reduce((sum, sample) => sum
        + sample.delta * Math.min(sample.dt, sample.time - cutoff) / sample.dt, 0)
    return distance / duration
}

// Called for finite release speeds at or above MIN_INERTIA_START_SPEED.
export const getInertiaDuration = velocity =>
    FRICTION_TAU_MS * Math.log(Math.abs(velocity) / MIN_INERTIA_END_SPEED)

// Integrate between elapsed times in ms, clamped to the duration by the caller.
// Returning an interval delta lets the renderer preserve layout compensation
// and carry its own subpixel rounding error independently of the physics.
export const getInertiaDelta = (velocity, previousElapsed, elapsed) =>
    velocity * FRICTION_TAU_MS * (Math.exp(-previousElapsed / FRICTION_TAU_MS)
        - Math.exp(-elapsed / FRICTION_TAU_MS))
