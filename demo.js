// 데모용 오리지널 악보(5파트, 8마디)를 MusicXML 문자열로 생성한다.
// 표기: "E5q" = 미5 4분음표, "C4+E4+G4w" = 화음 온음표, "Rq" = 4분쉼표, 끝에 "~" = 다음 음과 붙임줄
window.makeDemoMusicXML = function () {
  const DIV = 4;
  const TYPES = { w: ["whole", 16], h: ["half", 8], q: ["quarter", 4], e: ["eighth", 2], s: ["16th", 1] };
  const parts = [
    { name: "Flute", program: 74, clef: ["G", 2], music:
      "E5q G5q A5q G5q | E5h D5h | C5q D5q E5e F5e G5q | A5w | G5q E5q D5e E5e C5q | D5h E5h | F5q E5q D5q B4q | C5w" },
    { name: "Violin", program: 41, clef: ["G", 2], music:
      "C5h B4h | C5h B4h | A4h B4h | C5w | E4h G4h | A4h G4h | A4h G4h~ | G4h E4h" },
    { name: "Piano", program: 1, clef: ["G", 2], music:
      "C4+E4+G4w | A3+C4+E4h G3+B3+D4h | F3+A3+C4h G3+B3+D4h | F3+A3+C4w | C4+E4+G4w | F3+A3+C4h C4+E4+G4h | D4+F4+A4h G3+B3+D4h | C4+E4+G4w" },
    { name: "Cello", program: 43, clef: ["F", 4], music:
      "C3h E3h | A2h G2h | F2h G2h | F2w | C3h E3h | F3h C3h | D3h G2h | C3w" },
    { name: "Drums", program: 1, drums: true, music:
      "F4q C5q F4q C5q | F4q C5q F4e F4e C5q | F4q C5q F4q C5q | F4q C5q C5e C5e C5q | F4q C5q F4q C5q | F4q C5q F4e F4e C5q | F4q C5q F4q C5q | F4h Rh" },
  ];

  function noteXml(tok, drums, tieStop) {
    const m = tok.match(/^(.+?)([whqes])(\.?)(~?)$/);
    if (!m) throw new Error("bad token " + tok);
    const [, pitches, t, dot, tie] = m;
    const [type, base] = TYPES[t];
    const dur = dot ? base * 1.5 : base;
    if (pitches === "R") {
      return `<note><rest/><duration>${dur}</duration><voice>1</voice><type>${type}</type></note>`;
    }
    return pitches.split("+").map((p, i) => {
      const pm = p.match(/^([A-G])(#|b)?(\d)$/);
      const alter = pm[2] === "#" ? 1 : pm[2] === "b" ? -1 : 0;
      const pitch = drums
        ? `<unpitched><display-step>${pm[1]}</display-step><display-octave>${pm[3]}</display-octave></unpitched>`
        : `<pitch><step>${pm[1]}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${pm[3]}</octave></pitch>`;
      const ties = (tieStop ? '<tie type="stop"/>' : "") + (tie ? '<tie type="start"/>' : "");
      const tied = (tieStop ? '<tied type="stop"/>' : "") + (tie ? '<tied type="start"/>' : "");
      return `<note>${i ? "<chord/>" : ""}${pitch}<duration>${dur}</duration>${ties}<voice>1</voice>` +
        `<type>${type}</type>${dot ? "<dot/>" : ""}${drums && t !== "w" && t !== "h" ? "<stem>up</stem>" : ""}` +
        `${tied ? `<notations>${tied}</notations>` : ""}</note>`;
    }).join("");
  }

  let partList = "", body = "";
  parts.forEach((p, idx) => {
    const id = "P" + (idx + 1);
    const ch = p.drums ? 10 : idx + 1;
    partList += `<score-part id="${id}"><part-name>${p.name}</part-name>` +
      `<score-instrument id="${id}-I1"><instrument-name>${p.name}</instrument-name></score-instrument>` +
      `<midi-instrument id="${id}-I1"><midi-channel>${ch}</midi-channel><midi-program>${p.program}</midi-program></midi-instrument></score-part>`;
    let xml = `<part id="${id}">`;
    let pendingTie = false;
    p.music.split("|").forEach((bar, mi) => {
      xml += `<measure number="${mi + 1}">`;
      if (mi === 0) {
        const clef = p.drums ? "<clef><sign>percussion</sign></clef>" : `<clef><sign>${p.clef[0]}</sign><line>${p.clef[1]}</line></clef>`;
        xml += `<attributes><divisions>${DIV}</divisions><key><fifths>0</fifths></key>` +
          `<time><beats>4</beats><beat-type>4</beat-type></time>${p.drums ? "<staff-details><staff-lines>5</staff-lines></staff-details>" : ""}${clef}</attributes>`;
        if (idx === 0) {
          xml += `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>` +
            `<per-minute>100</per-minute></metronome></direction-type><sound tempo="100"/></direction>`;
        }
      }
      bar.trim().split(/\s+/).forEach(tok => {
        xml += noteXml(tok, p.drums, pendingTie);
        pendingTie = tok.endsWith("~");
      });
      if (mi === 7) xml += `<barline location="right"><bar-style>light-heavy</bar-style></barline>`;
      xml += `</measure>`;
    });
    body += xml + `</part>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1"><work><work-title>데모: 작은 행진</work-title></work>
<identification><creator type="composer">PDFScore</creator></identification>
<part-list>${partList}</part-list>${body}</score-partwise>`;
};
