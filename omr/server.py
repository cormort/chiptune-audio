"""Local OMR server: serves the repo and turns an uploaded score PDF into MusicXML.

    omr/setup.sh                    # once: venv + oemer
    omr/.venv/bin/python omr/server.py   # then open http://localhost:8765/score.html

POST /omr (body = PDF bytes) -> {"pages": [{"image": "data:image/png;base64,...", "musicxml": "..."}]}
"""
import base64, json, subprocess, sys, tempfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
OEMER = Path(sys.executable).parent / 'oemer'
MAX_PDF = 20 * 1024 * 1024
MAX_PAGES = 10  # oemer takes ~1 min per page


def run_omr(pdf: bytes) -> list[dict]:
    pages = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        doc = pymupdf.open(stream=pdf, filetype='pdf')
        for i, page in enumerate(doc):
            if i >= MAX_PAGES:
                break
            png = tmp / f'p{i}.png'
            page.get_pixmap(dpi=200).save(png)
            out = tmp / f'out{i}'
            out.mkdir()
            r = subprocess.run([str(OEMER), '-o', str(out), str(png)], capture_output=True, text=True)
            xml = out / f'p{i}.musicxml'
            if not xml.exists():
                raise RuntimeError(f'第 {i + 1} 頁辨識失敗：{r.stderr.strip().splitlines()[-1:]}')
            pages.append({
                'image': 'data:image/png;base64,' + base64.b64encode(png.read_bytes()).decode(),
                'musicxml': xml.read_text(encoding='utf-8'),
            })
    return pages


class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/omr':
            return self.send_error(404)
        n = int(self.headers.get('Content-Length', 0))
        if not 0 < n <= MAX_PDF:
            return self.reply(413, {'error': f'PDF 需小於 {MAX_PDF >> 20} MB'})
        body = self.rfile.read(n)
        if not body.startswith(b'%PDF'):
            return self.reply(400, {'error': '這不是 PDF 檔'})
        try:
            self.reply(200, {'pages': run_omr(body)})
        except Exception as e:  # report to the page instead of a bare 500
            self.reply(500, {'error': str(e)})

    def reply(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == '__main__':
    # ponytail: localhost only, one request at a time per thread, no auth: a dev tool, not a service.
    srv = ThreadingHTTPServer(('127.0.0.1', 8765), partial(Handler, directory=str(ROOT)))
    print('http://localhost:8765/score.html')
    srv.serve_forever()
