# Chrono Engineering Retrospective

_Audience: engineering peers_

This document is meant to capture the value of the Chrono work beyond the source code itself: the prompt progression, the product decisions, the debugging patterns, the failures, and the engineering lessons that emerged while shaping the tool.

Chrono ended up as a small local product, but the path to get there mattered as much as the implementation. Most of the useful work was not "write code once and ship"; it was repeated refinement of shell ergonomics, UI semantics, reliability, and installation behavior.

## 1. What Chrono became

Chrono is a lightweight, SQLite-backed history manager for `zsh` with:

- automatic command logging
- a fuzzy picker powered by `fzf`
- newest commands shown at the bottom
- "go up to go back in time" behavior
- whitespace-normalized deduplication
- import/reset/stats tooling
- shell integration that cooperates with `oh-my-zsh` and `zsh-autosuggestions`

More importantly, it became a good example of how a tool can be shaped through rapid human-in-the-loop iteration:

- product direction came from terse, concrete user prompts
- implementation had to be validated in a real interactive shell
- many "bugs" turned out to be semantic mismatches, not code defects

## 2. Prompt progression and what it changed

Below is the prompt arc that most influenced the product.

### Early product prompts

- `"continue"`
  - This surfaced incomplete work already present in tests.
  - Outcome: implemented missing dedup functionality and started treating tests as the source of truth for unfinished features.

- `"do i need to restart? als add a command for reset the memory and to import the history again"`
  - This shifted the tool from "basic history store" to "operable shell utility".
  - Outcome: added `chrono reset`, wired import + dedup, clarified reload/restart expectations.

- `"zsh: command not found: chrono"`
  - This forced attention onto installability rather than only correctness.
  - Outcome: installed the binary, updated shell `PATH`, and tightened the install flow.

### UI and interaction prompts

- `"ahhh... ok, I want to present the same interface as when we do cntrl+R"`
  - This was a key product clarification.
  - The problem was not "make Up arrow smarter"; it was "make Up arrow open the same picker experience".
  - Outcome: Up arrow was rebound to the Chrono search widget instead of incremental line cycling.

- `"rremove the ? at the beginning of each line"`
  - Outcome: simplified the display and removed noisy status decoration.

- `"ok: i like it! now: ... add some shortcut list like atuin ..."`
  - Outcome: triggered research into Atuin's shortcut model.
  - Final decision: the shortcut feature was explored and then removed because terminal/keybinding behavior on macOS was too unreliable for this implementation.

- `"the numbers should move with the selected line. ... check atuin"`
  - This was not just a feature request; it was a request to match a mental model.
  - Outcome: deeper investigation of how Atuin behaves and why reproducing it on top of `fzf` is not straightforward.

### Reliability and correctness prompts

- `"ok, but the chrono must be updated every time a new command is sent"`
  - Outcome: changed logging so commands are persisted before the next prompt returns.

- `"nope, the history presented is always the same"`
  - Outcome: discovered same-second timestamp ordering bugs and fixed ordering semantics in SQLite queries.

- `"first of all: the most recents must be at the bottom. also i cannot see the comands i just entered before opening chrono"`
  - Outcome: two separate fixes:
    - removed hardcoded command filtering that hid recent entries like `ls`
    - adjusted search order semantics so the bottom entry is intentionally the newest

- `"adding the same comand shows the same comand twice... i though we already dedup the commands"`
  - Outcome: discovered apparent duplicates were often whitespace variants like `cmd` vs `cmd `.
  - Fix: normalize commands by trimming at write time and migrate old rows on DB open.

## 3. What worked well

### A. Tight, adversarial feedback loops

The best prompts were short and corrective:

- `"nope"`
- `"verify carefully"`
- `"still the same"`

These were useful because they forced re-validation in the real environment instead of speculative explanation. The work improved most when the cycle was:

1. user reports observed behavior
2. reproduce it in a real shell
3. prove the root cause
4. add a regression test
5. patch the smallest correct thing

### B. Testing the shell, not just the library

Unit tests were necessary but not sufficient.

What worked especially well:

- PTY-based `zsh` integration tests
- wrapper scripts around `fzf` to inspect actual args and input
- direct SQLite inspection of the live database
- comparing "expected UI behavior" against real shell rendering

This was critical for problems involving:

- `zle`
- `oh-my-zsh`
- `zsh-autosuggestions`
- `fzf` layout semantics
- shell prompt timing

### C. Making semantics explicit

Several bugs disappeared once intent was encoded directly rather than inferred:

- "newest at bottom" became explicit oldest→newest query order
- dedup became explicit normalized-command dedup
- "record before next prompt" became synchronous prompt-time logging

In each case, the fix was not bigger logic. It was clearer logic.

### D. Small fixes with hard verification

The strongest pattern throughout the work was:

- avoid broad rewrites
- fix one root cause at a time
- keep a failing test or concrete repro nearby
- verify the installed binary, not only the repo code

That pattern kept shell-specific regressions manageable.

