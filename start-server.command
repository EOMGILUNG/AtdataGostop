#!/bin/bash
# 더블클릭하면 GoStop 게임 서버가 뜸. 끄려면 이 창에서 Ctrl+C 또는 창 닫기.
cd "$(dirname "$0")"
echo ""
echo "  맞고 게임 서버 시작 — http://localhost:4174/"
echo "  끄려면 Ctrl+C 또는 이 창 닫기"
echo ""
exec python3 -m http.server 4174
