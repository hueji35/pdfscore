/* PDFScore — 벡터 PDF 악보 해석: 1단계 (그리기 명령 → 기호·선 목록)
 *
 * 악보 프로그램이 만든 PDF는 기호(음표머리, 쉼표, TAB 숫자 …)를
 * "같은 모양의 도형 + 위치 이동(transform)"으로, 오선·마디줄·기둥은 사각형으로 그린다.
 * 여기서는 pdf.js의 operator list를 훑어서
 *   glyphs: { sig, x, y, bbox }  — sig는 모양 고유값(같은 기호면 같은 값)
 *   rects:  { x0, y0, x1, y1 }   — 축에 나란한 사각형(선)
 *   polys:  { pts, bbox }        — 그 밖의 다각형(기울어진 빔 등)
 * 을 페이지 좌표(왼쪽 위 원점, pt 단위)로 돌려준다.
 * 브라우저와 Node 양쪽에서 쓰도록 pdf.js 모듈을 인자로 받는다. */


function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** pdf.js의 압축된 path 배열을 [{op, pts:[x,y,...]}]로 푼다 */
function decodePath(data) {
  const out = [];
  for (let i = 0; i < data.length;) {
    const op = data[i++];
    let n = 0;
    // pdf.js 5: 0 moveTo, 1 lineTo, 2 curveTo, 3 closePath
    if (op === 0 || op === 1) n = 2;
    else if (op === 2) n = 6;
    else if (op === 3) n = 0;
    else break;
    out.push({ op, pts: Array.from(data.subarray ? data.subarray(i, i + n) : data.slice(i, i + n)) });
    i += n;
  }
  return out;
}

/** 모양 고유값: 상대 좌표를 0.2pt 단위로 반올림해 문자열로 (같은 기호의 미세한 오차는 묶임) */
function signature(segs) {
  let s = "";
  for (const g of segs) {
    s += g.op;
    for (const v of g.pts) s += "," + Math.round(v * 5);
    s += ";";
  }
  // 너무 긴 문자열 대신 짧은 해시
  let h1 = 0x811c9dc5, h2 = 0;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = (h2 * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h1.toString(36) + h2.toString(36) + ":" + segs.length;
}

function isAxisRect(segs) {
  // moveTo + lineTo×3 (+closePath) 이고 모든 변이 축에 나란한가
  const pts = [];
  for (const g of segs) {
    if (g.op === 0 || g.op === 1) pts.push([g.pts[0], g.pts[1]]);
    else if (g.op !== 3) return null;
  }
  if (pts.length < 4 || pts.length > 5) return null;
  const xs = new Set(pts.map(p => Math.round(p[0] * 100))), ys = new Set(pts.map(p => Math.round(p[1] * 100)));
  if (xs.size !== 2 || ys.size !== 2) return null;
  return pts;
}

/**
 * @param pdfjs  pdf.js 모듈 (OPS 사용)
 * @param page   PDFPageProxy
 */
/** 하위 경로가 모두 곡선 도형(타원) 또는 축 정렬 사각형이고, 둘 다 있는 묶음 */
function isOvalsAndRects(segs) {
  const subs = [];
  for (const g of segs) { if (g.op === 0) subs.push([]); if (subs.length) subs[subs.length - 1].push(g); }
  if (subs.length < 2) return false;
  let oval = 0, rect = 0;
  for (const sp of subs) {
    if (isAxisRect(sp)) rect++;
    else if (sp.some(g => g.op === 2)) oval++;
    else return false;
  }
  return oval > 0 && rect > 0;
}

/** pdf.js가 넘겨주는 글자 윤곽(SVG 경로 문자열, em 단위, y 위로 +)을 [{op, pts}]로. 2차 곡선은 3차로 바꾼다 */
function parseGlyphPath(str) {
  const out = [];
  const re = /([MLQCZ])([^MLQCZ]*)/g;
  let m, cx = 0, cy = 0, sx = 0, sy = 0;
  while ((m = re.exec(str))) {
    const v = m[2].trim() ? m[2].trim().split(/[\s,]+/).map(Number) : [];
    if (m[1] === "M") { out.push({ op: 0, pts: [v[0], v[1]] }); cx = sx = v[0]; cy = sy = v[1]; }
    else if (m[1] === "L") { out.push({ op: 1, pts: [v[0], v[1]] }); cx = v[0]; cy = v[1]; }
    else if (m[1] === "Q") {
      const [qx, qy, x, y] = v;
      out.push({ op: 2, pts: [cx + 2 / 3 * (qx - cx), cy + 2 / 3 * (qy - cy), x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), x, y] });
      cx = x; cy = y;
    } else if (m[1] === "C") { out.push({ op: 2, pts: v.slice(0, 6) }); cx = v[4]; cy = v[5]; }
    else if (m[1] === "Z") { out.push({ op: 3, pts: [] }); cx = sx; cy = sy; }
  }
  return out;
}

