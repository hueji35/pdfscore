/* PDFScore — 밴드 악보 모드 (alphaTab)
 * Guitar Pro(.gp/.gpx/.gp3~5) 파일과 PDF에서 읽어 낸 밴드 악보를 TAB·드럼까지 그리고 재생한다.
 * app.js가 만든 화면 요소와 도우미 함수를 받아서, 같은 재생 버튼·파트 패널로 조작한다. */
window.createTabMode = function (h) {
  "use strict";
  const { ui } = h;
  const base = new URL("lib/alphatab/", location.href).href;
  const host = document.createElement("div");
  host.id = "tabScore";
  host.hidden = true;
  ui.wrap.appendChild(host);

  let api = null, tracks = [], parts = [], playing = false, posMs = 0, endMs = 0, ready = false;
  let rate = 1, zoom = 1, autoScroll = true;
  let unroll = false, original = null, keep = null; // 원래 악보와, 다시 그릴 때 이어 받을 파트 설정

  function settings() {
    const AT = alphaTab;
    return {
      core: {
        fontDirectory: base + "font/",
        scriptFile: base + "alphaTab.min.js",
        useWorkers: location.protocol !== "file:", // file:// 에서는 Worker를 만들 수 없음
        engine: "svg",
      },
      display: { scale: zoom, layoutMode: AT.LayoutMode.Page },
      player: {
        playerMode: AT.PlayerMode.EnabledSynthesizer,
        soundFont: base + "soundfont/sonivox.sf2",
        scrollElement: ui.wrap,
        scrollMode: autoScroll ? AT.ScrollMode.Continuous : AT.ScrollMode.Off,
        enableCursor: true,
        enableAnimatedBeatCursor: true,
        enableUserInteraction: true, // 악보를 누르면 그 위치로 이동
      },
    };
  }

  function ensureApi() {
    if (api) return api;
    api = new alphaTab.AlphaTabApi(host, settings());
    api.scoreLoaded.on(score => {
      tracks = score.tracks;
      if (h.baseTempo) h.baseTempo(score.tempo || 120);
      document.title = (score.title || h.fileName() || "악보") + " — PDFScore";
      buildParts();
      if (ready) applyAllAudio();
      // alphaTab은 기본으로 첫 트랙만 그리므로 보이는 트랙을 모두 그리게 한다
      const shown = parts.filter(p => p.visible).map(p => p.track);
      if (tracks.length > 1) setTimeout(() => api.renderTracks(shown), 0);
    });
    api.renderFinished.on(() => h.hideOverlay());
    api.soundFontLoad.on(e => {
      if (e.total) h.status(`악기 소리 불러오는 중… ${Math.round((e.loaded / e.total) * 100)}%`);
    });
    api.playerReady.on(() => { ready = true; h.status(null); applyAllAudio(); });
    api.playerStateChanged.on(e => {
      playing = e.state === 1;
      ui.play.textContent = playing ? "⏸" : "▶";
    });
    api.playerPositionChanged.on(e => {
      posMs = e.currentTime; endMs = e.endTime;
      h.time(posMs / 1000, endMs / 1000);
    });
    api.error.on(err => { console.error(err); h.hideOverlay(); h.alert("악보를 열 수 없습니다", (err && err.message) || String(err)); });
    return api;
  }

  /* ---------- 파트 패널 ---------- */
  function buildParts() {
    const old = keep && keep.length === tracks.length ? keep : null;
    parts = tracks.map((t, i) => ({ track: t, visible: true, audible: true, volume: 1, index: i, ...(old && old[i]) }));
    keep = null;
    ui.partList.innerHTML = "";
    parts.forEach((p, i) => {
      const drum = p.track.staves.some(s => s.isPercussion);
      const li = document.createElement("li");
      li.className = "part";
      li.innerHTML = `
        <div class="name" title="${h.escapeHtml(p.track.name)}">${h.escapeHtml(p.track.name || `트랙 ${i + 1}`)}${drum ? " <small>드럼</small>" : ""}</div>
        <label class="toggle" title="악보에 표시"><input type="checkbox" data-k="visible"${p.visible ? " checked" : ""}>👁</label>
        <label class="toggle" title="소리"><input type="checkbox" data-k="audible"${p.audible ? " checked" : ""}>🔊</label>
        <div class="row2"><input type="range" min="0" max="1.5" step="0.05" value="${p.volume}" title="음량"></div>`;
      li.querySelector('[data-k="visible"]').onchange = e => setVisible(i, e.target.checked);
      li.querySelector('[data-k="audible"]').onchange = e => setAudible(i, e.target.checked);
      li.querySelector("input[type=range]").oninput = e => { p.volume = +e.target.value; api.changeTrackVolume([p.track], p.volume); };
      p.li = li;
      ui.partList.appendChild(li);
    });
  }
  let renderTimer = 0;
  function setVisible(i, on) {
    const p = parts[i];
    if (!on && parts.filter(x => x.visible).length <= 1) {
      p.li.querySelector('[data-k="visible"]').checked = true;
      h.toast("최소 한 파트는 악보에 표시해야 합니다.");
      return;
    }
    p.visible = on;
    p.li.querySelector('[data-k="visible"]').checked = on;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => api.renderTracks(parts.filter(x => x.visible).map(x => x.track)), 60);
  }
  function setAudible(i, on) {
    const p = parts[i];
    p.audible = on;
    p.li.querySelector('[data-k="audible"]').checked = on;
    if (ready) api.changeTrackMute([p.track], !on);
  }
  function applyAllAudio() {
    for (const p of parts) {
      api.changeTrackMute([p.track], !p.audible);
      api.changeTrackVolume([p.track], p.volume);
    }
    api.playbackSpeed = rate;
  }

  /* ---------- 연주 순서 펼치기 ---------- */
  /** 도돌이표·괄호·D.S.·Coda를 alphaTab이 연주하는 순서대로 펼친 새 Score를 만든다 */
  function unrollScore(score) {
    const AT = alphaTab, st = new AT.Settings();
    const gen = new AT.midi.MidiFileGenerator(score, st, new AT.midi.AlphaSynthMidiFileHandler(new AT.midi.MidiFile()));
    gen.generate();
    const order = gen.tickLookup.masterBars.map(m => m.masterBar.index);
    if (order.every((x, i) => x === i)) return score;
    const o = JSON.parse(AT.model.JsonConverter.scoreToJson(score));
    // 마디마다 그 시점의 템포 (앞으로 되돌아갈 때 다시 적어 준다)
    const tempoAt = [];
    let tempo = score.tempo || 120;
    o.masterbars.forEach((m, i) => { tempoAt[i] = tempo; for (const a of m.tempoautomations || []) tempo = a.value; });
    const tempoAfter = i => { const a = o.masterbars[i].tempoautomations || []; return a.length ? a[a.length - 1].value : tempoAt[i]; };
    o.masterbars = order.map((i, k) => {
      const m = structuredClone(o.masterbars[i]);
      m.isrepeatstart = false; m.repeatcount = 0; m.alternateendings = 0;
      delete m.directions;
      if (k > 0 && order[k - 1] !== i - 1 && tempoAfter(order[k - 1]) !== tempoAt[i] && !(m.tempoautomations || []).some(a => a.ratioposition === 0))
        m.tempoautomations = [{ islinear: false, type: 0, value: tempoAt[i], ratioposition: 0, text: "", isvisible: false }, ...(m.tempoautomations || [])];
      if (k > 0) m.isanacrusis = false;
      return m;
    });
    // 같은 마디를 여러 번 쓰므로 id를 새로 매긴다. 붙임줄·슬러 등 다른 마디의 음을 가리키는 연결은
    // 펼친 순서에서 바로 앞뒤 마디일 때만 남긴다 (되돌아가는 자리에서는 끊는다)
    const notesOf = bar => bar.voices.flatMap(v => v.beats.flatMap(b => b.notes));
    let barId = 0, voiceId = 0, beatId = 0, noteId = 0;
    for (const t of o.tracks) for (const s of t.staves) {
      const src = s.bars, home = new Map();
      src.forEach((bar, i) => { for (const n of notesOf(bar)) home.set(n.id, i); });
      const copies = order.map(i => structuredClone(src[i]));
      const ids = copies.map(bar => {
        const map = new Map();
        bar.id = barId++;
        for (const v of bar.voices) { v.id = voiceId++; for (const b of v.beats) b.id = beatId++; }
        for (const n of notesOf(bar)) { map.set(n.id, noteId); n.id = noteId++; }
        return map;
      });
      copies.forEach((bar, k) => {
        for (const n of notesOf(bar)) {
          for (const key of Object.keys(n)) {
            const m = key.match(/^(\w+?)(origin|destination|target)noteid$/);
            if (!m || typeof n[key] !== "number" || n[key] < 0) continue;
            const j = home.get(n[key]), back = m[2] === "origin";
            const kk = j === order[k] ? k : back ? (order[k - 1] === j ? k - 1 : -1) : (order[k + 1] === j ? k + 1 : -1);
            const nid = kk >= 0 ? ids[kk].get(n[key]) : undefined;
            if (nid !== undefined) { n[key] = nid; continue; }
            delete n[key];
            const flag = "is" + m[1] + (back ? "destination" : "origin");
            if (flag in n) n[flag] = false;
          }
        }
      });
      s.bars = copies;
    }
    return AT.model.JsonConverter.jsonToScore(JSON.stringify(o), st);
  }

  function show() {
    let score = original;
    if (unroll) try { score = unrollScore(original); } catch (err) { console.warn("unroll failed", err); }
    ensureApi().renderScore(score);
    return score !== original;
  }

  /* ---------- 외부에서 쓰는 기능 ---------- */
  return {
    get active() { return !host.hidden; },
    get playing() { return playing; },
    activate() {
      host.hidden = false;
      ui.score.hidden = true;
    },
    deactivate() {
      if (api) { try { api.stop(); } catch { /* 무시 */ } }
      host.hidden = true;
      ui.score.hidden = false;
    },
    /** Guitar Pro 등 파일 바이트를 연다 */
    loadFile(bytes) {
      this.activate();
      ready = false;
      keep = null;
      original = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, ensureApi().settings);
      show();
    },
    /** 이미 만들어진 alphaTab Score 객체를 연다 (PDF에서 읽어 낸 악보) */
    loadScore(score) {
      this.activate();
      ready = false;
      keep = null;
      original = score;
      show();
    },
    /** 반복 기호를 그대로 둘지(false), 연주 순서대로 펼칠지(true). 켰는데 펼칠 것이 없으면 false */
    setUnroll(on) {
      unroll = on;
      if (!original) return true;
      api.stop();
      keep = parts.map(p => ({ visible: p.visible, audible: p.audible, volume: p.volume }));
      return show() || !on;
    },
    toggle() { if (api) api.playPause(); },
    stop() { if (api) api.stop(); },
    seekRatio(r) { if (api && endMs) api.timePosition = r * endMs; },
    setRate(r) { rate = r; if (api) api.playbackSpeed = r; },
    setZoom(z) {
      zoom = z;
      if (!api) return;
      api.settings.display.scale = z;
      api.updateSettings();
      api.render();
    },
    setAutoScroll(on) {
      autoScroll = on;
      if (!api) return;
      api.settings.player.scrollMode = on ? alphaTab.ScrollMode.Continuous : alphaTab.ScrollMode.Off;
      api.updateSettings();
    },
    toggleAll(kind) {
      if (kind === "show") {
        const allOn = parts.every(p => p.visible);
        parts.forEach((p, i) => { if (!allOn || i > 0) setVisible(i, !allOn); });
      } else {
        const allOn = parts.every(p => p.audible);
        parts.forEach((p, i) => setAudible(i, !allOn));
      }
    },
    get api() { return api; },
  };
};
