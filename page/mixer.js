// 混音台。分成兩組，因為它們作用的地方不同：
//   bus  （音效、音樂）   ＝ 匯流排音量，立即生效，兩個頁面的聲音都受影響 → 放「主控」
//   part （主旋律、貝斯、鼓組）＝ 只有「音樂」這條匯流排產生時才存在     → 放「音樂」
// MIDI 走音樂匯流排，但它的內容是即時算出來的，聲部推桿不會重建它；這種時候把聲部標成
// 未生效（.inactive ＋ 一行提示），而不是讓推桿看起來有作用卻沒聲音。

const STRIPS = [
  ['sfx', '音效', 'bus'],
  ['music', '音樂', 'bus'],
  ['lead', '主旋律', 'part'],
  ['bass', '貝斯', 'part'],
  ['drums', '鼓組', 'part'],
];

export function createMixer({ audio, busHost, partHost, info, reset, partHint, onChange = () => {} }) {
  const strips = {};

  for (const [key, label, kind] of STRIPS) {
    const el = document.createElement('div');
    el.className = `strip${kind === 'bus' ? ' bus' : ''}`;
    el.innerHTML = `<span class="name">${label}</span><span class="val"></span>
      <input type="range" min="0" max="1" step="0.01" aria-label="${label}音量">
      <div class="row"><button data-act="mute" title="靜音">M</button>${kind === 'bus' ? '' : '<button data-act="solo" title="獨奏">S</button>'}</div>`;
    const s = { key, label, kind, el, level: 1, mute: false, solo: false, fader: el.querySelector('input') };
    s.fader.oninput = () => { s.level = +s.fader.value; paint(); if (kind === 'bus') apply(); };
    s.fader.onchange = () => { if (kind === 'part') apply(); onChange(); };
    el.querySelector('.row').onclick = (e) => {
      const act = e.target.dataset.act;
      if (!act) return;
      s[act] = !s[act];
      paint();
      apply();
      onChange();
    };
    strips[key] = s;
    (kind === 'bus' ? busHost : partHost).append(el);
  }

  /** 推桿、靜音、獨奏合成之後，引擎實際看到的音量。 */
  function effective() {
    const anySolo = STRIPS.some(([k]) => strips[k].solo);
    const out = {};
    for (const [k, , kind] of STRIPS) {
      const s = strips[k];
      out[k] = s.mute || (kind === 'part' && anySolo && !s.solo) ? 0 : s.level;
    }
    return out;
  }

  function paint() {
    const eff = effective();
    for (const [k] of STRIPS) {
      const s = strips[k];
      s.fader.value = s.level;
      s.el.querySelector('.val').textContent = `${Math.round(s.level * 100)}%`;
      for (const b of s.el.querySelectorAll('button')) b.classList.toggle('on', s[b.dataset.act]);
      s.el.classList.toggle('silent', eff[k] === 0);
    }
  }

  // 匯流排立即生效；聲部是烘進音樂迴圈的，重算一次要幾十毫秒，所以放開推桿才算，
  // 而且把一串連續變動合成一次。
  let timer = 0;
  function apply() {
    const eff = effective();
    clearTimeout(timer);
    audio.setMix({ sfx: eff.sfx, music: eff.music });
    timer = setTimeout(() => {
      const t0 = performance.now();
      audio.setMix(effective());
      const ms = performance.now() - t0;
      if (info) info.textContent = ms > 2 ? `重新合成音樂 ${ms.toFixed(1)} ms` : '';
    }, 120);
  }

  function setPartsActive(active) {
    for (const [k, , kind] of STRIPS) {
      if (kind === 'part') strips[k].el.classList.toggle('inactive', !active);
    }
    if (partHint) partHint.textContent = active ? '' : 'MIDI 播放中：這三條推桿只作用於上方產生的音樂';
  }

  function snapshot() {
    const out = {};
    for (const [k] of STRIPS) {
      const s = strips[k];
      out[k] = { level: s.level, mute: s.mute, solo: s.solo };
    }
    return out;
  }

  function restore(saved) {
    if (!saved || typeof saved !== 'object') return;
    for (const [k] of STRIPS) {
      const v = saved[k];
      if (!v || typeof v !== 'object') continue;
      const s = strips[k];
      if (Number.isFinite(v.level)) s.level = Math.min(1, Math.max(0, v.level));
      s.mute = !!v.mute;
      s.solo = !!v.solo;
    }
    paint();
    apply();
  }

  function resetAll() {
    for (const [k] of STRIPS) Object.assign(strips[k], { level: 1, mute: false, solo: false });
    paint();
    apply();
    onChange();
  }

  if (reset) reset.onclick = resetAll;
  paint();

  return { effective, paint, apply, setPartsActive, snapshot, restore, resetAll, strips };
}
