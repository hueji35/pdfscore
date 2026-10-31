# PDFScore — 웹 악보 플레이어

PDF·이미지·Guitar Pro·MusicXML 악보를 브라우저에서 보기 좋게 표시하고, MIDI로 재생하면서 악보를 자동으로 넘겨 주는 웹앱입니다.
PC, 스마트폰, 태블릿 어디서든 주소만 열면 바로 쓸 수 있고, 아무것도 설치하지 않습니다.

**바로 쓰기: https://hueji35.github.io/pdfscore/**

> A browser-based score viewer and player. Open a PDF, image, Guitar Pro or MusicXML score, toggle each part's visibility and sound, and play it back with auto-scroll. Everything runs locally in your browser — no installation, no upload.

## 주요 기능

- **파트별 표시/소리 켜고 끄기**: 👁를 끄면 그 파트가 악보에서 사라지고 다시 배치됩니다. 🔊로 소리만 끌 수도 있고, 파트마다 음량과 재생 악기 소리(MIDI 음색)를 바꿀 수 있습니다. 파트 이름은 악보에 적힌 이름을 그대로 쓰고, 음색은 그 이름으로 먼저 골라 둡니다.
- **재생과 자동 스크롤**: 재생하면 커서가 따라가며 악보가 넘어갑니다. 악보를 누르면 그 위치부터 재생합니다.
- **연주 순서**: 도돌이표, 1·2번 괄호, D.C./D.S./Coda를 펼쳐서 재생합니다. 🔁 **반복 펼치기**를 켜면 악보도 연주 순서대로 펼쳐서 표시하고, 끄면 적힌 그대로 표시합니다(설정은 기억됩니다).
- **템포**: BPM 단위로 조절합니다. 확대/축소도 지원합니다.
- **줄당 마디 수**: 밴드 악보는 한 줄에 넣을 마디 수(자동, 2~8마디)를 고를 수 있습니다.
- **TAB·드럼 악보**: 기타·베이스 TAB과 드럼 보표를 그대로 표시하고 재생합니다.
- **코드 이름**: 밴드 스코어 PDF에 코드 이름(Am, G/B, Fm7(9) 등)이 적혀 있으면 맨 위 파트 위에 표시합니다.

## 읽을 수 있는 파일

| 형식 | 방식 |
|---|---|
| Guitar Pro (`.gp`, `.gpx`, `.gp3`~`.gp7`) | 그대로 열어 TAB·드럼까지 표시 |
| MusicXML (`.musicxml`, `.xml`, `.mxl`) | 그대로 열기 |
| 악보 프로그램으로 만든 밴드 스코어 PDF | PDF 안의 데이터(기호 모양과 위치)를 직접 읽어 TAB·드럼까지 표시. 수 초 안에 열림 |
| Sibelius·Finale로 만든 피아노 악보 PDF | 악보 글꼴(Opus, Maestro)로 찍힌 기호를 데이터로 읽어 큰보표로 표시. 조표·못갖춘마디·8va·셋잇단 반영 |
| MuseScore로 만든 피아노 악보 PDF | MuseScore 악보 글꼴로 찍힌 기호를 데이터로 읽어 큰보표로 표시. 박자표·조표·8va·붙임줄 반영 |
| 그 밖의 PDF, PNG, JPG | 브라우저 안에서 악보 인식(OMR) 후 표시 |

- 데이터로 읽는 방식은 악보 프로그램이 만든 벡터 PDF(기호를 도형이나 Sibelius·Finale 등의 악보 글꼴로 그린 것)를 대상으로 합니다. 데이터로 읽을 수 없는 PDF(스캔본 등)는 악보 인식(OMR)으로 처리합니다.
- 복잡한 피아노 편곡(두 보표를 넘나드는 빔, 촘촘한 여러 성부 등)은 일부 마디의 리듬이 틀릴 수 있습니다.
- 열어 둔 악보는 💾 버튼으로 저장할 수 있습니다. 밴드 악보(Guitar Pro 파일, 데이터로 읽은 PDF)는 Guitar Pro(`.gp`)로, 그 밖의 악보는 MusicXML로 저장됩니다. 틀린 부분은 MuseScore 같은 프로그램에서 고친 뒤 다시 열면 됩니다.

## 개인정보와 저작권

- **파일은 서버로 전송되지 않습니다.** 악보 읽기, 인식, 재생은 모두 사용자의 브라우저 안에서 이루어집니다.
- 인식 결과와 인식 모델은 같은 기기의 브라우저 저장소에만 보관됩니다(다시 열 때 빠르게 열기 위해).
- 이 저장소에는 악보 파일이 들어 있지 않습니다. 악보 저작물은 정당하게 구입했거나 이용 권한이 있는 것만 사용해 주세요. 이 앱으로 읽은 악보를 다른 사람에게 배포하는 것은 저작권 침해가 될 수 있습니다.

## 쓰는 방법

1. https://hueji35.github.io/pdfscore/ 를 엽니다.
2. 📂 **열기** 버튼으로 악보 파일을 엽니다.
3. 🎻 **파트** 패널에서 보고 싶은 파트·듣고 싶은 파트를 고르고 ▶로 재생합니다(키보드는 Space).

