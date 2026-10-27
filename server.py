"""PDFScore 로컬 웹 서버 (선택 사항).

웹 호스팅 없이 집 PC에서 바로 쓰고 싶을 때 실행합니다. 같은 Wi-Fi의 폰/태블릿에서도 접속할 수 있습니다.
악보 인식은 브라우저 안에서 이루어지므로, 이 서버는 파일만 제공합니다.
멀티스레드 인식이 가능하도록 cross-origin isolation 헤더(COOP/COEP)를 붙입니다.

사용법:  python server.py [--port 8000] [--no-browser]
Python 표준 라이브러리만 사용합니다.
"""
import argparse
import json
import os
import socket
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))  # 실제로 전송하지 않음, 기본 경로의 IP만 확인
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith("127."))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm",
                      ".onnx": "application/octet-stream", ".mxl": "application/vnd.recordare.musicxml",
                      ".musicxml": "application/vnd.recordare.musicxml+xml"}

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        # 모델(.onnx)은 오래 캐시, 앱 파일은 항상 새로 확인
        self.send_header("Cache-Control", "public, max-age=31536000, immutable" if self.path.endswith(".onnx") else "no-cache")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/api/status":
            body = json.dumps({"soundfonts": os.path.isdir(os.path.join(ROOT, "soundfonts"))}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()


def main():
    ap = argparse.ArgumentParser(description="PDFScore 로컬 웹 서버")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="0.0.0.0", help="127.0.0.1 로 지정하면 이 PC에서만 접속 가능")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    class Server(ThreadingHTTPServer):
        # Windows에서는 SO_REUSEADDR이 같은 포트 중복 실행을 허용하므로 끈다
        allow_reuse_address = os.name != "nt"
        daemon_threads = True

    httpd = None
    for port in range(args.port, args.port + 10):
        try:
            httpd = Server((args.host, port), Handler)
            args.port = port
            break
        except OSError:
            print(f"포트 {port} 사용 중 → 다음 포트 시도")
    if httpd is None:
        sys.exit("사용 가능한 포트를 찾지 못했습니다.")

    print("=" * 60)
    print(" PDFScore 악보 플레이어")
    print(f"  이 PC에서:      http://localhost:{args.port}")
    if args.host == "0.0.0.0":
        for ip in lan_ips():
            print(f"  폰/태블릿에서:  http://{ip}:{args.port}   (같은 Wi-Fi)")
    print("  종료: Ctrl+C")
    print("=" * 60, flush=True)
    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(f"http://localhost:{args.port}")).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    sys.exit(main())
