# strudel-extensions

A collection of self-contained `Pattern.prototype` extensions for [Strudel](https://strudel.cc). Each file is independent — load only the ones you need.

日本語版は下にあります。([Jump to Japanese](#strudel-extensions-日本語))

---

## Usage

Load any module directly from jsDelivr in your Strudel pattern:

```js
await import('https://cdn.jsdelivr.net/gh/nobadag/strudel-extensions@main/preload.mjs')
await import('https://cdn.jsdelivr.net/gh/nobadag/strudel-extensions@main/pickX.mjs')
await import('https://cdn.jsdelivr.net/gh/nobadag/strudel-extensions@main/timestretch.mjs')
```

Or paste a file's contents directly into the top of your pattern / your Strudel `prebake` settings.

---

## Modules

### `preload.mjs` — `.preload(cycles)`

Preloads (fetches + decodes) all sample buffers referenced anywhere in a pattern, silently, ahead of time — so the first real trigger doesn't get skipped while the browser is still loading the sample.

```js
stack(
  s("bd sd hh*4"),
  s("myCustomSample"),
).preload(16) // scan 16 cycles worth of the pattern for sample names, load them silently
```

- `cycles` (default `4`): how many cycles of the pattern to scan for sample names. Increase this for patterns with long structures (e.g. `<A!7 B C!14 ...>`) so later sections get scanned too.
- Works with any `Pattern`, including ones built with `$:` or `stack(...)`.
- Already-loaded samples are tracked globally, so calling `.preload()` again (e.g. on re-evaluation) won't reload what's already cached.

### `pickX.mjs` — `.pickX(variants)`

Selects a different pattern per "section" name, driven by a structure pattern like `"<A!7 B C!14 D!2 E!32>"`.

```js
const song = "<A!7 B C!14 D!2 E!32>"
const variants = {
  A: s("bd*4"),
  B: s("bd sd"),
  C: s("hh*8"),
}
song.pickX(variants)
```

- Section names not found in `variants` fall back to a numeral-stripped key (e.g. `C2` falls back to `C`), then to silence.

### `timestretch.mjs` — `.timeStretch()`, `.loopAtStretch()`, `.fitStretch()`

Pitch-preserving time-stretch functions, built entirely from Strudel's existing `speed` and `stretch` controls — no external libraries.

```js
s("hello_how_are_you").timeStretch("<.5 1 2>").lpf(4000)
s("brk").loopAtStretch(2)
s("brk/2").fitStretch()
```

See [`timestretch.examples.mjs`](./timestretch.examples.mjs) for runnable comparisons against the built-in `loopAt` / `fit`.

**Known limitation:** `stretch` uses a phase vocoder internally, which introduces some inevitable high-frequency artifacts, especially on transient-heavy material (drum breaks, percussive hits). A `.lpf()` on the high end usually masks it well.

**How it works:** `stretch(f)` maps a factor `f` to a frequency multiplier `n`: `n = f + 1` (f ≥ 0), `n = f/4 + 1` (f ≤ 0). To cancel the pitch shift from `speed(k)`, `stretch` needs to apply a multiplier of `1/k`. Solving for `f`: `f = 1/k - 1` (k ≤ 1), `f = 4 * (1/k - 1)` (k ≥ 1). This formula is the core of all three functions.

---

## License

MIT

---

# strudel-extensions (日本語)

[Strudel](https://strudel.cc) 用の、`Pattern.prototype`拡張関数集です。各ファイルは独立していて、必要なものだけ読み込めます。

## 使い方

Strudelのパターン内でjsDelivr経由で直接import:

```js
await import('https://cdn.jsdelivr.net/gh/nobadag/strudel-extensions@main/preload.mjs')
await import('https://cdn.jsdelivr.net/gh/nobadag/strudel-extensions@main/pickX.mjs')
await import('https://cdn.jsdelivr.net/gh/nobadag/strudel-extensions@main/timestretch.mjs')
```

もしくは各ファイルの中身をパターンの先頭やStrudelの`prebake`設定に直接貼り付けても使えます。

## モジュール一覧

### `preload.mjs` — `.preload(cycles)`

パターン内で使われている全サンプルのバッファを、無音で事前にfetch+decodeしておく関数。これにより、ブラウザがまだ読み込み中のせいで本番の1回目のトリガーが空振る問題を防ぎます。

```js
stack(
  s("bd sd hh*4"),
  s("myCustomSample"),
).preload(16) // パターンの16サイクル分をスキャンしてサンプル名を検出、無音で先読み
```

- `cycles`（デフォルト`4`）: サンプル名を検出するためにパターンを何サイクル分スキャンするか。`<A!7 B C!14 ...>`のような長い構成の曲では、後半のセクションも拾えるよう増やしてください。
- `$:`構文でも`stack(...)`でも、どんな`Pattern`にも使えます。
- 読み込み済みのサンプルはグローバルに記録されるため、再評価時に`.preload()`を再度呼んでも、キャッシュ済みのものは読み直しません。

### `pickX.mjs` — `.pickX(variants)`

`"<A!7 B C!14 D!2 E!32>"`のような構成パターンに応じて、セクション名ごとに異なるパターンを選択します。

```js
const song = "<A!7 B C!14 D!2 E!32>"
const variants = {
  A: s("bd*4"),
  B: s("bd sd"),
  C: s("hh*8"),
}
song.pickX(variants)
```

- `variants`に存在しないセクション名は、末尾の数字を除いたキー（例: `C2`→`C`）にフォールバックし、それも無ければ無音になります。

### `timestretch.mjs` — `.timeStretch()`, `.loopAtStretch()`, `.fitStretch()`

既存の`speed`と`stretch`コントロールのみで実現する、ピッチを保ったままのタイムストレッチ関数です。外部ライブラリ不使用。

```js
s("hello_how_are_you").timeStretch("<.5 1 2>").lpf(4000)
s("brk").loopAtStretch(2)
s("brk/2").fitStretch()
```

標準の`loopAt`/`fit`との聴き比べ用サンプルは[`timestretch.examples.mjs`](./timestretch.examples.mjs)を参照してください。

**既知の制限:** `stretch`は内部でフェーズボコーダーを使用しているため、高周波ノイズが不可避的に発生します。特にドラムブレイクのようなトランジェントが多い素材で目立ちます。`.lpf()`で高域をカットすると軽減できます。

**仕組み:** `stretch(f)`はfactor `f`を周波数倍率`n`に変換します: `n = f + 1`（f ≥ 0）、`n = f/4 + 1`（f ≤ 0）。`speed(k)`によるピッチ変化を打ち消すには、`stretch`の倍率を`1/k`にする必要があり、`f`を逆算すると: `f = 1/k - 1`（k ≤ 1）、`f = 4 * (1/k - 1)`（k ≥ 1）。この式が3関数すべての核になっています。

## ライセンス

MIT