/**
 * 악보 글꼴(Sibelius의 Opus, Finale의 Maestro 등)로 찍은 기호도 도형 기호와 같은 형태로 꺼내려면
 * getDocument에 { disableFontFace: true, fontExtraProperties: true }를 주어야 한다 (글자 윤곽을 받기 위해).
 */
export const DOC_OPTIONS = { disableFontFace: true, fontExtraProperties: true };

export async function extractPage(pdfjs, page) {
  const OPS = pdfjs.OPS;
  const vp = page.getViewport({ scale: 1 });
  const H = vp.height;
  const flip = [1, 0, 0, -1, 0, H]; // PDF 좌표(아래 원점) → 화면 좌표(위 원점)
  const ol = await page.getOperatorList();
  const glyphs = [], rects = [], polys = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let fill = "#000", lineWidth = 1;
  // 글자 상태
  let font = null, fontSize = 0, tm = [1, 0, 0, 1, 0, 0], tlm = tm, charSp = 0, wordSp = 0, hScale = 1, rise = 0, leading = 0;
  const pathCache = new Map();
  const glyphPath = (f, g) => {
    const key = f.loadedName + "_path_" + g.fontChar;
    if (!pathCache.has(key)) {
      let segs = null;
      try { const str = page.commonObjs.get(key); if (typeof str === "string" && str) segs = parseGlyphPath(str); } catch { /* 윤곽 없음 */ }
      pathCache.set(key, segs);
    }
    return pathCache.get(key);
  };
  const moveText = (x, y) => { tlm = mul(tlm, [1, 0, 0, 1, x, y]); tm = tlm; };
  const texts = [];
  const showText = list => {
    if (!font) return;
    const fm = font.fontMatrix || [0.001, 0, 0, 0.001, 0, 0];
    // 글자 문자열도 남긴다 (템포 "= 85" 등)
    const o = mul(flip, mul(ctm, tm));
    const str = list.map(g => typeof g === "object" && g ? g.unicode || "" : "").join("");
    if (str.trim()) texts.push({ str, x: o[4], y: o[5], size: Math.abs(fontSize * Math.hypot(tm[2], tm[3])), font: font.name || "" });
    for (const g of list) {
      if (typeof g === "number") { tm = mul(tm, [1, 0, 0, 1, -g / 1000 * fontSize * hScale, 0]); continue; }
      if (!g) continue;
      const segs0 = glyphPath(font, g);
      const trm = mul(ctm, mul(tm, [fontSize * hScale, 0, 0, fontSize, 0, rise]));
      if (segs0 && segs0.length) {
        // 기준점 기준 상대 좌표(PDF 방향, pt)로 — 도형 기호와 같은 형태
        const segs = segs0.map(z => ({ op: z.op, pts: z.pts.map((v, k) => k % 2 === 0 ? trm[0] * v + trm[2] * z.pts[k + 1] : trm[1] * z.pts[k - 1] + trm[3] * v) }));
        const m = mul(flip, [1, 0, 0, 1, trm[4], trm[5]]);
        const pts = segs.flatMap(z => z.pts.flatMap((v, k) => k % 2 === 0 ? [[m[0] * v + m[2] * z.pts[k + 1] + m[4], m[1] * v + m[3] * z.pts[k + 1] + m[5]]] : []));
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        glyphs.push({ sig: signature(segs), x: m[4], y: m[5], bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
          fill, segs, ctm: [1, 0, 0, 1, trm[4], trm[5]], font: font.name, code: g.originalCharCode, uni: g.unicode, text: true });
        // 사각형 글자(온쉼표·2분쉼표)는 도형 사각형과 같이 다룬다
        if (isAxisRect(segs)) { const b = glyphs[glyphs.length - 1].bbox; rects.push({ x0: b[0], y0: b[1], x1: b[2], y1: b[3], fill }); }
      }
      const w = (g.width || 0) * fm[0];
      tm = mul(tm, [1, 0, 0, 1, (w * fontSize + charSp + (g.isSpace ? wordSp : 0)) * hScale, 0]);
    }
  };
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i], args = ol.argsArray[i];
    if (fn === OPS.save) stack.push({ ctm, fill, lineWidth });
    else if (fn === OPS.restore) { const s = stack.pop(); if (s) { ctm = s.ctm; fill = s.fill; lineWidth = s.lineWidth; } }
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.setFillRGBColor) fill = args[0];
    else if (fn === OPS.setLineWidth) lineWidth = args[0];
    else if (fn === OPS.beginText) { tm = tlm = [1, 0, 0, 1, 0, 0]; }
    else if (fn === OPS.setFont) { try { font = page.commonObjs.get(args[0]); } catch { font = null; } fontSize = args[1]; }
    else if (fn === OPS.setTextMatrix) { const a = args[0]?.length === 6 ? args[0] : args; tm = tlm = Array.from(a); }
    else if (fn === OPS.moveText) moveText(args[0], args[1]);
    else if (fn === OPS.setLeadingMoveText) { leading = -args[1]; moveText(args[0], args[1]); }
    else if (fn === OPS.setLeading) leading = args[0];
    else if (fn === OPS.nextLine) moveText(0, -leading);
    else if (fn === OPS.setCharSpacing) charSp = args[0];
    else if (fn === OPS.setWordSpacing) wordSp = args[0];
    else if (fn === OPS.setHScale) hScale = args[0] / 100;
    else if (fn === OPS.setTextRise) rise = args[0];
    else if (fn === OPS.showText || fn === OPS.showSpacedText) showText(args[0]);
    else if (fn === OPS.nextLineShowText) { moveText(0, -leading); showText(args[0]); }
    else if (fn === OPS.nextLineSetSpacingShowText) { wordSp = args[0]; charSp = args[1]; moveText(0, -leading); showText(args[2]); }
    else if (fn === OPS.constructPath) {
      const [paintOp, data, mm] = args;
      const raw = data && data[0];
      if (!raw || !mm) continue;
      const segs = decodePath(raw);
      const m = mul(flip, ctm);
      // 선(stroke)으로 그린 가로·세로 직선(오선·기둥·마디줄)은 선 굵기만큼의 사각형으로
      if (paintOp === OPS.stroke || paintOp === OPS.closeStroke) {
        const sc = Math.hypot(ctm[0], ctm[1]), half = Math.max(lineWidth * sc, 0.1) / 2;
        const T = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
        let prev = null;
        for (const z of segs) {
          if (z.op === 0) { prev = T(z.pts[0], z.pts[1]); continue; }
          if (z.op !== 1 || !prev) { prev = z.op === 2 ? T(z.pts[4], z.pts[5]) : prev; continue; }
          const p = T(z.pts[0], z.pts[1]);
          if (Math.abs(p[1] - prev[1]) < 0.05) rects.push({ x0: Math.min(p[0], prev[0]), y0: p[1] - half, x1: Math.max(p[0], prev[0]), y1: p[1] + half, fill, stroked: true });
          else if (Math.abs(p[0] - prev[0]) < 0.05) rects.push({ x0: p[0] - half, y0: Math.min(p[1], prev[1]), x1: p[0] + half, y1: Math.max(p[1], prev[1]), fill, stroked: true });
          prev = p;
        }
        continue;
      }
      // 기준점을 옮겨 놓고 그린 도형 = 기호 (같은 모양이 여러 번 쓰임)
      const translated = ctm[4] !== 0 || ctm[5] !== 0;
      const ax = isAxisRect(segs);
      const tx = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
      const [ax0, ay0] = tx(mm[0], mm[1]), [ax1, ay1] = tx(mm[2], mm[3]);
      const bbox = [Math.min(ax0, ax1), Math.min(ay0, ay1), Math.max(ax0, ax1), Math.max(ay0, ay1)];
      // 여러 사각형·도형을 한 번에 그린 경우(오선 묶음 등)를 하위 경로별로 나눈다
      const split = () => {
        let cur = [];
        const flush = () => {
          if (!cur.length) return;
          const r = isAxisRect(cur);
          const pts = [];
          for (const g of cur) for (let k = 0; k < g.pts.length; k += 2) pts.push(tx(g.pts[k], g.pts[k + 1]));
          const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
          const b = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
          if (r) rects.push({ x0: b[0], y0: b[1], x1: b[2], y1: b[3], fill });
          else polys.push({ pts, bbox: b, curved: cur.some(g => g.op === 2), fill });
          cur = [];
        };
        for (const g of segs) { if (g.op === 0) flush(); cur.push(g); }
        flush();
      };
      if (ax && !translated) {
        rects.push({ x0: bbox[0], y0: bbox[1], x1: bbox[2], y1: bbox[3], fill });
      } else if (translated) {
        const [x, y] = tx(0, 0);
        const scale = Math.hypot(ctm[0], ctm[1]);
        glyphs.push({ sig: signature(segs) + (Math.abs(scale - 1) > 0.01 ? "@" + scale.toFixed(2) : ""), x, y, bbox, fill, segs, ctm: ctm.slice() });
        // 한 단에 걸친 여러 도형(TAB 동그라미 타원+기둥 묶음 등)은 기호가 아니므로 낱개 도형으로도 넣는다
        if (bbox[2] - bbox[0] > 40 && isOvalsAndRects(segs)) split();
      } else split();
    }
  }
  return { width: vp.width, height: H, glyphs, rects, polys, texts };
}

