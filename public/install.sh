#!/bin/sh
set -e

REPO="https://github.com/legendum/loggers.git"
INSTALL_DIR="$HOME/.config/loggers/src"

echo "Installing loggers..."

# Check for bun
if ! command -v bun >/dev/null 2>&1; then
  echo "Bun not found. Installing..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
  echo "Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull
else
  echo "Cloning repository..."
  git clone "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Install dependencies
bun install

# Link globally
bun link

echo ""
echo "Done! Run 'loggers' to get started."
echo ""
echo "Quick start:"
echo "  cd your-project"
echo "  # first run prompts for your logger ULID and saves LOGGERS_ULID in .env"
echo "  loggers"
echo "  loggers sdk"
