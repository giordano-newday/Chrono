#!/usr/bin/env bash
set -euo pipefail

CHRONO_DIR="$HOME/.chrono"
BIN_DIR="$CHRONO_DIR/bin"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🕐 chrono installer"
echo ""

# ── Check dependencies ────────────────────────────────────
if ! command -v bun &>/dev/null; then
  echo "❌ Bun is required but not installed."
  echo "   Install: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

if ! command -v fzf &>/dev/null; then
  echo "⚠️  fzf is not installed. 'chrono search' (Ctrl+R) will not work."
  echo "   Install: brew install fzf"
  echo ""
fi

# ── Build ─────────────────────────────────────────────────
echo "📦 Installing dependencies..."
cd "$SCRIPT_DIR"
bun install --frozen-lockfile 2>/dev/null || bun install

echo "🔨 Building chrono binary..."
bun build src/index.ts --compile --outfile chrono

# ── Install ───────────────────────────────────────────────
echo "📂 Installing to $CHRONO_DIR..."
mkdir -p "$BIN_DIR"
cp chrono "$BIN_DIR/chrono"
chmod +x "$BIN_DIR/chrono"
cp chrono.zsh "$CHRONO_DIR/chrono.zsh"

# ── Import history ────────────────────────────────────────
if [[ -f "$HOME/.zsh_history" ]]; then
  echo "📜 Importing existing zsh history..."
  "$BIN_DIR/chrono" import "$HOME/.zsh_history"
fi

# ── Hook into .zshrc ──────────────────────────────────────
ZSHRC="$HOME/.zshrc"
SOURCE_LINE='source "$HOME/.chrono/chrono.zsh"'

if ! grep -qF "$SOURCE_LINE" "$ZSHRC" 2>/dev/null; then
  echo "" >> "$ZSHRC"
  echo "# chrono — smart shell history" >> "$ZSHRC"
  echo "$SOURCE_LINE" >> "$ZSHRC"
  echo "✅ Added chrono to $ZSHRC"
else
  echo "✅ chrono already in $ZSHRC"
fi

echo ""
echo "🎉 Done! Run 'source ~/.zshrc' or open a new terminal."

# ── Clean up build artifact ───────────────────────────────
rm -f "$SCRIPT_DIR/chrono"
