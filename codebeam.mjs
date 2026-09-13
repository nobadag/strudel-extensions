// codebeam.mjs
// Strudel REPLエディタの「今画面に見えている範囲」だけをリアルタイムで
// WebSocket経由で配信する。viz.mjs（イベント可視化）とは責務を分離した
// 独立モジュール。
//
// IntersectionObserverで可視/不可視の切り替わりだけを検知するため、
// scrollイベントの度に全行のgetBoundingClientRect()を計算する
// 旧実装よりも大幅に軽量（カクつき対策）。

export function beamCode(url = 'ws://localhost:8181', {
  scrollerSelector = '.cm-scroller',
  lineSelector = '.cm-line',
} = {}) {
  const ws = new WebSocket(url);
  let scroller = null;
  let connected = false;
  let rafPending = false;

  let io = null;
  let mo = null;

  const send = (text) => {
    if (!connected) return;
    ws.send(JSON.stringify({ type: 'code', text }));
  };

  // 「見えているかどうか」の判定は、ここ一箇所だけで完結させる。
  // 以前は IntersectionObserver の isIntersecting をキャッシュして
  // 使い回していたが、CodeMirror6のDOM再利用でキャッシュと実態が
  // ズレる問題があった（1行目だけ残り続けるバグ）。
  // かといって「ネイティブのIO判定」と「手動ジオメトリ判定」の
  // 2つの真実の状態を同時に持つと、今度は互いが差分ありと誤検知して
  // 無限に再送信し合うフィードバックループになる（実際に発生した）。
  // → 対策: 永続キャッシュを一切持たず、送信の瞬間に毎回その場で
  //   ジオメトリ判定する。IO/MOは「いつ再チェックすべきか」を知らせる
  //   トリガーとしてのみ使う。
  const isActuallyVisible = (line) => {
    if (!line.isConnected) return false;
    const lineRect = line.getBoundingClientRect();
    const rootRect = scroller.getBoundingClientRect();
    return lineRect.bottom > rootRect.top && lineRect.top < rootRect.bottom;
  };

  const scheduleSend = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!scroller) return;
      const lines = scroller.querySelectorAll(lineSelector);
      const visible = [];
      lines.forEach((line) => {
        if (isActuallyVisible(line)) visible.push(line.textContent);
      });
      send(visible.join('\n'));
    });
  };

  const attach = () => {
    scroller = document.querySelector(scrollerSelector);
    if (!scroller) {
      setTimeout(attach, 300);
      return;
    }

    // IOはネイティブのisIntersectingを一切キャッシュせず、変化があった
    // という事実だけを使ってscheduleSend()を呼ぶ。実際に何が見えているか
    // の判定はscheduleSend内のisActuallyVisibleに一本化する。
    io = new IntersectionObserver((entries) => {
      if (entries.length > 0) scheduleSend();
    }, { root: scroller, threshold: 0 });

    scroller.querySelectorAll(lineSelector).forEach((el) => io.observe(el));

    mo = new MutationObserver((mutations) => {
      let structureChanged = false;
      let textChanged = false;

      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.matches?.(lineSelector)) {
            io.observe(node);
            structureChanged = true;
          }
          node.querySelectorAll?.(lineSelector).forEach((el) => {
            io.observe(el);
            structureChanged = true;
          });
        });
        m.removedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.matches?.(lineSelector)) {
            io.unobserve(node);
            structureChanged = true;
          }
          node.querySelectorAll?.(lineSelector).forEach((el) => {
            io.unobserve(el);
            structureChanged = true;
          });
        });
        if (m.type === 'characterData') textChanged = true;
      });

      if (structureChanged || textChanged) scheduleSend();
    });
    mo.observe(scroller, { childList: true, characterData: true, subtree: true });

    scheduleSend();
  };

  ws.addEventListener('open', () => {
    connected = true;
    attach();
  });

  ws.addEventListener('close', () => {
    connected = false;
    io?.disconnect();
    mo?.disconnect();
  });

  return {
    stop() {
      io?.disconnect();
      mo?.disconnect();
      ws.close();
    },
    ws,
    // デバッグ用: 現在「見えている」と判定される行を、キャッシュを介さず
    // その場のジオメトリ判定でライブに返す一時的なアクセサ。
    debugVisible() {
      if (!scroller) return [];
      return [...scroller.querySelectorAll(lineSelector)]
        .filter(isActuallyVisible)
        .map((l) => ({ connected: l.isConnected, text: l.textContent }));
    },
  };
}
