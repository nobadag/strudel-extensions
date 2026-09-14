// codebeam.mjs
// Strudel REPLエディタの「今画面に見えている範囲」をリアルタイムでWebSocket経由で
// 配信する(beamCode)のに加えて、「今鳴っている音に対応するコード上の位置」も
// 同じ接続で配信する(ハイライト)。
//
// ハイライトが送るのは絶対行番号/列番号(line, startCol, endCol)だけであり、
// その位置に何の文字があるかはbeamCodeが送るコード本文と対応させて初めて意味を
// 持つ。従って両者を別々の独立モジュールにするのではなく、ここで一本化し、
// beamCode()が動いていない状態ではハイライト送信も動かないようにして
// 依存関係をコード上で強制する。
//
// ハイライトは特定のパターンに `.vizHighlight()` のようにチェインする方式では
// なく、beamCode()を呼んだ瞬間から「今REPLで再生中のトップレベルパターン全体」を
// 自動的に追いかける(getPattern()を使用)。個別のパターンに何かを差す必要はない。
//
// IntersectionObserverで可視/不可視の切り替わりだけを検知するため、
// scrollイベントの度に全行のgetBoundingClientRect()を計算する
// 旧実装よりも大幅に軽量（カクつき対策）。
//
// 使い方 / usage (strudel.cc REPLに直接書く。devtoolsコンソールは不要):
//
//   await import('https://cdn.jsdelivr.net/gh/nobadag/strudel-extensions@main/codebeam.mjs')
//
// これだけで、デフォルトURL(ws://localhost:8181)でコード配信とハイライト配信の
// 両方が自動的に始まる。別のURLに繋ぎたい時だけ明示的に呼び直す:
//
//   const { beamCode } = await import('https://cdn.jsdelivr.net/gh/nobadag/strudel-extensions@main/codebeam.mjs')
//   beamCode('ws://別のurl')
//
// beamCode()は同じコードブロックの中に書いてよい。Ctrl+Enterで全体を
// 再評価しても(同じモジュールインスタンスである限り)同じurlの古い接続
// (WebSocket・IntersectionObserver・MutationObserver)は自動的に片付けてから
// 張り直すので、二重に送信され続けることはない。

const instances = new Map(); // url -> controller (再評価時に前の接続を片付けるため)

