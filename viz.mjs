// viz.mjs
//
// Strudelの演奏をWebSocket経由で外部(three.jsビジュアライザ等)に転送する。
// 音声再生自体には一切影響しない、純粋な副作用フック。
//
// 2つの独立した仕組みを提供する:
//
//   .vizHaps()  — hapベース。発音イベント(音程・gain・タイミング等)を送信する。
//                 `Pattern.prototype.draw(callback, {lookbehind, lookahead})` フックの
//                 上に構築されている。
//
//   .vizScope() — 音声信号ベース。差した対象のパターン自身の音声波形を送信する。
//                 superdoughの `.analyze(id)` コントロール(hapごとの、音には影響しない
//                 wet send)を使っているため、真にパターン単位で部分適用できる。
//                 マスター全体の波形が欲しい場合は、これまで通り
//                 `stack(...).vizScope()` のように一番外側に差せばよい
//                 (analyzeがstack全体に均等にかかるため、結果的に全体のミックスになる)。
//
// どちらか片方だけでも、両方チェインしても動く。
//
// 使い方 / usage (strudel.cc REPL):
//
//   await import('https://cdn.jsdelivr.net/gh/nobadag/strudel-extensions@main/viz.mjs')
//
//   stack(
//     s('bd*2 ~ bd sd').bank('RolandTR909').vizScope('ws://localhost:8181', { id: 'drums' }),
//     note('<0 3 7 10>*4').scale('D4:minor').s('sawtooth').vizScope('ws://localhost:8181', { id: 'lead' })
//   ).vizHaps()
//
// 注意: getAnalyzerData / getAnalyserById は superdough → @strudel/webaudio 経由で
//       strudel.ccのevalScopeに既にグローバル展開されているので、別途importしない
//       (別インスタンスを作ると実際の音声グラフと繋がらず機能しない)。

// ══════════════════════════════════════════════════════════
// vizHaps() : hapイベント(発音のタイミング・音程・gain等)を送信
// ══════════════════════════════════════════════════════════

const hapSockets = new Map(); // url -> WebSocket (再評価のたびに繋ぎ直さないための使い回し)
const firedByRoom = new Map(); // id  -> Set(送信済みhapキー、同じ音の重複送信を防ぐ)

function getHapSocket(url) {
  let ws = hapSockets.get(url);
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    ws = new WebSocket(url);
    hapSockets.set(url, ws);
  }
  return ws;
}

function hapKey(hap) {
  return String(hap.whole.begin) + '|' + JSON.stringify(hap.value);
}

/**
 * pattern.vizHaps(url, options)
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
Pattern.prototype.vizHaps = function (url = 'ws://localhost:8181', options = {}) {
  const { lookbehind = 0.5, lookahead = 0.2, id = 'strudel-viz-default' } = options;

  if (!firedByRoom.has(id)) firedByRoom.set(id, new Set());
  const fired = firedByRoom.get(id);

  return this.draw(
    (haps, time) => {
      const ws = getHapSocket(url);
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

// ══════════════════════════════════════════════════════════
// vizScope() : 差した対象のパターン自身の時間波形を送信
//              (superdoughの .analyze(id) を使った、真に部分適用可能な実装)
// ══════════════════════════════════════════════════════════

const scopeSockets = new Map(); // url -> WebSocket
const scopeStarted = new Set(); // `${url}::${id}` -> 送信ループが既に動いているか
let scopeAutoId = 0;

function getScopeSocket(url) {
  let ws = scopeSockets.get(url);
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    ws = new WebSocket(url);
    scopeSockets.set(url, ws);
  }
  return ws;
}

function downsampleWave(src, targetLen) {
  const out = new Array(targetLen);
  const step = src.length / targetLen;
  for (let i = 0; i < targetLen; i++) out[i] = src[Math.floor(i * step)];
  return out;
}

/**
 * pattern.vizScope(url, options)
 *
 * @param {string} url                        中継サーバーのWebSocket URL (default: ws://localhost:8181)
 * @param {object} [options]
 * @param {string} [options.id]               省略時は自動採番。同じ楽器を複数箇所で
 *   チェインして合算したい場合は明示的に揃える。マスター全体が欲しい場合は
 *   stack(...)の一番外側に一度だけ差せばよい。
 * @param {number} [options.fft=5]            analyserのfftSizeは 2**(fft+5)
 * @param {number} [options.waveLength=128]   時間波形を何点に間引いて送るか
 * @param {number} [options.lookbehind=0.5]   .draw()に渡すlookbehind(hap有無判定用)
 * @param {number} [options.lookahead=0.2]    .draw()に渡すlookahead(hap有無判定用)
 */
Pattern.prototype.vizScope = function (url = 'ws://localhost:8181', options = {}) {
  const {
    id = `scope${scopeAutoId++}`,
    fft = 5,
    waveLength = 128,
    lookbehind = 0.5,
    lookahead = 0.2,
  } = options;

  let active = false; // 直近のdrawコールバックで判定した「今鳴っているか」

  const patched = this.draw(
    (haps, time) => {
      // 現在時刻timeを[begin, end)に含むhapが1つでもあれば「鳴っている」
      active = haps.some((hap) => hap.whole.begin <= time && hap.whole.end > time);
    },
    { lookbehind, lookahead, id: `${id}::active` } // vizHaps等のdraw idと衝突させない
  ).analyze(id).fft(fft);

  const key = url + '::' + id;
  if (!scopeStarted.has(key)) {
    scopeStarted.add(key);
    const send = () => {
      const ws = getScopeSocket(url);
      if (ws.readyState === WebSocket.OPEN) {
        const data = getAnalyzerData('time', id);
        if (data) ws.send(JSON.stringify({ type: 'scope', id, active, wave: downsampleWave(data, waveLength) }));
      }
      requestAnimationFrame(send);
    };
    requestAnimationFrame(send);
  }

  return patched;
};
