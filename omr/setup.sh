#!/bin/sh
# One-time setup: a venv with oemer, patched for current numpy/OpenCV.
# oemer 0.1.5 still uses `np.int` & co. (removed in numpy 1.24) and breaks on OpenCV 5.
set -e
cd "$(dirname "$0")"
python3 -m venv .venv
.venv/bin/pip install -q oemer pymupdf "opencv-python<5"
perl -pi -e 's/\bnp\.(int|float|bool|object)\b(?!\d)/$1/g' .venv/lib/python*/site-packages/oemer/*.py
echo "ok: .venv/bin/python omr/server.py"
