// viz.mjs
//
// Strudelの演奏をWebSocket経由で外部(three.jsビジュアライザ等)に転送する。
// 音声再生自体には一切影響しない、純粋な副作用フック。
//
// 2つの独立した仕組みを提供する:
//
//   .vizHaps()  — hapベース。発音イベント(音程・gain・タイミング等)を送信する。
//                 `.pianoroll()` / `.punchcard()` などが内部で使っているのと同じ
//                 `Pattern.prototype.draw(callback, {lookbehind, lookahead})` フックの上に構築されている。
//
//   .vizScope() — 音声信号ベース。マスター出力(全パターン合成後)の時間波形を送信する。
//                 hapとは無関係に、superdoughが実際に鳴らしている音声そのものから
//                 AnalyserNodeで波形を取得する。
//
// どちらか片方だけでも、両方チェインしても動く。
//
// 使い方 / usage (strudel.cc REPL):
//
//   await import('https://cdn.jsdelivr.net/gh/nobadag/strudel-extensions@main/viz.mjs')
//
//   stack(
//     s('bd*2 ~ bd sd').bank('RolandTR909'),
//     s('hh*8').gain(0.5),
//     note('<0 3 7 10>*4').scale('D4:minor').s('sawtooth')
//   ).vizHaps().vizScope()
//
// 注意: .vizScope() は AudioNode.prototype.connect を書き換えて
//       マスター出力にAnalyserNodeを差し込む。この副作用は一度きりなので、
//       コードを試行錯誤する間はタブをリロードしてから評価し直すこと
//       (リロードなしで再評価を繰り返すと、内部状態が中途半端に残ることがある)。

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
// vizScope() : マスター出力(全パターン合成後)の時間波形を送信
// ══════════════════════════════════════════════════════════

const scopeState = {
  analyser: null, // 共有AnalyserNode。destinationへ繋がる全ノードをここに集約する
  tapInstalled: false,
  loopStarted: false,
  sockets: new Map(),
};

// destination(スピーカー出口)への接続を検知し、共有analyserに繋ぎ替える。
// superdoughはノートごとに使い捨てのgainノードを作って直接destinationに繋ぐ構成なので、
// 「マスターgainを名指しで掴む」のではなく「destinationへの接続そのものを横取りする」方式にしている。
function installDestinationTap(fftSize) {
  if (scopeState.tapInstalled) return;
  scopeState.tapInstalled = true;

  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (typeof AudioDestinationNode !== 'undefined' && dest instanceof AudioDestinationNode) {
      const ctx = this.context;
      if (!scopeState.analyser) {
        scopeState.analyser = ctx.createAnalyser();
        scopeState.analyser.fftSize = fftSize;
        scopeState.analyser.smoothingTimeConstant = 0.7;
        origConnect.call(scopeState.analyser, ctx.destination); // analyser→destinationは一度だけ
        console.log('[vizScope] shared analyser created');
      }
      // 個々のノードはdestinationの代わりに共有analyserへ繋ぎ替える(音は素通り)
      return origConnect.call(this, scopeState.analyser);
    }
    return origConnect.call(this, dest, ...rest);
  };
}

function getScopeSocket(url) {
  let ws = scopeState.sockets.get(url);
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    ws = new WebSocket(url);
    scopeState.sockets.set(url, ws);
  }
  return ws;
}

// 時間波形(Uint8Array, 0-255)を-1〜1の配列に間引きながら正規化する
function downsampleWave(src, targetLen) {
  const out = new Array(targetLen);
  const step = src.length / targetLen;
  for (let i = 0; i < targetLen; i++) {
    out[i] = (src[Math.floor(i * step)] - 128) / 128;
  }
  return out;
}

/**
 * pattern.vizScope(url, options)
 *
 * @param {string} url                       中継サーバーのWebSocket URL (default: ws://localhost:8181)
 * @param {object} [options]
 * @param {number} [options.fftSize=1024]    analyserのFFTサイズ(2の累乗)。波形の時間分解能に影響。
 * @param {number} [options.waveLength=128]  時間波形を何点に間引いて送るか
 */
Pattern.prototype.vizScope = function (url = 'ws://localhost:8181', options = {}) {
  const { fftSize = 1024, waveLength = 128 } = options;

  installDestinationTap(fftSize);

  if (!scopeState.loopStarted) {
    scopeState.loopStarted = true;
    const timeData = new Uint8Array(fftSize);

    function send() {
      const ws = getScopeSocket(url);
      if (scopeState.analyser && ws.readyState === WebSocket.OPEN) {
        scopeState.analyser.getByteTimeDomainData(timeData);
        ws.send(
          JSON.stringify({
            type: 'scope',
            wave: downsampleWave(timeData, waveLength),
          })
        );
      }
      requestAnimationFrame(send);
    }
    requestAnimationFrame(send);
  }

  return this; // 副作用のみ、パターン自体は変更しない
};
