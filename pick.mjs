Pattern.prototype.pickX = function (variants) {
  const flat = {};
  for (const [keys, val] of Object.entries(variants)) {
    keys.split(',').forEach(k => { flat[k.trim()] = val; });
  }
  const resolve = (key) => flat[key] ?? flat[key.replace(/\d+$/, '')] ?? silence;

  return this.fmap(resolve).innerJoin();
};