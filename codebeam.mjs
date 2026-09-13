// codebeam.mjs
// Strudel REPLエディタの中身をリアルタイムでWebSocket経由で配信するだけの
// 単機能モジュール。viz.mjs（イベント可視化）とは責務を分離している。
//
// スコープを絞った点:
// - スクロール可視範囲の追従はしない（常にエディタ全体の中身を送る）
// - 評価（Ctrl+Enter）とは無関係。キー入力のたびにDOMの変化を検知して送る
//   （= 今画面に見えているテキストそのままのミラーリング）

export function beamCode(url = 'ws://localhost:8181', {
  editorSelector = '.cm-content',
  debounceMs = 80,
} = {}) {
  const ws = new WebSocket(url);
  let editorEl = null;
  let observer = null;
  let debounceTimer = null;
  let connected = false;

  const send = (text) => {
    if (!connected) return;
    ws.send(JSON.stringify({ type: 'code', text }));
  };

  const scheduleSend = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (editorEl) send(editorEl.innerText);
    }, debounceMs);
  };

  const attach = () => {
    editorEl = document.querySelector(editorSelector);
    if (!editorEl) {
      // エディタがまだDOMに現れていない場合は少し待って再試行
      setTimeout(attach, 300);
      return;
    }
    observer = new MutationObserver(scheduleSend);
    observer.observe(editorEl, { childList: true, characterData: true, subtree: true });
    scheduleSend(); // 初回送信
  };

  ws.addEventListener('open', () => {
    connected = true;
    attach();
  });

  ws.addEventListener('close', () => {
    connected = false;
    if (observer) observer.disconnect();
  });

  return {
    stop() {
      clearTimeout(debounceTimer);
      if (observer) observer.disconnect();
      ws.close();
    },
    ws,
  };
}