/**
 * 모양 사전: 명령 순서가 같고 모든 좌표 차이가 tol 이하이면 같은 모양으로 본다.
 * (반올림 해시는 경계값에서 같은 기호가 갈라지므로 허용 오차 비교를 쓴다)
 */
export class ShapeIndex {
  constructor(tol = 0.06) { this.tol = tol; this.groups = new Map(); this.shapes = []; }
  idOf(segs) {
    const ops = segs.map(g => g.op).join("");
    const flat = segs.flatMap(g => g.pts);
    let list = this.groups.get(ops);
    if (!list) this.groups.set(ops, list = []);
    for (const s of list) {
      let ok = true;
      for (let i = 0; i < flat.length; i++) if (Math.abs(flat[i] - s.flat[i]) > this.tol) { ok = false; break; }
      if (ok) { s.n++; return s.id; }
    }
    const s = { id: this.shapes.length, flat, segs, n: 1 };
    list.push(s);
    this.shapes.push(s);
    return s.id;
  }
}

/** 모양 하나를 SVG path 문자열로 (사전 만들 때 눈으로 확인하는 용도) */
export function glyphSvgPath(segs) {
  let d = "";
  for (const g of segs) {
    const p = g.pts.map(v => (+v).toFixed(2));
    if (g.op === 0) d += `M${p[0]} ${-p[1]}`;
    else if (g.op === 1) d += `L${p[0]} ${-p[1]}`;
    else if (g.op === 2) d += `C${p[0]} ${-p[1]} ${p[2]} ${-p[3]} ${p[4]} ${-p[5]}`;
    else d += "Z";
  }
  return d;
}