### 처음 쓸 때 내려받는 것

- **악보 인식(OMR)** 을 처음 쓸 때 인식 모델을 내려받습니다(WebGPU 기기 약 130MB, 그 밖의 기기 약 180MB). 한 번 받으면 브라우저에 저장됩니다. Wi‑Fi에서 쓰기를 권합니다.
- Guitar Pro·밴드 스코어 PDF 재생에 쓰는 악기 소리는 앱에 들어 있습니다.
- MusicXML·인식 악보 재생에 쓰는 악기 소리는 처음 재생할 때 인터넷에서 악기당 1~2MB씩 내려받습니다. 오프라인이면 기본 신스음으로 재생합니다.

### 악보 인식(OMR) 참고

- 엔진은 [homr-web](https://github.com/jymen/homr-web)(homr의 브라우저 이식판)입니다.
- PC + WebGPU 기준으로 페이지당 약 30초가 걸립니다(오선이 많을수록 오래 걸림). 첫 페이지를 먼저 보여 주고 나머지를 이어서 읽습니다. WebGPU가 없는 기기는 더 오래 걸립니다.
- 인식 결과는 페이지별로 저장되므로, 같은 파일을 다시 열면 몇 초 만에 열리고 중간에 끊겼다면 남은 페이지만 읽습니다.
- 잘 되는 악보: 깨끗한 인쇄 악보, 300dpi 스캔, 똑바로 찍은 사진
- 어려운 악보: 손글씨, 흐린 사진, 드럼 보표, 가사가 많이 겹친 악보
- 악기 이름은 인식하지 않으므로 파트가 "파트 1, 2…"로 표시됩니다.

## 직접 호스팅하기

정적 파일만으로 동작하므로 이 저장소를 그대로 정적 호스팅에 올리면 됩니다.

| 호스팅 | 비고 |
|---|---|
| GitHub Pages | 저장소를 포크하고 Settings → Pages를 켭니다. 파일당 100MB 제한 이내입니다(가장 큰 모델 94MB) |
| Hugging Face Spaces (Static) | 큰 파일도 문제없습니다 |

Netlify, Cloudflare Pages는 파일당 용량 제한 때문에 인식 모델을 올리기 어렵습니다.

### 내 PC에서 실행하기

Python 3가 있으면 `start.bat`(Windows) 또는 아래 명령으로 로컬 웹 서버를 띄울 수 있습니다. 같은 Wi‑Fi의 폰·태블릿에서는 콘솔에 표시되는 `http://192.168.x.x:8000` 주소로 접속합니다.

```bash
python3 server.py
```

`index.html`을 더블클릭해서 열면(`file://`) 브라우저 보안 정책 때문에 PDF 데이터 읽기와 악보 인식이 동작하지 않습니다.

## 구조

| 파일 | 역할 |
|---|---|
| `index.html`, `style.css`, `app.js` | 화면, 파일 열기, MusicXML 표시·재생, 악보 인식 흐름 |
| `tabmode.js` | Guitar Pro·밴드 스코어 표시와 재생 (alphaTab) |
| `pdfvector.js` | PDF 그리기 명령에서 기호·선·글꼴 기호 목록 추출 |
| `bandscore.js` | 악보 해석 (보표·마디·음표·TAB·드럼·피아노 큰보표·연주 순서 → alphaTex) |
| `bandshapes.js` | 기호 모양 사전 |
| `lib/`, `models/` | 외부 라이브러리와 인식 모델 |

## 라이선스와 사용한 오픈소스

| 구성 요소 | 라이선스 |
|---|---|
| [homr-web](https://github.com/jymen/homr-web) / [homr](https://github.com/liebharc/homr) (악보 인식, 모델 포함) | AGPL-3.0 |
| [alphaTab](https://github.com/CoderLine/alphaTab) (TAB·드럼 표시와 재생) | MPL-2.0 |
| [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay) | BSD-3-Clause |
| [pdf.js](https://github.com/mozilla/pdf.js) | Apache-2.0 |
| [onnxruntime-web](https://github.com/microsoft/onnxruntime) | MIT |
| OpenCV.js | Apache-2.0 |
| [soundfont-player](https://github.com/danigb/soundfont-player) | MIT |
| Bravura 글꼴 (alphaTab 포함) | SIL OFL 1.1 |
| Sonivox 사운드폰트 (alphaTab 포함) | Apache-2.0 |
| [MusyngKite 사운드폰트](https://github.com/gleitz/midi-js-soundfonts) (재생 시 내려받음) | CC BY-SA 3.0 |

라이선스 원문은 `lib/` 폴더(라이선스 파일, 각 라이브러리 파일 머리말, `lib/alphatab/font`·`lib/alphatab/soundfont`)와 위 링크의 각 프로젝트에서 볼 수 있습니다. 악보 인식 엔진 homr-web이 AGPL-3.0이므로, 이 앱을 수정해 웹에 공개할 때는 수정한 소스 코드도 함께 공개해야 합니다.
