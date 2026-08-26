// strudel-timestretch
//
// Pitch-preserving time-stretch functions for Strudel,
// built on top of the built-in `speed` and `stretch` controls.
//
// Background:
//   - `speed(k)` changes playback speed AND pitch (frequency × k)
//   - `stretch(f)` changes pitch only, using a phase vocoder, where:
//       frequency multiplier = f + 1        (f >= 0)
//       frequency multiplier = f/4 + 1      (f <= 0)
//
// To cancel out the pitch shift introduced by `speed(k)`, we need
// `stretch` to multiply frequency by 1/k. Solving for f:
//
//   f = 1/k - 1            (k <= 1, i.e. slowing down)
//   f = 4 * (1/k - 1)      (k >= 1, i.e. speeding up)
//
// This is why the helper below branches on `speed <= 1`.

/**
 * Change playback speed without changing pitch.
 * Drop-in pitch-preserving alternative to `.speed()`.
 *
 * @param {number} speed - playback speed multiplier (1 = normal, 2 = double speed, 0.5 = half speed)
 *
 * @example
 * s("hello_how_are_you").timeStretch("<.5 1 2>").lpf(4000)
 */
const timeStretch = register('timeStretch', (speed, pat) => {
  return pat.withValue((v) => {
    v.speed = speed
    v.stretch = (1 / speed - 1) * (speed <= 1 ? 1 : 4)
    return v
  })
})

/**
 * Pitch-preserving version of `.loopAt()`.
 * Fits the sample to the given number of cycles by changing speed,
 * then compensates with `stretch` so the pitch stays the same.
 *
 * @param {number} cycles - number of cycles the sample should fit into
 *
 * @example
 * s("brk").loopAtStretch(2)
 */
const loopAtStretch = register('loopAtStretch', (cycles, pat) => {
  return pat.withValue((v) => {
    const entry = soundMap.value?.[v.s]
    const url = entry?.data?.samples?.[v.n ?? 0]
    const buf = getLoadedBuffer(url)
    if (!buf) return v

    const speed = (buf.duration * getCps()) / cycles
    v.speed = speed
    v.stretch = (1 / speed - 1) * (speed <= 1 ? 1 : 4)
    return v
  })
})

/**
 * Pitch-preserving version of `.fit()`.
 * Fits the sample to its event duration by changing speed,
 * then compensates with `stretch` so the pitch stays the same.
 *
 * @example
 * s("brk/2").fitStretch()
 */
const fitStretch = register('fitStretch', (pat) => {
  return pat.withHap((h) => {
    const v = h.value

    const entry = soundMap.value?.[v.s]
    const url = entry?.data?.samples?.[v.n ?? 0]
    const buf = getLoadedBuffer(url)
    if (!buf) return h

    const cycles =
      Number(h.whole.end.n) / Number(h.whole.end.d) -
      Number(h.whole.begin.n) / Number(h.whole.begin.d)
    if (cycles <= 0) return h

    const speed = (buf.duration * getCps()) / cycles
    v.speed = speed
    v.stretch = (1 / speed - 1) * (speed <= 1 ? 1 : 4)
    return h
  })
})
