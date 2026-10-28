/* PDFScore — 악보 뷰어 + 파트별 표시/소리 + MIDI 재생 + 자동 스크롤 */
(() => {
  "use strict";

  // General MIDI 프로그램 번호(0~127) → midi-js-soundfonts 악기 이름
  const GM = ("acoustic_grand_piano bright_acoustic_piano electric_grand_piano honkytonk_piano electric_piano_1 " +
    "electric_piano_2 harpsichord clavinet celesta glockenspiel music_box vibraphone marimba xylophone tubular_bells " +
    "dulcimer drawbar_organ percussive_organ rock_organ church_organ reed_organ accordion harmonica tango_accordion " +
    "acoustic_guitar_nylon acoustic_guitar_steel electric_guitar_jazz electric_guitar_clean electric_guitar_muted " +
    "overdriven_guitar distortion_guitar guitar_harmonics acoustic_bass electric_bass_finger electric_bass_pick " +
    "fretless_bass slap_bass_1 slap_bass_2 synth_bass_1 synth_bass_2 violin viola cello contrabass tremolo_strings " +
    "pizzicato_strings orchestral_harp timpani string_ensemble_1 string_ensemble_2 synth_strings_1 synth_strings_2 " +
    "choir_aahs voice_oohs synth_choir orchestra_hit trumpet trombone tuba muted_trumpet french_horn brass_section " +
    "synth_brass_1 synth_brass_2 soprano_sax alto_sax tenor_sax baritone_sax oboe english_horn bassoon clarinet " +
    "piccolo flute recorder pan_flute blown_bottle shakuhachi whistle ocarina lead_1_square lead_2_sawtooth " +
    "lead_3_calliope lead_4_chiff lead_5_charang lead_6_voice lead_7_fifths lead_8_bass__lead pad_1_new_age " +
    "pad_2_warm pad_3_polysynth pad_4_choir pad_5_bowed pad_6_metallic pad_7_halo pad_8_sweep fx_1_rain " +
    "fx_2_soundtrack fx_3_crystal fx_4_atmosphere fx_5_brightness fx_6_goblins fx_7_echoes fx_8_scifi sitar banjo " +
    "shamisen koto kalimba bagpipe fiddle shanai tinkle_bell agogo steel_drums woodblock taiko_drum melodic_tom " +
    "synth_drum reverse_cymbal guitar_fret_noise breath_noise seashore bird_tweet telephone_ring helicopter applause " +
    "gunshot").split(" ");
  const DRUMS = 128; // 내부용: 타악기 파트
  const SOUNDFONT_CDN = "https://gleitz.github.io/midi-js-soundfonts/MusyngKite/";

  // 악기 이름으로 GM 프로그램 추정 (OMR 결과는 프로그램 정보가 없는 경우가 많음)
  const NAME_HINTS = [
    [/drum|perc|kit|드럼|타악/i, DRUMS], [/piccolo|피콜로/i, 72], [/flute|fl\.|플루트/i, 73],
    [/oboe|오보에/i, 68], [/english horn|cor anglais/i, 69], [/clarinet|cl\.|클라리넷/i, 71],
    [/bassoon|fagott|바순/i, 70], [/soprano sax/i, 64], [/alto sax|알토 ?색소/i, 65], [/tenor sax|테너 ?색소/i, 66],
    [/bari(tone)? sax/i, 67], [/sax|색소폰/i, 65], [/horn|cor\b|호른/i, 60], [/trumpet|tpt|트럼펫/i, 56],
    [/trombone|tbn|트롬본/i, 57], [/tuba|튜바/i, 58], [/timpani|팀파니/i, 47], [/harp|하프/i, 46],
    [/viol(a|e)\b|비올라/i, 41], [/violoncell|cello|vc\.|첼로/i, 42], [/contrabass|double bass|kontrabass|콘트라베이스/i, 43],
    [/violin|vln|바이올린/i, 40], [/strings|현악/i, 48], [/choir|chorus|합창/i, 52],
    [/soprano|alto|tenor|bass(o)? voice|voice|vocal|소프라노|알토|테너|베이스 ?성부|보컬|노래/i, 53],
    [/organ|오르간/i, 19], [/accordion|아코디언/i, 21], [/guitar|기타/i, 24], [/bass|베이스/i, 33],
    [/marimba|마림바/i, 12], [/xylophone|실로폰/i, 13], [/vibra/i, 11], [/glocken|글로켄/i, 9],
    [/celesta|첼레스타/i, 8], [/harpsichord|하프시코드/i, 6], [/piano|pno|피아노/i, 0],
  ];

  const $ = id => document.getElementById(id);
  const ui = {
    file: $("fileInput"),
    play: $("playBtn"), stop: $("stopBtn"), rewind: $("rewindBtn"),
    tempo: $("tempo"), tempoOut: $("tempoOut"), zoomIn: $("zoomIn"), zoomOut: $("zoomOut"), zoomVal: $("zoomVal"),
    autoScroll: $("autoScroll"), partsBtn: $("partsBtn"), partList: $("partList"),
    seek: $("seek"), timeCur: $("timeCur"), timeTotal: $("timeTotal"),
    wrap: $("scoreWrap"), score: $("score"), welcome: $("welcome"),
    overlay: $("overlay"), overlayMsg: $("overlayMsg"), toast: $("toast"), dropHint: $("dropHint"),
    dialog: $("msgDialog"), cancel: $("cancelBtn"), save: $("saveBtn"), omrBar: $("omrBar"), omrBarMsg: $("omrBarMsg"), omrBarCancel: $("omrBarCancel"), msgTitle: $("msgTitle"), msgBody: $("msgBody"),
  };

  const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(ui.score, {
    autoResize: false,
    backend: "svg",
    drawTitle: true,
    drawPartNames: true,
    followCursor: false,
    cursorsOptions: [{ type: 0, color: "#3b82f6", alpha: 0.45, follow: false }],
  });

  const state = {
    loaded: false,
    parts: [],        // {name, inst, visible, audible, volume, program, gain, player, loadingToken}
    events: [],       // {t, dur, midi, part, vel}  (t, dur: 초, 원래 템포 기준)
    steps: [],        // {sec, ets, sts}  커서 위치별 시작 시각
    totalSec: 0,
    zoom: window.innerWidth < 500 ? 0.7 : 1, // 폰에서는 한 줄에 더 많은 마디가 보이도록
    rate: 1,
    playing: false,
    posSec: 0,        // 정지/일시정지 상태의 위치
    startCtx: 0, startPos: 0, nextEv: 0,
    cursorStep: -1,
    activeNodes: new Set(),
    timer: 0,
    seeking: false,
  };

  let ctx = null, master = null, noiseBuf = null;
  let localSoundfonts = false;
  serverStatus().then(st => { localSoundfonts = !!(st && st.soundfonts); });

  /* ------------------------------------------------------------------ 유틸 */
  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function showOverlay(msg, cancellable = false) {
    ui.overlayMsg.textContent = msg; ui.overlay.hidden = false; ui.cancel.hidden = !cancellable;
  }
  function hideOverlay() { ui.overlay.hidden = true; }
  let toastTimer = 0;
  function toast(msg, ms = 3000) {
    ui.toast.textContent = msg; ui.toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (ui.toast.hidden = true), ms);
  }
  function alertBox(title, html) {
    ui.msgTitle.textContent = title; ui.msgBody.innerHTML = html;
    if (ui.dialog.showModal) ui.dialog.showModal(); else alert(title + "\n\n" + ui.msgBody.textContent);
  }
  // 오버레이가 화면에 그려질 시간을 줌 (rAF는 백그라운드 탭에서 멈추므로 setTimeout 사용)
  const nextFrame = () => new Promise(r => setTimeout(r, 30));

  /* ------------------------------------------------------------- 파일 열기 */
  const OMR_EXT = /\.(pdf|png|jpe?g|tiff?|bmp)$/i;
  const GP_EXT = /\.(gp|gpx|gp3|gp4|gp5|gp7)$/i;
  let fileName = "";

  // alphaTab(1MB)은 밴드 악보를 열 때만 불러온다
  let alphaTabLoading = null;
  function loadAlphaTab() {
    if (window.alphaTab) return Promise.resolve();
    if (!alphaTabLoading) {
      alphaTabLoading = new Promise((res, rej) => {
        const sc = document.createElement("script");
        sc.src = "lib/alphatab/alphaTab.min.js";
        sc.onload = res;
        sc.onerror = () => { alphaTabLoading = null; rej(new Error("alphaTab을 불러오지 못했습니다.")); };
        document.head.appendChild(sc);
      });
    }
    return alphaTabLoading;
  }
  async function openTabFile(file) {
    showOverlay("밴드 악보 여는 중…");
    await loadAlphaTab();
    enterTabMode();
    tab.loadFile(new Uint8Array(await file.arrayBuffer()));
  }
  /**
   * 악보 프로그램이 만든(벡터) 밴드 스코어 PDF를 그림 인식 없이 데이터로 읽어 밴드 악보 모드로 연다.
   * 해당하지 않는 PDF면 false를 돌려주고, 호출한 쪽이 그림 인식(OMR)으로 넘어간다.
   */
  async function openVectorPdf(file) {
    if (location.protocol === "file:") return false; // ES 모듈은 웹 주소로 열었을 때만
    showOverlay("PDF 악보 데이터 읽는 중…");
    const [pdfjs, { extractPage, DOC_OPTIONS }, B, { SHAPES }] = await Promise.all([
      import("./lib/pdfjs/pdf.min.mjs"), import("./pdfvector.js"), import("./bandscore.js"), import("./bandshapes.js")]);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("lib/pdfjs/pdf.worker.min.mjs", location.href).href;
    const classify = B.makeClassifier(SHAPES);
    // 악보 글꼴로 찍은 기호(피아노 악보 등)의 윤곽을 받기 위한 옵션 포함
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), ...DOC_OPTIONS }).promise;
    const pages = [];
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        showOverlay(`PDF 악보 데이터 읽는 중… ${i}/${doc.numPages}쪽`);
        const pg = await extractPage(pdfjs, await doc.getPage(i));
        for (const g of pg.glyphs) g.cls = classify(g.segs);
        pages.push(pg);
        if (i === Math.min(3, doc.numPages) && !B.looksLikeBandScore(pages)) return false; // 앞 몇 쪽으로 판단
      }
    } finally {
      doc.destroy();
    }
    if (!B.looksLikeBandScore(pages)) return false;
    showOverlay("악보로 정리하는 중…");
    const score = B.parseBandScore(pages);
    if (!score.parts.length || !score.bars.length) return false;
    const title = file.name.replace(/\.pdf$/i, "");
    const tempo = B.detectTempo(pages);
    const tex = B.toAlphaTex(score, title, tempo || 120);
    await loadAlphaTab();
    const imp = new alphaTab.importer.AlphaTexImporter();
    imp.initFromString(tex, new alphaTab.Settings());
    let atScore;
    try {
      atScore = imp.readScore();
    } catch (err) {
      console.error("alphaTex", err.message, [...(imp.semanticDiagnostics?.items || [])].slice(0, 5).map(x => x.message));
      window.pdfscore.lastTex = tex;
      throw new Error("PDF에서 읽은 악보를 정리하지 못했습니다.");
    }
    enterTabMode();
    tab.loadScore(atScore);
    window.pdfscore.lastTex = tex;
    toast(`PDF 데이터로 ${score.bars.length}마디를 읽었습니다${tempo ? "" : " (템포 표시가 없어 ♩=120으로 시작합니다. 템포 슬라이더로 맞춰 주세요)"}.` +
      (score.report.length ? " " + score.report.join(" ") : ""), 8000);
    return true;
  }

  function enterTabMode() {
    pause();
    state.loaded = false;
    ui.save.hidden = true;
    ui.welcome.hidden = true;
    document.body.classList.add("has-score");
    if (window.innerWidth <= 760) document.body.classList.add("parts-hidden");
    [ui.play, ui.stop, ui.rewind, ui.seek].forEach(el => (el.disabled = false));
  }

  async function openFile(file) {
    if (!file) return;
    if (omrRunning && omrAbort) omrAbort.abort();
    stop();
    if (tab.active) tab.stop();
    fileName = file.name;
    try {
      if (GP_EXT.test(file.name)) {
        await openTabFile(file);
      } else if (/\.pdf$/i.test(file.name) && await openVectorPdf(file)) {
        // 악보 프로그램이 만든 PDF: 그림 인식 없이 데이터로 읽었음
      } else if (OMR_EXT.test(file.name)) {
        await openViaOmr(file);
      } else if (/\.mxl$/i.test(file.name)) {
        showOverlay("악보 여는 중…");
        await loadScore(await readBinaryString(file), file.name);
      } else {
        showOverlay("악보 여는 중…");
        await loadScoreSafe(await file.text(), file.name);
      }
    } catch (err) {
      console.error(err);
      hideOverlay();
      alertBox("악보를 열 수 없습니다", `<p>${escapeHtml(err.message || String(err))}</p>`);
    }
  }

  function readBinaryString(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsBinaryString(file);
    });
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function serverStatus() {
    if (!/^https?:$/.test(location.protocol)) return null;
    try {
      const r = await fetch("api/status", { cache: "no-store" });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  }

  /* ------------------------------------- PDF/이미지 악보 인식 (브라우저 안에서) */
  // homr-web: 악보 인식 모델을 onnxruntime-web(WebGPU 또는 WebAssembly)으로 이 기기에서 직접 실행한다.
  // WebGPU가 기기에 따라 멈추는 경우가 있어, 멈추면 호환 모드(wasm)로 바꾸고 기억해 둔다
  const BACKEND_KEY = "pdfscore.omrBackend.v2";
  const BACKEND_KO = { webgpu: "WebGPU (빠름)", "wasm-threads": "멀티스레드", wasm: "호환 모드 (느림)" };
  let engines = [];   // 만들어 둔 인식 엔진(Worker) 목록. 한 엔진은 한 번에 한 페이지만 읽는다
  function preferredBackend() {
    try { return localStorage.getItem(BACKEND_KEY) || undefined; } catch { return undefined; }
  }
  async function createEngine() {
    const m = await import("./lib/omr/omr.js");
    return m.createRecognizer({ baseUrl: "models/", wasmPaths: "lib/omr/ort/", prefer: preferredBackend() });
  }
  async function getEngines(n) {
    while (engines.length < n) engines.push(createEngine().catch(err => { engines = []; throw err; }));
    return Promise.all(engines.slice(0, n));
  }
  async function resetEngines(downgrade) {
    if (downgrade) try { localStorage.setItem(BACKEND_KEY, "wasm"); } catch { /* 저장소 사용 불가 */ }
    const old = engines; engines = [];
    for (const p of old) p.then(r => r.dispose()).catch(() => {});
  }
  // 여러 페이지는 PC에서 엔진 두 개로 동시에 읽는다 (폰은 메모리 때문에 하나)
  function engineCount(pages) {
    const mobile = matchMedia("(pointer: coarse)").matches || (navigator.deviceMemory && navigator.deviceMemory < 8);
    const forced = +new URLSearchParams(location.search).get("engines"); // 시험용: ?engines=3
    if (forced > 0) return Math.min(forced, Math.max(1, pages));
    return pages > 1 && !mobile ? 2 : 1;
  }

  // 엔진 미리 준비: 모델 내려받기·GPU 초기화를 파일을 고르는 동안 끝내 둔다.
  // 작은 악보 한 줄을 실제로 인식시켜서 모든 모델과 GPU 셰이더를 한 번에 준비한다.
  let warmup = null, warmMsg = null;
  function warmUpEngine() {
    if (warmup || location.protocol === "file:") return warmup;
    warmup = (async () => {
      await checkModelsStored();
      const [engine] = await getEngines(1);
      const png = await renderWarmupImage();
      const t = performance.now();
      await engine.recognizePage(png, {
        ocr: false,
        onProgress: ({ stage, done, total }) => {
          warmMsg = stage === "models" && done < total ? modelMsg(done, total) : "악보 인식 엔진 준비 중…";
        },
      });
      keepModels();
      modelsStored = true;
      console.info(`OMR warm-up (${engine.backend}) ${((performance.now() - t) / 1000).toFixed(1)}s`);
    })().catch(err => console.warn("OMR warm-up failed", err)).finally(() => { warmMsg = null; });
    return warmup;
  }
  async function renderWarmupImage() {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:-10000px;top:0;width:900px;background:#fff";
    document.body.appendChild(box);
    try {
      const notes = ["C5", "E5", "G5", "E5", "D5", "F5", "A5", "F5"].map(p =>
        `<note><pitch><step>${p[0]}</step><octave>${p[1]}</octave></pitch><duration>1</duration><type>quarter</type></note>`);
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name></part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key>
<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${notes.slice(0, 4).join("")}</measure>
<measure number="2">${notes.slice(4).join("")}</measure></part></score-partwise>`;
      const o = new opensheetmusicdisplay.OpenSheetMusicDisplay(box, { autoResize: false, drawTitle: false, drawPartNames: false });
      await o.load(xml);
      o.render();
      const svg = box.querySelector("svg");
      const w = svg.width.baseVal.value, h = svg.height.baseVal.value;
      const img = new Image();
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      await img.decode();
      const c = document.createElement("canvas");
      c.width = 1600; c.height = Math.round((h * 1600) / w);
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(r => c.toBlob(r, "image/png"));
    } finally {
      box.remove();
    }
  }

  // 엔진은 저장소(Cache API)에서 모델을 읽을 때도 내려받을 때와 같은 진행 신호를 보낸다.
  // 그래서 저장소에 모델이 이미 있는지 직접 확인해서 문구를 고른다.
  let modelsStored = null;
  async function checkModelsStored() {
    try {
      const keys = await (await caches.open("homr-web-models")).keys();
      modelsStored = keys.length >= 3; // 분할·인코더·디코더 모델
    } catch { modelsStored = false; }
    return modelsStored;
  }
  function modelMsg(done, total) {
    if (modelsStored) return "저장된 악보 인식 모델 불러오는 중…";
    const mb = x => (x / 1048576).toFixed(0);
    return `악보 인식 모델 내려받는 중… ${mb(done)} / ${mb(total)} MB\n(이 기기에서 처음 한 번만 받고, 다음부터는 저장된 것을 씁니다)`;
  }
  // 모델을 받은 뒤 브라우저가 저장 공간 정리 때 지우지 않도록 '영구 저장'을 요청한다
  function keepModels() {
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* 지원 안 함 */ }
  }

  const STAGE_KO = { segment: "악보 구조 분석", detect: "오선 찾기", dewarp: "기울기 보정", staff: "오선별 음표 읽기",
    ocr: "글자 읽기", xml: "MusicXML 만들기", tab: "타브 확인", models: "모델 준비" };

  // 페이지 공급원: 이미지는 그대로 1장, PDF는 엔진이 가져갈 때마다 한 장씩 그린다
  // (18쪽짜리를 미리 다 그리면 첫 페이지 인식이 그만큼 늦어지고 메모리도 많이 든다)
  async function openPages(file) {
    if (!/\.pdf$/i.test(file.name)) return { count: 1, get: async () => file, close() {} };
    const pdfjs = await import("./lib/pdfjs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("lib/pdfjs/pdf.worker.min.mjs", location.href).href;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    let chain = Promise.resolve(); // pdf.js 렌더링은 한 번에 하나씩
    const render = async i => {
      const page = await pdf.getPage(i + 1);
      const vp1 = page.getViewport({ scale: 1 });
      // 약 300dpi 상당, 긴 변 최대 3000px
      const vp = page.getViewport({ scale: Math.min(300 / 72, 3000 / Math.max(vp1.width, vp1.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const g = canvas.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
      // intent "print": 화면용 렌더링은 requestAnimationFrame을 써서 탭이 가려지면 멈추므로
      await page.render({ canvasContext: g, viewport: vp, intent: "print" }).promise;
      const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
      canvas.width = canvas.height = 0; // 폰 메모리 절약
      page.cleanup();
      return blob;
    };
    return {
      count: pdf.numPages,
      get: i => (chain = chain.then(() => render(i), () => render(i))),
      close: () => pdf.destroy(),
    };
  }

  /* 인식 결과 저장소 (IndexedDB): 같은 파일을 다시 열면 바로 보여 주고, 중간에 멈췄으면 이어서 읽는다 */
  const RESULT_VERSION = "homr0.7-1"; // 인식 방식이 바뀌면 올려서 예전 결과를 무효화
  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((res, rej) => {
        const r = indexedDB.open("pdfscore", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("pages");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }).catch(err => { console.warn("IndexedDB unavailable", err); return null; });
    }
    return dbPromise;
  }
  async function cacheGet(key) {
    const d = await db();
    if (!d) return undefined;
    return new Promise(res => {
      const r = d.transaction("pages").objectStore("pages").get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(undefined);
    });
  }
  async function cachePut(key, value) {
    const d = await db();
    if (!d) return;
    try { d.transaction("pages", "readwrite").objectStore("pages").put(value, key); } catch { /* 저장 공간 부족 등 */ }
  }
  async function fileKey(file) {
    try {
      const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      return RESULT_VERSION + ":" + [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
    } catch { return null; }
  }

  // 한 페이지 읽기. 화면이 보이는 동안 진행 소식이 2분 넘게 없으면 멈춘 것으로 보고 "stalled"를 돌려준다
  async function recognizeOne(engine, blob, signal, onProgress) {
    const ctl = new AbortController();
    const onCancel = () => ctl.abort();
    signal.addEventListener("abort", onCancel);
    let quiet = 0, last = performance.now(), stalled = false;
    const watchdog = engine.backend === "wasm" ? 0 : setInterval(() => {
      const now = performance.now();
      if (document.visibilityState === "visible") quiet += now - last; // 다른 탭에 가 있는 동안은 세지 않음
      last = now;
      if (quiet > 120000) { stalled = true; ctl.abort(); }
    }, 1000);
    const res = await engine.recognizePage(blob, {
      ocr: false, // 제목·코드 글자 인식은 생략 (모델 32MB 절약)
      signal: ctl.signal,
      onProgress: p => { quiet = 0; onProgress(p); },
    });
    clearInterval(watchdog);
    signal.removeEventListener("abort", onCancel);
    return stalled && !signal.aborted ? { ok: false, error: "stalled" } : res;
  }

  let omrAbort = null, lastRecognized = null, omrRunning = false;
  async function openViaOmr(file) {
    if (location.protocol === "file:") {
      alertBox("PDF/이미지 인식은 웹 주소로 열어야 합니다", `
        <p>브라우저 보안 정책 때문에 파일을 더블클릭해서 연 상태(<code>file://</code>)에서는 악보 인식 엔진을 실행할 수 없습니다.</p>
        <p>이 폴더를 웹에 올린 주소(예: GitHub Pages)로 접속하거나, PC에서 <code>start.bat</code>으로 열어 주세요.
        MusicXML(.mxl/.musicxml) 파일은 지금도 바로 열 수 있습니다.</p>`);
      return;
    }
    if (omrRunning) { toast("이전 악보를 아직 인식하고 있습니다. 취소한 뒤 다시 열어 주세요."); return; }
    omrRunning = true;
    omrAbort = new AbortController();
    try { await runOmr(file, omrAbort.signal); }
    finally { omrRunning = false; setOmrBar(null); }
  }

  async function runOmr(file, signal) {
    const title = file.name.replace(OMR_EXT, "");
    showOverlay("악보 여는 중…", true);
    const src = await openPages(file);
    try { await runOmrPages(file, src, title, signal); }
    finally { src.close(); }
  }

  async function runOmrPages(file, src, title, signal) {
    const pages = { length: src.count };
    const key = await fileKey(file);
    const results = new Array(pages.length);   // 페이지별 MusicXML, 실패하면 null
    if (key) {
      const cached = await Promise.all([...Array(pages.length)].map((_, i) => cacheGet(`${key}:${i}`)));
      cached.forEach((x, i) => { if (x !== undefined) results[i] = x; });
    }
    const cachedCount = results.filter(r => r !== undefined).length;
    if (signal.aborted) return hideOverlay();

    if (cachedCount === pages.length) {
      if (!results.some(Boolean)) { hideOverlay(); throw new Error("이 파일은 전에 악보를 찾지 못한 파일입니다."); }
      showOverlay("저장된 인식 결과 불러오는 중…");
      const xml = mergeMusicXml(results.filter(Boolean), title);
      await loadScoreSafe(xml, title + ".musicxml");
      lastRecognized = { name: title + ".musicxml", xml };
      ui.save.hidden = false;
      hideOverlay();
      toast("전에 인식해 둔 결과를 바로 불러왔습니다.", 4000);
      return;
    }
    if (cachedCount) toast(`전에 인식해 둔 ${cachedCount}페이지는 건너뛰고 이어서 인식합니다.`, 5000);
    if (warmup) {
      const show = () => showOverlay(warmMsg || "악보 인식 엔진 준비 중…", true);
      show();
      const iv = setInterval(show, 500);
      await warmup;
      clearInterval(iv);
      if (signal.aborted) return hideOverlay();
    }
    if (modelsStored === null) await checkModelsStored();
    let pool;
    try {
      pool = await getEngines(engineCount(pages.length - cachedCount));
    } catch (err) {
      throw new Error("이 브라우저에서는 악보 인식 엔진을 시작할 수 없습니다. 최신 Chrome, Edge, Safari를 사용해 주세요.\n(" + err.message + ")");
    }
    let backend = pool[0].backend;
    console.info("OMR backend:", backend, pool[0].backendReason, "engines:", pool.length);

    const t0 = performance.now();
    const stage = new Array(pages.length).fill("대기");
    const pageTimes = [];  // 새로 인식한 페이지마다 걸린 시간 (남은 시간 계산용)
    let shownUpTo = 0, nextPage = 0, fatal = null, downloading = null;
    const elapsed = () => Math.round((performance.now() - t0) / 1000);
    const status = () => {
      const done = results.filter(r => r !== undefined).length;
      const head = pages.length > 1 ? `${done}/${pages.length} 페이지 완료 · ` : "";
      const now = stage.map((s, i) => [s, i]).filter(([s]) => s !== "대기" && s !== "완료")
        .map(([s, i]) => (pages.length > 1 ? `${i + 1}쪽 ` : "") + s).join(", ");
      const left = pages.length - done;
      let eta = "";
      if (left > 0 && pageTimes.length) {
        const avg = pageTimes.reduce((a, b) => a + b, 0) / pageTimes.length;
        const sec = Math.round((avg * left) / pool.length);
        eta = ` · 남은 시간 약 ${sec >= 90 ? Math.round(sec / 60) + "분" : sec + "초"}`;
      }
      return `악보 인식 중 — ${head}${now || "정리 중"}\n엔진: ${BACKEND_KO[backend] || backend} · ${elapsed()}초 경과${eta}`;
    };
    const report = () => {
      const msg = downloading || status();
      if (shownUpTo === 0) showOverlay(msg, true); else setOmrBar(msg);
    };
    const ticker = setInterval(report, 1000);

    // 앞에서부터 연속으로 끝난 페이지까지 화면에 보여 준다 (첫 페이지가 끝나면 바로 볼 수 있게)
    let lastShow = 0;
    const showReady = async final => {
      let k = 0;
      while (k < pages.length && results[k] !== undefined) k++;
      const ready = results.slice(0, k).filter(Boolean);
      if (!ready.length || (k === shownUpTo && !final)) return;
      if (!final && shownUpTo > 0) {
        if (state.playing) return;                              // 재생 중에는 끊지 않고 나중에 반영
        if (performance.now() - lastShow < 45000 && k < pages.length) return; // 45초에 한 번만 다시 그림
      }
      const keepScroll = ui.wrap.scrollTop;
      const xml = mergeMusicXml(ready, title);
      const keep = shownUpTo > 0 ? state.parts.map(p => ({ visible: p.visible, audible: p.audible, volume: p.volume, program: p.program })) : null;
      const pos = state.posSec;
      await loadScoreSafe(xml, title + ".musicxml");
      if (keep && keep.length === state.parts.length) restorePartSettings(keep, pos);
      if (shownUpTo > 0) ui.wrap.scrollTop = keepScroll;
      shownUpTo = k;
      lastShow = performance.now();
      lastRecognized = { name: title + ".musicxml", xml };
      ui.save.hidden = false;
      if (k < pages.length) { hideOverlay(); report(); }
    };

    let firstDone;
    const firstPage = new Promise(r => (firstDone = r));
    const worker = async (engine, idx = 0) => {
      if (idx > 0) await firstPage;
      while (!fatal && !signal.aborted && nextPage < pages.length) {
        const i = nextPage++;
        if (results[i] !== undefined) { if (i === 0) firstDone(); continue; }
        stage[i] = "페이지 그리는 중";
        const blob = await src.get(i);
        if (signal.aborted) return;
        stage[i] = "시작";
        const tPage = performance.now();
        const res = await recognizeOne(engine, blob, signal, ({ stage: s, done, total }) => {
          if (s === "models") {
            downloading = done >= total ? null : modelMsg(done, total);
          } else {
            downloading = null;
            stage[i] = (STAGE_KO[s] || s) + (total > 1 ? ` ${done}/${total}` : "");
          }
          report();
        });
        if (res.ok) { keepModels(); modelsStored = true; results[i] = res.musicXml; pageTimes.push((performance.now() - tPage) / 1000); }
        else if (res.error === "cancelled" || res.error === "timeout") { stage[i] = "대기"; return; }
        else if (res.error === "stalled" || res.error === "engine_missing" || res.error === "worker_lost") {
          fatal = fatal || res.error; stage[i] = "대기";
          return;
        } else { results[i] = null; console.warn("OMR page failed", i + 1, res.error, res.log); }
        if (key) cachePut(`${key}:${i}`, results[i]);
        stage[i] = "완료";
        if (i === 0) firstDone();
        await showReady(false);
      }
      firstDone();
    };

    try {
      await Promise.all(pool.map((e, idx) => worker(e, idx)));
      if (fatal === "stalled" && !signal.aborted) {
        // 빠른 엔진이 멈춤 → 호환 모드로 남은 페이지를 이어서 읽는다
        console.warn("OMR stalled on", backend, "→ wasm");
        await resetEngines(true);
        toast("이 기기에서 빠른 엔진이 응답하지 않아 호환 모드로 이어서 인식합니다.", 5000);
        pool = await getEngines(1);
        backend = pool[0].backend;
        fatal = null;
        nextPage = 0;
        await worker(pool[0]);
      }
    } finally {
      clearInterval(ticker);
    }
    if (signal.aborted) { hideOverlay(); toast("악보 인식을 취소했습니다."); return; }
    if (fatal === "engine_missing") throw new Error("악보 인식 모델을 내려받지 못했습니다. 인터넷 연결을 확인해 주세요.");
    if (fatal === "worker_lost") { await resetEngines(false); throw new Error("인식 중 메모리가 부족해 엔진이 멈췄습니다. 페이지 수를 줄이거나 PC에서 시도해 주세요."); }
    console.info(`OMR ${pages.length} page(s) in ${elapsed()}s`);
    if (!results.some(Boolean)) { hideOverlay(); throw new Error("악보를 찾지 못했습니다. 오선이 선명하게 보이는 인쇄 악보 이미지인지 확인해 주세요."); }

    // 마지막 반영: 재생 중이면 멈출 때까지 기다렸다가 전체 악보로 바꾼다
    if (shownUpTo < pages.length) {
      if (state.playing) setOmrBar("인식 완료 — 재생을 멈추면 나머지 페이지를 붙입니다");
      while (state.playing && !signal.aborted) await new Promise(r => setTimeout(r, 500));
      showOverlay("인식된 악보 그리는 중…");
      await showReady(true);
    }
    hideOverlay();
    const failed = results.map((r, i) => (r ? 0 : i + 1)).filter(Boolean);
    if (failed.length) toast(`${failed.join(", ")} 페이지는 악보로 인식하지 못해 건너뛰었습니다.`, 6000);
    else toast(`인식 완료 (${elapsed()}초). 결과는 이 기기에 저장되어, 같은 파일을 다시 열면 바로 열립니다.`, 6000);
  }

  function restorePartSettings(keep, pos) {
    keep.forEach((k, i) => {
      const p = state.parts[i];
      if (p.program !== k.program) { p.program = k.program; p.li.querySelector("select").value = k.program; loadPartSound(p); }
      p.volume = k.volume; p.li.querySelector("input[type=range]").value = k.volume;
      applyGain(p);
      setAudible(i, k.audible);
      if (!k.visible) setVisible(i, false);
    });
    if (pos > 0) seekTo(Math.min(pos, state.totalSec));
  }

  // 첫 페이지를 보여 준 뒤 나머지를 읽는 동안 화면 위쪽에 띄우는 상태 줄
  function setOmrBar(msg) {
    ui.omrBar.hidden = !msg;
    if (msg) ui.omrBarMsg.textContent = msg.replace("\n", " · ");
  }

  // 인식 결과를 그리다 오류가 나면, 문제를 일으키기 쉬운 표기(붙임줄·이음줄 등)를 지우고 한 번 더 시도한다
  async function loadScoreSafe(xml, name) {
    try {
      await loadScore(xml, name);
    } catch (err) {
      console.warn("render failed, retrying without ties/slurs", err);
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      sanitizeOmrXml(doc);
      doc.querySelectorAll("tie, tied, slur, glissando, slide, tuplet, time-modification").forEach(e => e.remove());
      await loadScore(new XMLSerializer().serializeToString(doc), name);
      toast("그릴 수 없는 표기 일부(화음 속 쉼표, 붙임줄 등)를 고쳐서 표시했습니다.", 5000);
    }
  }

  // 페이지별 MusicXML을 하나로 이어 붙인다 (파트 순서가 같다고 보고, 마디를 뒤에 덧붙임)
  function mergeMusicXml(xmls, title) {
    const parser = new DOMParser();
    const base = parser.parseFromString(xmls[0], "application/xml");
    const baseParts = [...base.querySelectorAll("score-partwise > part")];
    let mismatch = false;
    for (const x of xmls.slice(1)) {
      const doc = parser.parseFromString(x, "application/xml");
      const parts = [...doc.querySelectorAll("score-partwise > part")];
      if (parts.length !== baseParts.length) mismatch = true;
      parts.forEach((p, i) => {
        const target = baseParts[Math.min(i, baseParts.length - 1)];
        if (i >= baseParts.length) return;
        for (const m of p.querySelectorAll(":scope > measure")) target.appendChild(base.importNode(m, true));
      });
    }
    baseParts.forEach((p, k) => {
      const sp = base.querySelector(`score-part[id="${p.getAttribute("id")}"]`);
      if (!sp) return;
      sp.querySelectorAll("part-name, instrument-name").forEach(e => (e.textContent = `파트 ${k + 1}`));
      sp.querySelectorAll("midi-program").forEach(e => (e.textContent = "1"));
      sp.querySelectorAll("instrument-sound").forEach(e => e.remove());
    });
    // 마디 번호 다시 매기기
    for (const p of baseParts) [...p.querySelectorAll(":scope > measure")].forEach((m, k) => m.setAttribute("number", String(k + 1)));
    // 제목이 비어 있으면 파일 이름으로
    let work = base.querySelector("work-title");
    if (!work || !work.textContent.trim()) {
      if (!work) {
        const w = base.createElement("work"); work = base.createElement("work-title"); w.appendChild(work);
        base.documentElement.insertBefore(w, base.documentElement.firstChild);
      }
      work.textContent = title;
    }
    sanitizeOmrXml(base);
    if (mismatch) toast("페이지마다 인식된 파트 수가 달라 일부 파트가 어긋날 수 있습니다.", 6000);
    return new XMLSerializer().serializeToString(base);
  }

  // 인식 결과에 가끔 섞이는, 악보 그리기 라이브러리가 처리하지 못하는 표기를 고친다
  // (화음에 끼어든 쉼표, 쉼표의 붙임줄, 짝이 없는 붙임줄 → "getHalfTone" 오류의 원인)
  function sanitizeOmrXml(doc) {
    for (const n of doc.querySelectorAll("note")) {
      const isRest = !!n.querySelector("rest");
      if (!isRest && !n.querySelector("pitch") && !n.querySelector("unpitched")) {
        n.insertBefore(doc.createElement("rest"), n.querySelector("duration"));
      }
      if (n.querySelector("rest")) {
        if (n.querySelector("chord")) { n.remove(); continue; }
        n.querySelectorAll("tie, tied, glissando, slide").forEach(e => e.remove());
      }
      n.querySelectorAll("glissando, slide").forEach(e => e.remove());
    }
    // 붙임줄은 같은 파트·같은 음높이의 시작과 끝이 짝을 이룰 때만 남긴다
    for (const part of doc.querySelectorAll("score-partwise > part")) {
      const open = new Map();
      const key = n => {
        const p = n.querySelector("pitch");
        return [n.querySelector("staff")?.textContent, p?.querySelector("step")?.textContent,
          p?.querySelector("alter")?.textContent || "0", p?.querySelector("octave")?.textContent].join("|");
      };
      const drop = (n, type) => n.querySelectorAll(`tie[type="${type}"], tied[type="${type}"]`).forEach(e => e.remove());
      for (const n of part.querySelectorAll("note")) {
        if (!n.querySelector("pitch")) continue;
        const k = key(n);
        if (n.querySelector('tie[type="stop"]')) {
          if (open.has(k)) open.delete(k); else drop(n, "stop");
        }
        if (n.querySelector('tie[type="start"]')) {
          if (open.has(k)) drop(open.get(k), "start");
          open.set(k, n);
        }
      }
      for (const n of open.values()) drop(n, "start");
    }
  }

  /* ---------------------------------------------------------- 악보 로드 */
  async function loadScore(content, name) {
    ui.save.hidden = true;
    lastRecognized = null;
    showOverlay("악보 해석 중…");
    await nextFrame();
    if (tab.active) tab.deactivate();
    await osmd.load(content);
    document.title = (osmd.Sheet.TitleString || name || "악보") + " — PDFScore";
    ui.welcome.hidden = true;
    document.body.classList.add("has-score");
    if (window.innerWidth <= 760) document.body.classList.add("parts-hidden");

    state.parts = osmd.Sheet.Instruments.map((inst, i) => {
      let program = guessProgram(inst);
      return {
        name: inst.Name || `파트 ${i + 1}`, inst, visible: true, audible: true, volume: 0.8,
        program, gain: null, player: null, loadingToken: 0,
      };
    });

    showOverlay("악보 그리는 중…");
    await nextFrame();
    osmd.Zoom = state.zoom;
    osmd.render();
    osmd.cursor.SkipInvisibleNotes = false;

    buildTimeline();
    setBaseTempo(osmd.Sheet.DefaultStartTempoInBpm || osmd.Sheet.userStartTempoInBPM || 120);
    state.loaded = true;
    state.posSec = 0;
    buildPartList();
    showCursorAt(0);
    ui.wrap.scrollTop = 0;
    [ui.play, ui.stop, ui.rewind, ui.seek].forEach(el => (el.disabled = false));
    updateTimeUi(0);
    hideOverlay();

    ensureAudio();
    state.parts.forEach(loadPartSound);
  }

  function guessProgram(inst) {
    const sub = inst.SubInstruments && inst.SubInstruments[0];
    const id = sub ? sub.midiInstrumentID : inst.MidiInstrumentId;
    const name = (inst.Name || "") + " " + (sub && sub.name ? sub.name : "");
    if (id === 128 || isPercussionStaff(inst)) return DRUMS;
    if (typeof id === "number" && id > 0 && id < 128) return id;
    // 0(피아노)은 기본값일 가능성이 높으니 이름으로 한 번 더 추정
    for (const [re, prog] of NAME_HINTS) if (re.test(name)) return prog;
    return 0;
  }
  function isPercussionStaff(inst) {
    try {
      const m = osmd.Sheet.SourceMeasures[0];
      return inst.Staves.some(st => {
        const se = m.FirstInstructionsStaffEntries[osmd.Sheet.Staves.indexOf(st)];
        return se && se.Instructions.some(ins => ins.ClefType === 3 /* ClefEnum.percussion */);
      });
    } catch { return false; }
  }

  /* ------------------------------------------- 재생용 타임라인 만들기 */
  function noteMidi(note, inst) {
    let m;
    const p = note.Pitch;
    if (p) {
      m = (p.Octave + 4) * 12 + p.FundamentalNote + Math.round(p.AccidentalHalfTones || 0);
    } else {
      m = note.halfTone + 12;
    }
    return m + (inst.PlaybackTranspose || 0);
  }

  // 도돌이표·1/2번 괄호·D.C./D.S.·Fine·Coda를 펼쳐 실제 연주 순서의 마디 번호 목록을 만든다
  function measureOrder(measures) {
    const n = measures.length;
    const R = { Start: 0, Back: 2, Ending: 3, DC: 4, DS: 5, Fine: 6, ToCoda: 7, DSFine: 8, DCFine: 9, DSCoda: 10, DCCoda: 11, Coda: 12, Segno: 13 };
    const info = measures.map(m => {
      const first = m.FirstRepetitionInstructions || [], last = m.LastRepetitionInstructions || [];
      const all = first.concat(last);
      const has = (...ts) => all.some(r => ts.includes(r.type));
      return {
        start: first.some(r => r.type === R.Start), back: last.some(r => r.type === R.Back),
        endBegin: first.find(r => r.type === R.Ending), endEnd: last.find(r => r.type === R.Ending),
        segno: has(R.Segno), coda: has(R.Coda), toCoda: has(R.ToCoda), fine: has(R.Fine),
        dc: has(R.DC, R.DCFine, R.DCCoda), ds: has(R.DS, R.DSFine, R.DSCoda),
      };
    });
    // 각 마디가 속한 괄호 번호와, 이어진 괄호 묶음의 최대 번호
    const ending = new Array(n).fill(null);
    let cur = null;
    for (let i = 0; i < n; i++) {
      if (info[i].endBegin) cur = info[i].endBegin.endingIndices || [1];
      if (cur) ending[i] = cur;
      if (info[i].endEnd || (cur && info[i].back)) cur = null;
    }
    const chainMax = new Array(n).fill(0);
    for (let i = 0; i < n;) {
      if (!ending[i]) { i++; continue; }
      let j = i, mx = 0;
      while (j < n && ending[j]) { mx = Math.max(mx, ...ending[j]); j++; }
      for (let k = i; k < j; k++) chainMax[k] = mx;
      i = j;
    }

    const order = [];
    let i = 0, repStart = 0, pass = 1, jumped = false;
    while (i < n && order.length < 20000) {
      const m = info[i];
      if (m.start && !jumped && i !== repStart) { repStart = i; pass = 1; }
      if (m.start && jumped) repStart = i;
      if (ending[i]) {
        const want = jumped ? chainMax[i] : pass;
        if (!ending[i].includes(want)) { i++; continue; }
      }
      order.push(i);
      if (jumped && m.fine) break;
      if (m.back && !jumped) {
        const total = ending[i] ? chainMax[i] : 2;
        if (pass < total) { pass++; i = repStart; continue; }
        pass = 1; repStart = i + 1;
      } else if (ending[i] && !ending[i + 1] && !jumped) {
        pass = 1; repStart = i + 1;
      }
      if (jumped && m.toCoda) {
        const c = info.findIndex((x, k) => k > i && x.coda);
        if (c > 0) { i = c; continue; }
      }
      if (!jumped && (m.dc || m.ds)) {
        jumped = true;
        const s = m.ds ? info.findIndex(x => x.segno) : 0;
        i = Math.max(0, s); repStart = i;
        continue;
      }
      i++;
    }
    return order;
  }

  function buildTimeline() {
    const sheet = osmd.Sheet;
    const measures = sheet.SourceMeasures;
    const instIndex = new Map(sheet.Instruments.map((inst, i) => [inst, i]));
    const defBpm = sheet.DefaultStartTempoInBpm || sheet.userStartTempoInBPM || 100;

    // 1) 악보를 처음부터 끝까지 한 번 훑어 마디별 위치(커서 위치)와 음표를 모은다
    const byMeasure = measures.map(() => []);
    const seen = new Set();
    const it = sheet.MusicPartManager.getIterator();
    let guard = 0, lastBpm = defBpm;
    while (!it.EndReached && guard++ < 200000) {
      const mi = it.CurrentMeasureIndex;
      const sts = it.CurrentSourceTimestamp.RealValue;
      const key = mi + ":" + sts;
      if (!seen.has(key) && byMeasure[mi]) {
        seen.add(key);
        if (it.CurrentBpm > 0) lastBpm = it.CurrentBpm;
        const pos = { sts, rel: sts - measures[mi].AbsoluteTimestamp.RealValue, bpm: lastBpm, notes: [] };
        for (const ve of it.CurrentVoiceEntries || []) {
          if (ve.IsGrace) continue;
          const inst = ve.ParentSourceStaffEntry.ParentStaff.ParentInstrument;
          const part = instIndex.get(inst);
          for (const n of ve.Notes) {
            if (n.isRest()) continue;
            let len = n.Length.RealValue;
            const tie = n.NoteTie;
            if (tie) {
              if (tie.StartNote !== n) continue;     // 붙임줄 뒤쪽 음은 앞 음에 합쳐서 연주
              len = tie.Duration ? tie.Duration.RealValue : tie.Notes.reduce((a, x) => a + x.Length.RealValue, 0);
            }
            pos.notes.push({ len, midi: noteMidi(n, inst), part });
          }
        }
        byMeasure[mi].push(pos);
      }
      it.moveToNext();
    }

    // 2) 연주 순서대로 펼치면서 초 단위 시간을 매긴다
    const events = [], steps = [];
    let sec = 0, bpm = defBpm;
    for (const mi of measureOrder(measures)) {
      const list = byMeasure[mi];
      const mDur = measures[mi].Duration ? measures[mi].Duration.RealValue : 1;
      let rel = 0;
      for (const pos of list) {
        sec += Math.max(0, pos.rel - rel) * 240 / bpm;
        rel = pos.rel;
        bpm = pos.bpm;
        steps.push({ sec, sts: pos.sts, mi });
        for (const nt of pos.notes) events.push({ t: sec, dur: nt.len * 240 / bpm, midi: nt.midi, part: nt.part, vel: 0.8 });
      }
      sec += Math.max(0, mDur - rel) * 240 / bpm;
    }
    events.sort((a, b) => a.t - b.t);
    state.events = events;
    state.steps = steps;
    state.totalSec = Math.max(sec, ...events.map(e => e.t + e.dur), 0.1);
    ui.timeTotal.textContent = fmtTime(state.totalSec);
  }

  /* --------------------------------------------------------- 파트 패널 */
  function buildPartList() {
    ui.partList.innerHTML = "";
    state.parts.forEach((p, i) => {
      const li = document.createElement("li");
      li.className = "part";
      li.innerHTML = `
        <div class="name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
        <label class="toggle" title="악보에 표시"><input type="checkbox" data-k="visible" checked>👁</label>
        <label class="toggle" title="소리"><input type="checkbox" data-k="audible" checked>🔊</label>
        <div class="row2">
          <select title="재생 악기 소리"></select>
          <input type="range" min="0" max="1" step="0.05" value="${p.volume}" title="음량">
        </div>`;
      const sel = li.querySelector("select");
      sel.innerHTML = `<option value="${DRUMS}">드럼/타악기</option>` +
        GM.map((n, k) => `<option value="${k}">${k + 1}. ${n.replace(/_/g, " ")}</option>`).join("");
      sel.value = p.program;
      sel.onchange = () => { p.program = +sel.value; loadPartSound(p); };
      li.querySelector('[data-k="visible"]').onchange = e => setVisible(i, e.target.checked);
      li.querySelector('[data-k="audible"]').onchange = e => setAudible(i, e.target.checked);
      li.querySelector('input[type=range]').oninput = e => { p.volume = +e.target.value; applyGain(p); };
      p.li = li;
      ui.partList.appendChild(li);
    });
  }

  function setAudible(i, on) {
    const p = state.parts[i];
    p.audible = on;
    p.li.querySelector('[data-k="audible"]').checked = on;
    applyGain(p);
  }

  let rerenderTimer = 0;
  function setVisible(i, on) {
    const p = state.parts[i];
    if (!on && state.parts.filter(x => x.visible).length <= 1) {
      p.li.querySelector('[data-k="visible"]').checked = true;
      toast("최소 한 파트는 악보에 표시해야 합니다.");
      return;
    }
    p.visible = on;
    p.inst.Visible = on;
    p.li.querySelector('[data-k="visible"]').checked = on;
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(rerender, 60); // 여러 개를 연달아 바꿀 때 한 번만 그림
  }

  async function rerender() {
    if (!state.loaded) return;
    const keepRatio = ui.wrap.scrollTop / Math.max(1, ui.wrap.scrollHeight);
    if (!state.playing) showOverlay("악보 다시 그리는 중…");
    await nextFrame();
    try {
      osmd.Zoom = state.zoom;
      osmd.updateGraphic();
      osmd.render();
    } catch (err) {
      console.error(err);
      toast("다시 그리기 중 오류: " + err.message);
    }
    hideOverlay();
    state.cursorStep = -1;
    const step = stepAt(currentPos());
    showCursorAt(step);
    if (!state.playing) ui.wrap.scrollTop = keepRatio * ui.wrap.scrollHeight;
    if (ui.autoScroll.checked) scrollToCursor(true);
  }

  document.querySelector(".parts-all").addEventListener("click", e => {
    const kind = e.target.dataset.all;
    if (kind && tab.active) return tab.toggleAll(kind);
    if (!kind || !state.loaded) return;
    if (kind === "show") {
      const allOn = state.parts.every(p => p.visible);
      state.parts.forEach((p, i) => { if (!allOn || i > 0) setVisible(i, !allOn); });
      if (allOn) toast("첫 파트만 남기고 숨겼습니다.");
    } else {
      const allOn = state.parts.every(p => p.audible);
      state.parts.forEach((p, i) => setAudible(i, !allOn));
    }
  });

  /* ------------------------------------------------------------ 오디오 */
  function ensureAudio() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function applyGain(p) {
    if (!p.gain) return;
    const v = p.audible ? p.volume : 0;
    p.gain.gain.setTargetAtTime(v, ctx.currentTime, 0.015);
  }

  async function loadPartSound(p) {
    ensureAudio();
    if (!p.gain) { p.gain = ctx.createGain(); p.gain.connect(master); applyGain(p); }
    p.player = null;
    if (p.program === DRUMS) return; // 타악기는 내장 합성음
    const token = ++p.loadingToken;
    p.li && p.li.classList.add("loading");
    const name = GM[p.program];
    const urls = [];
    if (localSoundfonts) urls.push(`soundfonts/${name}-mp3.js`); // 서버에 내려받아 둔 경우
    urls.push(SOUNDFONT_CDN + `${name}-mp3.js`);
    for (const url of urls) {
      try {
        const player = await Soundfont.instrument(ctx, name, {
          destination: p.gain, nameToUrl: () => url, gain: 2.2,
        });
        if (token !== p.loadingToken) return;
        p.player = player;
        break;
      } catch (err) {
        console.warn("soundfont load failed", url, err);
      }
    }
    if (token !== p.loadingToken) return;
    p.li && p.li.classList.remove("loading");
    if (!p.player) toast(`'${p.name}' 악기 소리를 내려받지 못해 기본 신스음으로 재생합니다.`, 4000);
  }

  function playNote(ev, when, dur) {
    const p = state.parts[ev.part];
    if (!p || !p.gain) return;
    if (p.program === DRUMS) return playDrum(p, ev.midi, when, ev.vel);
    if (p.player) {
      const node = p.player.play(ev.midi, when, { duration: Math.max(0.05, dur), gain: ev.vel });
      if (node) trackNode(node, when + dur + 1);
      return;
    }
    // 대체 신스음
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = 440 * Math.pow(2, (ev.midi - 69) / 12);
    const end = when + Math.max(0.06, dur);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.25 * ev.vel, when + 0.01);
    g.gain.setTargetAtTime(0.15 * ev.vel, when + 0.02, 0.2);
    g.gain.setTargetAtTime(0, end, 0.04);
    osc.connect(g).connect(p.gain);
    osc.start(when); osc.stop(end + 0.3);
    trackNode(osc, end + 0.3);
  }

  function playDrum(p, midi, when, vel) {
    const out = ctx.createGain();
    out.connect(p.gain);
    if (midi <= 66) { // 베이스 드럼
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(140, when);
      o.frequency.exponentialRampToValueAtTime(45, when + 0.12);
      out.gain.setValueAtTime(vel, when);
      out.gain.exponentialRampToValueAtTime(0.001, when + 0.3);
      o.connect(out); o.start(when); o.stop(when + 0.32);
      trackNode(o, when + 0.35);
      return;
    }
    const n = ctx.createBufferSource(); n.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    const hat = midi > 76;
    f.type = hat ? "highpass" : "bandpass";
    f.frequency.value = hat ? 7000 : 1800;
    const len = hat ? 0.06 : 0.18;
    out.gain.setValueAtTime(vel * (hat ? 0.35 : 0.8), when);
    out.gain.exponentialRampToValueAtTime(0.001, when + len);
    n.connect(f).connect(out); n.start(when); n.stop(when + len + 0.02);
    trackNode(n, when + len + 0.05);
    if (!hat) { // 스네어 몸통
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 190;
      g.gain.setValueAtTime(vel * 0.4, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.1);
      o.connect(g).connect(p.gain); o.start(when); o.stop(when + 0.12);
      trackNode(o, when + 0.15);
    }
  }

  function trackNode(node, endTime) {
    node._end = endTime;
    state.activeNodes.add(node);
  }
  function silenceAll() {
    for (const n of state.activeNodes) { try { n.stop(); } catch { /* 이미 멈춤 */ } }
    state.activeNodes.clear();
    state.parts.forEach(p => { if (p.player) try { p.player.stop(); } catch { /* 무시 */ } });
  }

  /* ------------------------------------------------------- 재생 제어 */
  function currentPos() {
    if (!state.playing) return state.posSec;
    return state.startPos + (ctx.currentTime - state.startCtx) * state.rate;
  }

  async function play() {
    if (!state.loaded || state.playing) return;
    ensureAudio();
    if (ctx.state !== "running") await ctx.resume();
    if (state.posSec >= state.totalSec - 0.01) state.posSec = 0;
    state.playing = true;
    state.startPos = state.posSec;
    state.startCtx = ctx.currentTime + 0.08;
    state.nextEv = firstEventAt(state.posSec);
    ui.play.textContent = "⏸";
    scheduler();
    state.timer = setInterval(scheduler, 25);
  }

  function pause() {
    if (!state.playing) return;
    state.posSec = Math.min(currentPos(), state.totalSec);
    state.playing = false;
    clearInterval(state.timer);
    silenceAll();
    ui.play.textContent = "▶";
  }

  function stop() {
    pause();
    if (!state.loaded) return;
    state.posSec = 0;
    showCursorAt(0);
    updateTimeUi(0);
    if (ui.autoScroll.checked) smoothScroll(0);
  }

  function seekTo(sec) {
    const was = state.playing;
    pause();
    state.posSec = Math.max(0, Math.min(sec, state.totalSec));
    showCursorAt(stepAt(state.posSec));
    updateTimeUi(state.posSec);
    if (ui.autoScroll.checked) scrollToCursor(true);
    if (was) play();
  }

  function firstEventAt(sec) {
    const ev = state.events;
    let lo = 0, hi = ev.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ev[mid].t < sec - 1e-6) lo = mid + 1; else hi = mid; }
    return lo;
  }

  function scheduler() {
    const lookahead = 0.25; // 초 (실제 시간)
    const horizon = state.startPos + (ctx.currentTime + lookahead - state.startCtx) * state.rate;
    const ev = state.events;
    while (state.nextEv < ev.length && ev[state.nextEv].t < horizon) {
      const e = ev[state.nextEv++];
      const p = state.parts[e.part];
      if (!p || !p.audible) continue;
      const when = state.startCtx + (e.t - state.startPos) / state.rate;
      if (when < ctx.currentTime - 0.05) continue;
      playNote(e, Math.max(when, ctx.currentTime), e.dur / state.rate);
    }
    // 끝난 노드 정리
    const now = ctx.currentTime;
    for (const n of state.activeNodes) if (n._end < now) state.activeNodes.delete(n);
    tick();
    if (currentPos() >= state.totalSec + 0.3) {
      pause();
      state.posSec = state.totalSec;
    }
  }

  // 커서·시간 표시 갱신 (rAF는 백그라운드에서 멈추므로 스케줄러 타이머에서 호출)
  function tick() {
    if (!state.playing) return;
    const pos = currentPos();
    if (pos >= 0) {
      const step = stepAt(pos);
      if (step !== state.cursorStep) {
        showCursorAt(step);
        if (ui.autoScroll.checked) scrollToCursor(false);
      }
      updateTimeUi(pos);
    }
  }

  function updateTimeUi(pos) {
    ui.timeCur.textContent = fmtTime(pos);
    if (!state.seeking) ui.seek.value = Math.round((pos / state.totalSec) * 1000);
  }

  /* --------------------------------------------------- 커서 / 스크롤 */
  function stepAt(sec) {
    const s = state.steps;
    let lo = 0, hi = s.length - 1;
    if (hi < 0) return 0;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid].sec <= sec + 1e-6) lo = mid; else hi = mid - 1; }
    return lo;
  }

  function showCursorAt(step) {
    const c = osmd.cursor;
    if (!c) return;
    const target = state.steps[step];
    if (!target) return;
    try {
      // 커서는 악보를 순서대로만 이동하므로, 도돌이표로 되돌아갈 때는 처음부터 다시 찾아간다
      const eps = 1e-6;
      if (state.cursorStep < 0 || c.Iterator.CurrentSourceTimestamp.RealValue > target.sts + eps) {
        c.show();
        c.reset();
      }
      while (!c.Iterator.EndReached && c.Iterator.CurrentSourceTimestamp.RealValue < target.sts - eps) {
        c.Iterator.moveToNext();
      }
      state.cursorStep = step;
      c.update();
    } catch (err) {
      console.warn("cursor", err);
    }
  }

  function scrollToCursor(force) {
    const el = osmd.cursor && osmd.cursor.cursorElement;
    if (!el || el.style.display === "none") return;
    const wr = ui.wrap.getBoundingClientRect();
    const cr = el.getBoundingClientRect();
    if (!cr.height) return;
    const top = cr.top - wr.top, bottom = cr.bottom - wr.top;
    // 커서(현재 줄)가 화면 위쪽 15%~아래 15% 밖으로 벗어나면 줄을 화면 위쪽 1/5 지점으로 이동
    if (force || top < wr.height * 0.1 || bottom > wr.height * 0.85) {
      const target = Math.max(0, ui.wrap.scrollTop + top - wr.height * 0.18);
      if (force) ui.wrap.scrollTop = target; else smoothScroll(target);
    }
  }

  // 부드러운 스크롤. 화면이 그려지지 않는 상황(백그라운드 등)에서도 최종 위치에는 반드시 도착하게 한다
  let scrollToken = 0, scrollTarget = null;
  function smoothScroll(target) {
    if (scrollTarget !== null && Math.abs(scrollTarget - target) < 40) return; // 같은 곳으로 이미 이동 중
    const my = ++scrollToken, from = ui.wrap.scrollTop, t0 = performance.now(), dur = 350;
    scrollTarget = target;
    const step = now => {
      if (my !== scrollToken) return;
      const k = Math.min(1, (now - t0) / dur);
      ui.wrap.scrollTop = from + (target - from) * (1 - Math.pow(1 - k, 3));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    setTimeout(() => {
      if (my !== scrollToken) return;
      ui.wrap.scrollTop = target;
      scrollTarget = null;
    }, dur + 100);
  }

  // 악보를 클릭/탭하면 그 위치부터 재생
  let downPt = null;
  ui.score.addEventListener("pointerdown", e => { downPt = { x: e.clientX, y: e.clientY }; });
  ui.score.addEventListener("click", e => {
    if (!state.loaded || !downPt) return;
    if (Math.hypot(e.clientX - downPt.x, e.clientY - downPt.y) > 8) return; // 드래그/스크롤은 무시
    try {
      const gs = osmd.GraphicSheet;
      const P = opensheetmusicdisplay.PointF2D;
      const pt = gs.svgToOsmd(gs.domToSvg(new P(e.clientX, e.clientY)));
      const gse = gs.GetNearestStaffEntry(pt);
      if (!gse) return;
      const sts = gse.sourceStaffEntry
        ? gse.sourceStaffEntry.AbsoluteTimestamp.RealValue
        : gse.parentMeasure.parentSourceMeasure.AbsoluteTimestamp.RealValue + gse.relInMeasureTimestamp.RealValue;
      // 반복 구간이 있으면 같은 위치가 여러 번 나오므로 현재 위치에서 가장 가까운 것을 선택
      const cur = currentPos();
      let best = -1, bestD = Infinity;
      state.steps.forEach((s, i) => {
        if (Math.abs(s.sts - sts) < 1e-6) {
          const d = Math.abs(s.sec - cur);
          if (d < bestD) { bestD = d; best = i; }
        }
      });
      if (best < 0) best = state.steps.findIndex(s => s.sts >= sts - 1e-6);
      if (best >= 0) seekTo(state.steps[best].sec);
    } catch (err) {
      console.warn("click seek", err);
    }
  });

  /* ------------------------------------------------ 밴드 악보 모드 연결 */
  let tabTotal = 0;
  const tab = window.createTabMode({
    ui, toast, escapeHtml, hideOverlay,
    fileName: () => fileName,
    alert: (title, msg) => alertBox(title, `<p>${escapeHtml(msg)}</p>`),
    status: msg => setOmrBar(msg),
    baseTempo: bpm => setBaseTempo(bpm),
    time: (cur, total) => {
      tabTotal = total;
      ui.timeCur.textContent = fmtTime(cur);
      ui.timeTotal.textContent = fmtTime(total);
      if (!state.seeking && total) ui.seek.value = Math.round((cur / total) * 1000);
    },
  });

  /* ------------------------------------------------------- UI 이벤트 */
  ui.cancel.onclick = ui.omrBarCancel.onclick = () => { if (omrAbort) omrAbort.abort(); };
  ui.save.onclick = () => {
    if (!lastRecognized) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lastRecognized.xml], { type: "application/vnd.recordare.musicxml+xml" }));
    a.download = lastRecognized.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const isTouch = matchMedia("(pointer: coarse)").matches;
  if (!isTouch && /^https?:$/.test(location.protocol)) setTimeout(warmUpEngine, 3000);
  ui.file.parentElement.addEventListener("click", () => warmUpEngine());
  window.addEventListener("dragenter", () => warmUpEngine());
  ui.file.onchange = () => { openFile(ui.file.files[0]); ui.file.value = ""; };
  ui.play.onclick = () => (tab.active ? tab.toggle() : state.playing ? pause() : play());
  ui.stop.onclick = () => (tab.active ? tab.stop() : stop());
  ui.rewind.onclick = () => (tab.active ? tab.seekRatio(0) : seekTo(0));
  ui.autoScroll.onchange = () => tab.setAutoScroll(ui.autoScroll.checked);

  // 템포 슬라이더는 BPM 단위. 악보의 기본 템포를 기준으로 재생 속도 비율을 정한다
  // (곡 중간에 템포가 바뀌는 악보는 같은 비율로 함께 빨라지거나 느려진다)
  function setBaseTempo(bpm) {
    state.baseBpm = Math.round(bpm) || 120;
    ui.tempo.value = state.baseBpm;
    ui.tempoOut.textContent = `♩=${state.baseBpm}`;
    state.rate = 1;
    tab.setRate(1);
  }
  ui.tempo.oninput = () => {
    const pos = currentPos();
    state.rate = ui.tempo.value / (state.baseBpm || 120);
    ui.tempoOut.textContent = `♩=${ui.tempo.value}`;
    tab.setRate(state.rate);
    if (state.playing) { // 현재 위치를 기준으로 다시 맞춤
      silenceAll();
      state.startPos = pos;
      state.startCtx = ctx.currentTime + 0.03;
      state.nextEv = firstEventAt(pos);
    }
  };

  function setZoom(z) {
    state.zoom = Math.round(Math.max(0.4, Math.min(2.5, z)) * 10) / 10;
    ui.zoomVal.textContent = Math.round(state.zoom * 100) + "%";
    if (tab.active) { clearTimeout(rerenderTimer); rerenderTimer = setTimeout(() => tab.setZoom(state.zoom), 150); return; }
    if (state.loaded) { clearTimeout(rerenderTimer); rerenderTimer = setTimeout(rerender, 120); }
  }
  ui.zoomIn.onclick = () => setZoom(state.zoom + 0.1);
  ui.zoomOut.onclick = () => setZoom(state.zoom - 0.1);

  ui.partsBtn.onclick = () => {
    document.body.classList.toggle("parts-hidden");
    if (window.innerWidth > 760 && !tab.active) { clearTimeout(rerenderTimer); rerenderTimer = setTimeout(rerender, 250); }
  };
  if (window.innerWidth <= 760) document.body.classList.add("parts-hidden");
  ui.wrap.addEventListener("pointerdown", () => {
    if (window.innerWidth <= 760) document.body.classList.add("parts-hidden");
  });

  ui.seek.addEventListener("input", () => {
    state.seeking = true;
    ui.timeCur.textContent = fmtTime((ui.seek.value / 1000) * (tab.active ? tabTotal : state.totalSec));
  });
  ui.seek.addEventListener("change", () => {
    state.seeking = false;
    if (tab.active) tab.seekRatio(ui.seek.value / 1000);
    else seekTo((ui.seek.value / 1000) * state.totalSec);
  });

  document.addEventListener("keydown", e => {
    if (e.target.matches("input[type=text], select, textarea")) return;
    if (e.code === "Space") { e.preventDefault(); ui.play.click(); }
    else if (e.key === "Home") seekTo(0);
  });

  // 화면 크기가 바뀌면(회전 등) 너비에 맞게 다시 그림
  let lastWidth = ui.wrap.clientWidth;
  window.addEventListener("resize", () => {
    if (Math.abs(ui.wrap.clientWidth - lastWidth) < 30) return;
    lastWidth = ui.wrap.clientWidth;
    if (window.innerWidth <= 760) document.body.classList.add("parts-hidden");
    if (tab.active) return; // alphaTab은 스스로 너비에 맞춰 다시 그림
    clearTimeout(rerenderTimer); rerenderTimer = setTimeout(rerender, 300);
  });

  // 드래그 앤 드롭
  let dragDepth = 0;
  window.addEventListener("dragenter", e => { e.preventDefault(); dragDepth++; ui.dropHint.hidden = false; });
  window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; ui.dropHint.hidden = true; } });
  window.addEventListener("dragover", e => e.preventDefault());
  window.addEventListener("drop", e => {
    e.preventDefault(); dragDepth = 0; ui.dropHint.hidden = true;
    if (e.dataTransfer.files.length) openFile(e.dataTransfer.files[0]);
  });

  ui.zoomVal.textContent = Math.round(state.zoom * 100) + "%";

  // 디버그/검증용
  window.pdfscore = { osmd, state, mergeMusicXml, loadScoreSafe, tab, loadAlphaTab, enterTabMode };
})();
