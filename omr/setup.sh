#!/bin/sh
# One-time setup: a venv with homr (OMR) and its models (downloaded by --init).
# homr needs Python 3.11–3.15; prefer an older one since onnxruntime wheels lag new Pythons.
set -e
cd "$(dirname "$0")"
PY=$(command -v python3.12 || command -v python3.11 || echo python3)
"$PY" -m venv .venv
.venv/bin/pip install -q homr pymupdf
.venv/bin/homr --init
echo "ok: .venv/bin/python omr/server.py"
echo "    or: omr/.venv/bin/python omr/pdf2midi.py score.pdf score.mid && node tools/render-midi.mjs score.mid score.mp3"
