// viz.mjs
//
// Strudelの発音イベント(hap)をWebSocket経由で外部(three.jsビジュアライザ等)に転送する。
// Sends every triggered hap over WebSocket so an external renderer (e.g. a three.js page)
// can visualize the performance in real time. Audio playback is completely unaffected —
// this is a pure side-effect hook built on top of Strudel's own `.draw()` primitive
// (the same one `.pianoroll()` / `.punchcard()` use internally).
//
// 使い方 / usage (strudel.cc REPL):
//
//   await import('https://cdn.jsdelivr.net/gh/nobadag/strudel-extensions@main/viz.mjs')
//
//   stack(
//     s('bd*2 ~ bd sd').bank('RolandTR909'),
//     s('hh*8').gain(0.5),
//     note('<0 3 7 10>*4').scale('D4:minor').s('sawtooth')
//   ).viz()
//
// 複数のパターンをまとめて送りたい場合はstack()全体の末尾に一度だけ`.viz()`をつければ良い。
// 個別のレイヤーごとに送信先を分けたい場合は options.id を変える:
//   s('bd sd').viz('ws://localhost:8181', { id: 'drums' })
//   note('0 3 7').viz('ws://localhost:8181', { id: 'melody' })

const sockets = new Map();       // url -> WebSocket (再評価のたびに繋ぎ直さないための使い回し)
const firedByRoom = new Map();   // id  -> Set(送信済みhapキー、同じ音の重複送信を防ぐ)

function getSocket(url) {
  let ws = sockets.get(url);
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    ws = new WebSocket(url);
    sockets.set(url, ws);
  }
  return ws;
}

function hapKey(hap) {
  return String(hap.whole.begin) + '|' + JSON.stringify(hap.value);
}

/**
 * pattern.viz(url, options)
 *
 * @param {string} url               中継サーバーのWebSocket URL (default: ws://localhost:8181)
 * @param {object} [options]
 * @param {number} [options.lookbehind=0.5]  .draw()に渡すlookbehind
 * @param {number} [options.lookahead=0.2]   .draw()に渡すlookahead
 * @param {string} [options.id='strudel-viz-default']
 *   .draw()のid。Strudelはこのidをキーに前回の登録を置き換えるため、
 *   コードを再評価しても送信ループが重複・リークしない。
 *   複数系統(ドラム/メロディ等)を別々に送りたい場合だけ変更すればよい。
 */
Pattern.prototype.viz = function (url = 'ws://localhost:8181', options = {}) {
  const { lookbehind = 0.5, lookahead = 0.2, id = 'strudel-viz-default' } = options;

  if (!firedByRoom.has(id)) firedByRoom.set(id, new Set());
  const fired = firedByRoom.get(id);

  return this.draw(
    (haps, time) => {
      const ws = getSocket(url);
      if (ws.readyState !== WebSocket.OPEN) return;

      for (const hap of haps) {
        if (hap.whole.begin > time) continue; // まだ発音前のhapは無視
        const key = hapKey(hap);
        if (fired.has(key)) continue;
        fired.add(key);
        if (fired.size > 1000) fired.clear(); // 単純な上限クリア(メモリ肥大化防止)

        ws.send(
          JSON.stringify({
            value: hap.value,
            begin: Number(hap.whole.begin),
            dur: Number(hap.duration),
          })
        );
      }
    },
    { lookbehind, lookahead, id }
  );
};
