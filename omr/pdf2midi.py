"""Score PDF (or corrected MusicXML) -> Standard MIDI file with a legato pedal per measure.

    omr/.venv/bin/python omr/pdf2midi.py score.pdf score.mid [--bpm 72] [--no-pedal] [--xml-dir DIR]
    omr/.venv/bin/python omr/pdf2midi.py p0.musicxml p1.musicxml ... score.mid   # after fixing in MuseScore

The pages are parsed the same way as page/score.js and joined measure by measure.
--xml-dir keeps the recognised MusicXML, so you can correct it and re-run on the .musicxml files.
Then render it: node tools/render-midi.mjs score.mid score.mp3
"""
import argparse, struct, xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

SEMI = dict(C=0, D=2, E=4, F=5, G=7, A=9, B=11)
TPQ = 480


def num(el, tag):
    x = el.find('.//' + tag)
    return float(x.text) if x is not None and x.text else 0.0


def parse(text):
    """MusicXML -> (beats per measure or 0, parts[measures[events{s, d, p}]]), times in quarter notes."""
    root = ET.fromstring(text)
    beats, parts = 0, []
    for p in root.findall('part'):
        div, measures = 1, []
        for m in p.findall('measure'):
            ev, cur = [], 0.0
            for el in m:
                if el.tag == 'attributes':
                    if el.find('divisions') is not None: div = num(el, 'divisions') or 1
                    if el.find('time/beats') is not None:
                        beats = num(el, 'time/beats') * 4 / (num(el, 'time/beat-type') or 4)
                elif el.tag == 'backup': cur -= num(el, 'duration') / div
                elif el.tag == 'forward': cur += num(el, 'duration') / div
                elif el.tag == 'note' and el.find('grace') is None:
                    d, pitch = num(el, 'duration') / div, []
                    st = el.find('pitch/step')
                    if st is not None and st.text and st.text.strip() in SEMI:
                        pitch = [int(12 * (num(el, 'pitch/octave') + 1) + SEMI[st.text.strip()] + num(el, 'pitch/alter'))]
                    if el.find('chord') is not None and ev: ev[-1]['p'] += pitch
                    else: ev.append(dict(s=cur, d=d, p=pitch)); cur += d
            measures.append(ev)
        parts.append(measures)
    return beats, parts


def mlen(ev):
    return max([e['s'] + e['d'] for e in ev] or [0])


def vlq(n):
    b = [n & 0x7f]; n >>= 7
    while n: b.insert(0, (n & 0x7f) | 0x80); n >>= 7
    return bytes(b)


def chunk(evs):
    evs.sort(key=lambda e: (e[0], e[1]))
    out, last = b'', 0
    for t, _, data in evs: out += vlq(t - last) + data; last = t
    out += b'\x00\xff\x2f\x00'
    return b'MTrk' + struct.pack('>I', len(out)) + out


def to_midi(pages, bpm, pedal=True):
    """pages = [MusicXML text] -> (SMF bytes, summary)."""
    parsed = [parse(t) for t in pages]
    beats = next((b for b, _ in parsed if b), 0)
    merged = parsed[0][1]
    # ponytail: pages are joined measure by measure, assuming the same parts on every page (as score.js does).
    for _, ps in parsed[1:]:
        for i, p in enumerate(ps):
            if i < len(merged): merged[i] += p
    if not beats:  # no time signature in the OMR output: take the most common measure length
        beats = Counter(mlen(m) for p in merged for m in p).most_common(1)[0][0] or 4
    nm = max(len(p) for p in merged)
    tracks, notes = [chunk([(0, 0, b'\xff\x51\x03' + int(60e6 / bpm).to_bytes(3, 'big'))])], 0
    for p in merged:
        evs = []
        for mi, ev in enumerate(p):
            for e in ev:
                for n in e['p']:
                    if 21 <= n <= 108 and e['d'] > 0:
                        on = round((mi * beats + e['s']) * TPQ)
                        off = round((mi * beats + e['s'] + e['d']) * TPQ)
                        evs += [(on, 2, bytes([0x90, n, 80])), (off, 0, bytes([0x80, n, 0]))]
                        notes += 1
        if pedal:  # legato pedal: up at each barline, down a 32nd later (sort key 1 = between note-offs and note-ons)
            for mi in range(nm):
                t = round(mi * beats * TPQ)
                if mi: evs.append((t, 1, bytes([0xb0, 64, 0])))
                evs.append((t + TPQ // 8, 1, bytes([0xb0, 64, 127])))
            evs.append((round(nm * beats * TPQ), 1, bytes([0xb0, 64, 0])))
        tracks.append(chunk(evs))
    smf = b'MThd' + struct.pack('>IHHH', 6, 1, len(tracks), TPQ) + b''.join(tracks)
    return smf, f'{len(merged)} 聲部、{nm} 小節、每小節 {beats:g} 拍、{notes} 個音、約 {nm * beats * 60 / bpm:.0f} 秒'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('inputs', nargs='+', type=Path, help='一份 PDF，或依頁序的 .musicxml 檔')
    ap.add_argument('out', type=Path, help='輸出 .mid')
    ap.add_argument('--bpm', type=float, default=72)
    ap.add_argument('--no-pedal', action='store_true', help='不加每小節的踏板')
    ap.add_argument('--xml-dir', type=Path, help='把辨識出的每頁 MusicXML 存到這裡')
    a = ap.parse_args()
    if a.inputs[0].suffix.lower() == '.pdf':
        from server import run_omr  # needs the venv's homr + pymupdf
        print('辨識中…（每頁約 15 秒）', flush=True)
        pages = [p['musicxml'] for p in run_omr(a.inputs[0].read_bytes())]
        if a.xml_dir:
            a.xml_dir.mkdir(parents=True, exist_ok=True)
            for i, x in enumerate(pages): (a.xml_dir / f'p{i}.musicxml').write_text(x, encoding='utf-8')
    else:
        pages = [p.read_text(encoding='utf-8') for p in a.inputs]
    smf, summary = to_midi(pages, a.bpm, not a.no_pedal)
    a.out.write_bytes(smf)
    print(f'{a.out}：{summary}')


if __name__ == '__main__':
    main()