export function beamCode(url = 'ws://localhost:8181', options = {}) {
  // 同じurlで既に動いているものがあれば、まず綺麗に止めてから作り直す
  // (REPL再評価のたびにbeamCode()を書いても二重に走らないようにする)
  instances.get(url)?.stop();

  const { scrollerSelector = '.cm-scroller', lineSelector = '.cm-line' } = options;
  const ws = new WebSocket(url);
  let scroller = null;
  let connected = false;
  let rafPending = false;
  let io = null;
  let mo = null;

  const send = (type, payload) => {
    if (!connected) return;
    ws.send(JSON.stringify({ type, ...payload }));
  };

  // 絶対行番号の取得方法（試行錯誤の記録）:
  // 当初はCodeMirror6の行番号ガター(.cm-lineNumbers .cm-gutterElement)を
  // .cm-line と同じ並びで読む方式を試したが、Strudelのエディタは行番号
  // ガター自体を表示していない設定になっており、常にnullにフォールバック
  // していた（実機確認済み）。
  // → 代わりに、「.cm-contentのDOM要素が内部的に持つ非公開プロパティ
  //   cmView.view（EditorViewインスタンス）」経由で、公開APIである
  //   view.posAtDOM(el) を使う。DOM要素→ドキュメント上の文字位置に
  //   変換できるので、そこから view.state.doc.lineAt(pos).number で
  //   絶対行番号を確実に取得できる。ガターの表示有無に依存しない。
  const getEditorView = () => document.querySelector('.cm-content')?.cmView?.view ?? null;

  const getLineNumbers = (lineEls) => {
    const view = getEditorView();
    if (!view) return lineEls.map(() => null);
    return lineEls.map((el) => {
      try {
        const pos = view.posAtDOM(el);
        return view.state.doc.lineAt(pos).number;
      } catch {
        return null;
      }
    });
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
      const lineEls = [...scroller.querySelectorAll(lineSelector)];
      const lineNumbers = getLineNumbers(lineEls);
      const visible = [];
      lineEls.forEach((line, idx) => {
        if (isActuallyVisible(line)) {
          visible.push({ n: lineNumbers[idx] ?? null, text: line.textContent });
        }
      });
      send('code', { lines: visible });
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

  // ── ここから旧highlight.mjs由来: 「今鳴っている音」のコード位置を、
  //    beamCodeと同じ接続でハイライトイベントとして送る ──
  //
  // Pattern.prototype.vizHighlight() のように個別のパターンに差す方式はやめ、
  // beamCode()を呼んだ瞬間から「今REPLで再生中のトップレベルパターン全体」を
  // 自動的に追いかける。getPattern()/getTime() は @strudel/core が
  // setPattern()/setTime() 経由で更新している「現在実際に再生されている
  // パターン」へのグローバルなアクセサで、Pattern や getAnalyzerData と
  // 同様にREPLのeval scopeに展開されている。
  //
  // beamCode()が呼ばれた直後はまだそのコードブロックの評価が終わっておらず
  // getPattern()は前回評価時点のものを返す(または初回はundefined)が、
  // 自前のrequestAnimationFrameループにしているので、最初のフレームが
  // 来る頃には評価が完了していて問題にならない。
  //
  // locationsの中身は {start, end} だが、これは {line, column} オブジェクトでは
  // なく、ドキュメント全体に対する絶対文字オフセット（数値2つ）。これを行番号/
  // 列番号に変換するにはドキュメント全文が要るが、.cm-line はCodeMirror6の
  // 仮想化により画面に見えている範囲しかDOM上に存在しないため、DOMスクレイピング
  // だけでは変換できない。上のgetEditorView()で取得したEditorViewインスタンスの
  // view.state.doc.lineAt(offset) を使い、正確に変換する。

  function offsetToLineCol(doc, offset) {
    const line = doc.lineAt(offset);
    return { line: line.number, column: offset - line.from };
  }

  const { highlightLookbehind = 0, highlightLookahead = 0.1 } = options;
  let highlightMemory = [];
  let highlightLast;
  let highlightRaf = null;

  const highlightLoop = () => {
    const pat = getPattern?.();
    if (pat && connected) {
      const _t = Math.max(getTime(), 0);
      const t = _t + highlightLookahead;
      highlightMemory = highlightMemory.filter((h) => h.isInNearPast(highlightLookbehind, _t));
      const begin = Math.max(highlightLast ?? t, t - 1 / 10);
      const haps = pat.queryArc(begin, t).filter((h) => h.hasOnset());
      highlightMemory = highlightMemory.concat(haps);
      highlightLast = t;

      const view = getEditorView();
      if (view) {
        const doc = view.state.doc;
        const ranges = [];
        for (const hap of highlightMemory) {
          const locations = hap.context?.locations;
          if (!locations) continue;
          for (const { start, end } of locations) {
            if (typeof start !== 'number' || typeof end !== 'number') continue;
            const from = offsetToLineCol(doc, start);
            const to = offsetToLineCol(doc, end);
            ranges.push({
              line: from.line,
              startCol: from.column,
              endCol: to.line === from.line ? to.column : doc.lineAt(start).length,
            });
          }
        }
        send('highlight', { ranges });
      }
    }
    highlightRaf = requestAnimationFrame(highlightLoop);
  };
  highlightRaf = requestAnimationFrame(highlightLoop);

  const controller = {
    stop() {
      io?.disconnect();
      mo?.disconnect();
      if (highlightRaf != null) cancelAnimationFrame(highlightRaf);
      ws.close();
      instances.delete(url);
    },
    ws,
    // デバッグ用: 現在「見えている」と判定される行を、キャッシュを介さず
    // その場のジオメトリ判定でライブに返す一時的なアクセサ。
    debugVisible() {
      if (!scroller) return [];
      const lineEls = [...scroller.querySelectorAll(lineSelector)];
      const lineNumbers = getLineNumbers(lineEls);
      return lineEls
        .map((l, idx) => ({
          n: lineNumbers[idx] ?? null,
          connected: l.isConnected,
          text: l.textContent,
          visible: isActuallyVisible(l),
        }))
        .filter((l) => l.visible);
    },
  };
  instances.set(url, controller);
  return controller;
}

// importした時点で、デフォルトURL(ws://localhost:8181)で自動的に起動する。
// 別のURLに繋ぎたい時だけ `const { beamCode } = await import(...); beamCode('ws://別のurl')`
// のように明示的に呼び直せばよい。
//
// なお `instances` はこのモジュールインスタンス内だけのスコープなので、
// (キャッシュ回避のため)?v=Date.now()等で毎回新しいURLとしてimportし直す
// 場合は、前の接続を自動では片付けられない(そもそも別モジュールなので
// 中身を覗けない)。これは他の拡張(vizHaps/vizScope)も含めて元々の
// 「大きく書き換えたらタブをリロードする」運用にそのまま従う形でよい。
beamCode();
