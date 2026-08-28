#!/bin/bash
find src -type f \( -name "*.tsx" -o -name "*.ts" \) -exec sed -i \
  -e 's/indigo-/emerald-/g' \
  -e 's/amber-/slate-/g' \
  -e 's/purple-/slate-/g' \
  -e 's/blue-/emerald-/g' \
  -e 's/rose-/slate-/g' \
  -e 's/pink-/slate-/g' \
  -e 's/yellow-/slate-/g' \
  -e 's/orange-/slate-/g' \
  -e 's/red-50/slate-100/g' \
  -e 's/red-100/slate-200/g' \
  -e 's/red-200/slate-300/g' \
  -e 's/red-300/slate-400/g' \
  -e 's/red-400/slate-500/g' \
  -e 's/red-500/slate-800/g' \
  -e 's/red-600/slate-900/g' \
  -e 's/red-700/black/g' \
  -e 's/red-800/black/g' \
  -e 's/red-900/black/g' \
  {} +
echo "Recolor complete"
