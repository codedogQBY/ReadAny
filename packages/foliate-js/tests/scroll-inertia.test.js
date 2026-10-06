import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    SCROLL_SAMPLE_WINDOW_MS, MIN_INERTIA_START_SPEED,
    estimateScrollVelocity, getInertiaDuration, getInertiaDelta,
} from '../scroll-inertia.js'

const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9,
    `${actual} differs from ${expected}`)
const sample = (delta, dt, time) => ({ delta, dt, time })

test('keeps the accepted sampling window and start threshold', () => {
    assert.equal(SCROLL_SAMPLE_WINDOW_MS, 100)
    assert.equal(MIN_INERTIA_START_SPEED, 0.02)
})

test('empty and expired samples yield no release velocity', () => {
    assert.equal(estimateScrollVelocity([], 200), 0)
    assert.equal(estimateScrollVelocity([sample(60, 20, 100)], 200), 0)
})

test('weights unequal sample intervals by time, not event count', () => {
    closeTo(estimateScrollVelocity([
        sample(60, 60, 160), sample(60, 20, 180), sample(80, 20, 200),
    ], 200), 2)
})

test('clips the portion of a sample outside the time window', () => {
    closeTo(estimateScrollVelocity([
        sample(200, 100, 150), sample(200, 50, 200),
    ], 200), 3)
})

test('includes the time held still before release', () => {
    const samples = Array.from({ length: 10 }, (_, i) => sample(60, 20, (i + 1) * 20))
    closeTo(estimateScrollVelocity(samples, 200), 3)
    closeTo(estimateScrollVelocity(samples, 250), 1.5)
    assert.equal(estimateScrollVelocity(samples, 400), 0)
})

test('stationary touchmove samples contribute time but no distance', () => {
    closeTo(estimateScrollVelocity([sample(150, 50, 150), sample(0, 50, 200)], 200), 1.5)
})

test('short gestures use only their actual duration', () => {
    closeTo(estimateScrollVelocity([sample(30, 10, 200)], 200), 3)
})

test('preserves direction and does not mutate samples', () => {
    const samples = Object.freeze([Object.freeze(sample(-60, 20, 200))])
    closeTo(estimateScrollVelocity(samples, 200), -3)
})

test('natural duration preserves the accepted decay and stop speed', () => {
    closeTo(getInertiaDuration(3), 325 * Math.log(3 / 0.015))
    closeTo(getInertiaDuration(-3), getInertiaDuration(3))
    closeTo(getInertiaDuration(0.1), 616.5639950879114)
})

test('integrated displacement preserves direction and low-speed tails', () => {
    closeTo(getInertiaDelta(3, 0, getInertiaDuration(3)), 970.125)
    closeTo(getInertiaDelta(-3, 0, getInertiaDuration(-3)), -970.125)
    closeTo(getInertiaDelta(0.1, 0, getInertiaDuration(0.1)), 27.625)
    assert.equal(getInertiaDelta(3, 100, 100), 0)
})

test('the same trajectory integrates equally at 30, 60 and 120Hz', () => {
    for (const hz of [30, 60, 120]) {
        const end = getInertiaDuration(3)
        let previous = 0, distance = 0
        while (previous < end) {
            const elapsed = Math.min(end, previous + 1000 / hz)
            distance += getInertiaDelta(3, previous, elapsed)
            previous = elapsed
        }
        closeTo(distance, 970.125)
    }
})

test('a delayed frame does not lose elapsed motion time', () => {
    closeTo(getInertiaDelta(3, 0, 16) + getInertiaDelta(3, 16, 196)
        + getInertiaDelta(3, 196, 500), getInertiaDelta(3, 0, 500))
})
