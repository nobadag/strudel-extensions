// Examples — paste these into the Strudel REPL after loading timestretch.mjs
// (see README for how to load it)

// 1. timeStretch — change duration without changing pitch
samples('shabda/speech/en-US/ f:hello_how_are_you')
s("hello_how_are_you").timeStretch("<.5 1 2>").lpf(4000)

// 2. loopAtStretch vs loopAt — compare pitch behavior side by side
$: s("brk/2").struct("<x - ->/2")
$: s("brk/2").loopAt(2).struct("<- x ->/2")        // pitch shifts
$: s("brk/2").loopAtStretch(2).struct("<- - x>/2") // pitch stays the same

// 3. fitStretch vs fit — same comparison, event-duration based
$: s("brk/2").struct("<x - ->/2")
$: s("brk/2").fit().struct("<- x ->/2")        // pitch shifts
$: s("brk/2").fitStretch().struct("<- - x>/2") // pitch stays the same
