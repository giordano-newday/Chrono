# Chrono

Chrono is a lightweight, SQLite-backed shell history manager for `zsh`.

It records commands locally, deduplicates them, and gives you an Atuin-style fuzzy history picker with the newest commands at the bottom so moving upward takes you back in time.

## Features

- Automatic command logging from `zsh`
- Local-only history stored in `~/.chrono/history.db`
- Fuzzy search UI powered by `fzf`
- Newest commands shown at the bottom of the picker
- Exact-history dedup with whitespace normalization
- Import, reset, stats, and manual dedup commands
- Single compiled binary built with Bun

## Requirements

- `zsh`
- [Bun](https://bun.sh/) for building/installing
- [`fzf`](https://github.com/junegunn/fzf) for the interactive picker

On macOS, the compiled binary may need code signing. The installer handles that automatically.

## Install

```bash
git clone https://github.com/giordano-newday/Chrono.git
cd Chrono
chmod +x install.sh
./install.sh
```

If you want to run `chrono` directly from the terminal, make sure the binary directory is on your `PATH`:

```bash
echo 'export PATH="$HOME/.chrono/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

The installer:

- builds the binary with Bun
- signs it on macOS
- copies files into `~/.chrono/`
- imports your existing `~/.zsh_history` if present
- appends `source "$HOME/.chrono/chrono.zsh"` to `~/.zshrc` if needed

## Usage

After installation, commands are recorded automatically.

### Keybindings

- `↑` opens Chrono search
- `Ctrl+R` opens Chrono search

When the picker opens:

- the newest command is at the bottom
- moving up goes backward in time
- `Enter` pastes the selected command back into your prompt

### CLI

```bash
chrono search [global|directory|session]
chrono import [file]
chrono reset [file]
chrono dedup
chrono stats
```

Internal subcommands used by the shell integration:

```bash
chrono add "<command>" [duration_ms] [exit_code]
chrono up "<prefix>" <offset>
```

## Examples

Search all history:

```bash
chrono search
```

Search only the current directory:

```bash
chrono search directory
```

See basic usage stats:

```bash
chrono stats
```

Reset the database and re-import from your zsh history:

```bash
chrono reset ~/.zsh_history
```

## How it works

Chrono stores history in:

```text
~/.chrono/history.db
```

Each entry includes:

- command text
- working directory
- host
- timestamp
- duration
- exit code
- session id

On startup, Chrono also normalizes old rows by trimming edge whitespace and collapsing duplicate command variants such as `cmd` vs `cmd `.

## Development

Run the test suite:

```bash
bun test
```

Build the binary:

```bash
bun build src/index.ts --compile --outfile chrono
codesign -f -s - chrono
```

## Why Chrono?

Chrono is meant to stay simple:

- no cloud sync
- no daemon
- no external service
- just fast local shell history with a better search experience