## 4. What did not work well

### A. Assuming UI behavior from `fzf` flags

Several iterations relied on an incorrect mental model of `fzf`.

Examples:

- relying on `--tac` without accounting for layout direction
- assuming `start:last` alone meant "newest at the bottom visually"
- expecting `fzf` keybinding behavior to match Atuin's richer UI model

Lesson:

- in terminal UI work, never trust flag names alone
- inspect the actual rendered screen
- verify both input order and visual layout

### B. Trying to emulate Atuin shortcuts too literally

The numbered shortcut feature looked attractive, but it collided with terminal realities:

- `ctrl-number` combinations are not generally portable
- `alt`/Option behavior on macOS varies by terminal settings
- `fzf` is not a full custom TUI, so some interaction models are awkward to reproduce

Lesson:

- copy the user outcome, not necessarily the exact implementation shape
- if a shell/TUI stack fights a feature too hard, either redesign it or drop it

### C. Filtering commands too aggressively

The original ignore list hid commands such as:

- `ls`
- `pwd`
- `cd`
- `clear`
- `exit`
- `history`

The intent was to reduce noise, but the result was user confusion: Chrono appeared not to record "recent commands".

Lesson:

- silent filtering is dangerous unless the user clearly understands it
- defaults should be behavior-safe, or at least configurable

### D. Treating duplicates as string-equality only

Deduplication initially operated on raw strings, which allowed apparent duplicates to survive:

- `'..'`
- `'.. '`

Lesson:

- normalize data at the boundary
- migrate old stored data as part of the fix
- "same to the user" is often more important than "byte-identical in storage"

## 5. Main engineering problems encountered

### Shell integration conflicts

`oh-my-zsh` and `zsh-autosuggestions` both affect widgets and keybindings.

Key discoveries:

- `oh-my-zsh` binds Up arrow by default
- `zsh-autosuggestions` re-wraps widgets on each `precmd`
- bindings needed to be applied after those systems, not just once

What solved it:

- keymap-specific bindings
- re-applying bindings at `precmd`
- real interactive verification instead of static inspection

### Prompt-time logging bugs

Chrono originally launched background logging with terminal stdio attached.

Effect:

- the logger could race prompt input
- autosuggestion/tab-completion behavior became flaky

What solved it:

- detaching stdio
- then ensuring logging completed at the right point in the prompt lifecycle

### Ordering bugs caused by coarse timestamps

Chrono stores timestamps at one-second resolution.

Effect:

- multiple commands in the same second could appear out of order

What solved it:

- tie-breaking on `id`
- using explicit query order semantics instead of relying on insertion luck

### macOS binary execution quirks

Bun-compiled binaries can be killed on macOS if not signed.

Effect:

- "works locally in repo" could still fail for the installed binary

What solved it:

- codesigning after every compile
- verifying the installed binary in `~/.chrono/bin/chrono`, not just the build artifact

## 6. Patterns worth reusing

These patterns worked well and are worth carrying into similar tools.

### Pattern 1: Reproduce with the installed artifact

Do not stop at:

- tests pass
- source code looks correct

Also verify:

- the installed binary
- the sourced shell plugin
- the live environment the user is actually running

### Pattern 2: Build wrapper-based observability

When a CLI launches another tool, wrap that tool temporarily.

This worked especially well for `fzf`:

- captured real args
- captured real input order
- exposed the hidden reason for the layout mismatch

### Pattern 3: Fix at the boundary

When data problems appear repeatedly, normalize at write time.

Examples:

- trim commands on insert
- migrate old rows on open
- dedup on normalized values

This is more durable than trying to clean presentation-only symptoms later.

### Pattern 4: Distinguish between product bugs and implementation bugs

Some failures were not "the code is broken"; they were:

- wrong interaction model
- wrong default behavior
- wrong user-facing semantics

The best fixes came from re-stating the product truth in plain language:

- "newest must be at the bottom"
- "going up must go back in time"
- "the same command should not show twice"

## 7. Suggested follow-up work

If Chrono continues beyond this phase, the most valuable next steps are:

1. **Config file / user preferences**
   - ignored commands
   - search scope defaults
   - keybinding choices

2. **Release hygiene**
   - clean the historical large Bun build object from Git history
   - tag a first release
   - add a minimal changelog

3. **Better installation ergonomics**
   - automatic `PATH` check
   - clearer macOS signing explanation
   - optional uninstall command

4. **Richer picker UX**
   - maybe replace `fzf` with a custom TUI only if interaction requirements outgrow `fzf`

## 8. Short version for sharing

If this needs to be explained quickly to other engineers:

> Chrono was not just a coding exercise; it was an interaction design exercise inside a hostile environment: `zsh`, `zle`, `oh-my-zsh`, `zsh-autosuggestions`, `fzf`, Bun, macOS signing, and SQLite all had opinions. The code became solid only after we stopped treating symptoms and started verifying real shell behavior, normalizing data at the boundary, and making user semantics explicit.

That is the main value of the project.
