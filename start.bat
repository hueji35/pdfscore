@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul && (py -3 server.py %* & goto :eof)
where python >nul 2>nul && (python server.py %* & goto :eof)
echo Python이 필요합니다: https://www.python.org/downloads/
echo (또는 이 폴더를 Netlify, GitHub Pages 같은 웹 호스팅에 올려서 쓰세요. README.md 참고)
pause
