// Preloads audio buffers for a Pattern before it's actually played,
// so the first real trigger doesn't get skipped while the sample
// is still being fetched/decoded.

const _preloadSeen = new Set();

Pattern.prototype.preload = function (cycles = 4) {
  const ac = getAudioContext();
  setTimeout(async () => {
    const jobs = [];
    for (let i = 0; i < cycles; i++) {
      this.queryArc(i, i + 1).forEach((hap) => {
        const v = hap.value;
        if (!v || !v.s) return;
        const key = v.s + ':' + (v.n ?? 0) + ':' + (v.bank ?? '');
        if (_preloadSeen.has(key)) return;
        _preloadSeen.add(key);
        jobs.push(
          Promise.resolve(
            superdough(Object.assign({}, v, { gain: 0 }), ac.currentTime, 0.01)
          ).catch((e) => console.warn('preload failed', key, e))
        );
      });
    }
    await Promise.all(jobs);
    if (jobs.length) console.log('preload: +' + jobs.length + ' samples');
  }, 0);
  return this;
};
