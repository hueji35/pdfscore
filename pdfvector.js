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
export async function extractPage(pdfjs, page) {
  const OPS = pdfjs.OPS;
  const vp = page.getViewport({ scale: 1 });
  const H = vp.height;
  const flip = [1, 0, 0, -1, 0, H]; // PDF 좌표(아래 원점) → 화면 좌표(위 원점)
  const ol = await page.getOperatorList();
  const glyphs = [], rects = [], polys = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let fill = "#000";
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i], args = ol.argsArray[i];
    if (fn === OPS.save) stack.push({ ctm, fill });
    else if (fn === OPS.restore) { const s = stack.pop(); if (s) { ctm = s.ctm; fill = s.fill; } }
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.setFillRGBColor) fill = args[0];
    else if (fn === OPS.constructPath) {
      const [, data, mm] = args;
      const raw = data && data[0];
      if (!raw || !mm) continue;
      const segs = decodePath(raw);
      const m = mul(flip, ctm);
      // 기준점을 옮겨 놓고 그린 도형 = 기호 (같은 모양이 여러 번 쓰임)
      const translated = ctm[4] !== 0 || ctm[5] !== 0;
      const ax = isAxisRect(segs);
      const tx = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
      const [ax0, ay0] = tx(mm[0], mm[1]), [ax1, ay1] = tx(mm[2], mm[3]);
      const bbox = [Math.min(ax0, ax1), Math.min(ay0, ay1), Math.max(ax0, ax1), Math.max(ay0, ay1)];
      if (ax && !translated) {
        rects.push({ x0: bbox[0], y0: bbox[1], x1: bbox[2], y1: bbox[3], fill });
      } else if (translated) {
        const [x, y] = tx(0, 0);
        const scale = Math.hypot(ctm[0], ctm[1]);
        glyphs.push({ sig: signature(segs) + (Math.abs(scale - 1) > 0.01 ? "@" + scale.toFixed(2) : ""), x, y, bbox, fill, segs, ctm: ctm.slice() });
      } else {
        // 여러 사각형을 한 번에 그린 경우(오선 묶음 등)를 하위 경로별로 나눈다
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
      }
    }
  }
  return { width: vp.width, height: H, glyphs, rects, polys };
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
