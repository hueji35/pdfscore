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
      document.title = (score.title || h.fileName() || "악보") + " — PDFScore";
      buildParts();
      // alphaTab은 기본으로 첫 트랙만 그리므로 모든 트랙을 그리게 한다
      if (tracks.length > 1) setTimeout(() => api.renderTracks(tracks), 0);
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
    parts = tracks.map((t, i) => ({ track: t, visible: true, audible: true, volume: 1, index: i }));
    ui.partList.innerHTML = "";
    parts.forEach((p, i) => {
      const drum = p.track.staves.some(s => s.isPercussion);
      const li = document.createElement("li");
      li.className = "part";
      li.innerHTML = `
        <div class="name" title="${h.escapeHtml(p.track.name)}">${h.escapeHtml(p.track.name || `트랙 ${i + 1}`)}${drum ? " <small>드럼</small>" : ""}</div>
        <label class="toggle" title="악보에 표시"><input type="checkbox" data-k="visible" checked>👁</label>
        <label class="toggle" title="소리"><input type="checkbox" data-k="audible" checked>🔊</label>
        <div class="row2"><input type="range" min="0" max="1.5" step="0.05" value="1" title="음량"></div>`;
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
      ensureApi().load(bytes);
    },
    /** 이미 만들어진 alphaTab Score 객체를 연다 (PDF에서 읽어 낸 악보) */
    loadScore(score) {
      this.activate();
      ready = false;
      ensureApi().renderScore(score);
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
