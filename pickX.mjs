/*
pickX.mjs - pickX and friends: pick-family helpers with automatic silence
fallback, multi-key assignment ('B,C': pattern), and numeric-suffix
fallback (C1/C2 -> C) for song-structure patterns.

Built on top of Strudel core's join primitives (see @strudel/core pick.mjs
and pattern.mjs), which follow the exact same shape:
  _pick(lookup, pat).<join>()
pickX simply defers key resolution to query time via fmap(resolve), so no
upfront enumeration of a song's part names is ever required.
*/

function _resolveX(variants) {
  const flat = {};
  for (const [keys, val] of Object.entries(variants)) {
    keys.split(',').forEach((k) => {
      flat[k.trim()] = val;
    });
  }
  return (key) => flat[key] ?? flat[key.replace(/\d+$/, '')] ?? silence;
}

// pick -> innerJoin: keeps the absolute cycle position of the picked pattern.
// Good for tracks that should keep evolving across part boundaries.
Pattern.prototype.pickX = function (variants) {
  return this.fmap(_resolveX(variants)).innerJoin();
};

// pickRestart -> restartJoin: restarts the picked pattern from its absolute
// cycle 0 on every onset of the outer (song) pattern. Use for tracks where
// phase drift across part boundaries is audible (e.g. panned/L-R patterns).
Pattern.prototype.pickRestartX = function (variants) {
  return this.fmap(_resolveX(variants)).restartJoin();
};

// pickReset -> resetJoin: resets the picked pattern to the start of the
// *current* cycle (not absolute cycle 0) on every onset of the outer pattern.
Pattern.prototype.pickResetX = function (variants) {
  return this.fmap(_resolveX(variants)).resetJoin();
};

// pickOut -> outerJoin: the outer (song) pattern's structure wins; useful
// when the song pattern itself encodes multiple simultaneous layers.
Pattern.prototype.pickOutX = function (variants) {
  return this.fmap(_resolveX(variants)).outerJoin();
};

// inhabit / pickSqueeze -> squeezeJoin: squeezes one full cycle of the
// picked pattern into the duration of the selecting slot.
Pattern.prototype.pickSqueezeX = function (variants) {
  return this.fmap(_resolveX(variants)).squeezeJoin();
};
