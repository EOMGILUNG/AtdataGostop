# 아이폰/안드로이드에서 맞고 돌리는 법 (GitHub Pages 배포)

이 문서대로 따라하면 무료로 영구 URL을 만들어서, 아이폰 Safari/크롬, 안드로이드 크롬, 데스크탑 어디서든 게임을 띄울 수 있어. 한 번만 셋팅하면 그 다음부터는 코드 수정 후 `git push` 한 번이면 자동으로 업데이트돼.

---

## 한 줄 요약

GitHub 계정으로 새 저장소 만들기 → 이 폴더를 그 저장소에 푸시 → Settings → Pages에서 켜기 → `https://<유저명>.github.io/<저장소명>/` 주소를 아이폰에서 열기.

---

## 1단계 · GitHub 계정 & 저장소 만들기

1. <https://github.com> 계정이 없으면 가입 (무료).
2. 우측 상단 `+` → **New repository**.
3. 이름은 자유 (예: `gostop`). **Public**으로 두기 (Pages는 무료 플랜에서 public 필요).
4. README/`.gitignore`/license는 **체크하지 말기** — 빈 저장소로 만들기.
5. 만들고 나면 다음 단계에서 쓸 URL이 보여:
   ```
   https://github.com/<유저명>/<저장소명>.git
   ```

## 2단계 · 이 폴더를 Git 저장소로 만들고 푸시

맥 터미널을 열고 (Spotlight → "터미널"), 아래를 그대로 복사해서 실행해. **`<유저명>`과 `<저장소명>`만 본인 것으로 바꾸기.**

```bash
cd ~/Downloads/GoStop_Game

# 만약 .DS_Store가 거슬리면 무시 목록 추가 (옵션)
echo ".DS_Store" > .gitignore

git init
git add .
git commit -m "Initial commit: Gostop game"
git branch -M main
git remote add origin https://github.com/<유저명>/<저장소명>.git
git push -u origin main
```

푸시할 때 GitHub 비번 대신 **Personal Access Token (PAT)**을 요구할 거야. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic) → `repo` 스코프 체크 → 발급. 그 토큰을 비번 자리에 붙여넣기.

## 3단계 · Pages 켜기

1. GitHub 저장소 페이지로 가서 **Settings** 탭.
2. 왼쪽 사이드바에서 **Pages**.
3. **Source**: Deploy from a branch.
4. **Branch**: `main`, **Folder**: `/ (root)`. **Save**.
5. 30초~2분 정도 기다리면 상단에 초록색으로 URL이 나와:
   ```
   https://<유저명>.github.io/<저장소명>/
   ```

## 4단계 · 아이폰에서 열기

1. 그 URL을 아이폰 Safari나 Chrome에 입력.
2. **홈 화면에 추가**하면 앱처럼 쓸 수 있어 — Safari 공유 버튼 → "홈 화면에 추가". 그러면 노치/상태바까지 활용한 풀스크린으로 켜져.

## 5단계 · 코드 수정 → 자동 배포

이후 코드를 바꾸면 그냥 다음 세 줄:

```bash
git add .
git commit -m "수정한 내용 설명"
git push
```

1~2분 뒤 사이트가 자동으로 새 버전으로 바뀌어. 아이폰에서는 캐시 때문에 새로고침이 안 먹을 수 있는데, `index.html`과 `src/*.js`의 `?v=20260513-48` 부분 숫자를 올려주면 모바일 캐시도 무효화돼.

---

## 가볍게 테스트만 하고 싶다면 (Wi-Fi 로컬 서버)

영구 배포 없이 같은 Wi-Fi에서만 5분 안에 보고 싶을 때:

```bash
cd ~/Downloads/GoStop_Game
python3 -m http.server 4174
```

맥의 로컬 IP 확인 (시스템 설정 → Wi-Fi → 세부정보 → IP 주소, 보통 `192.168.x.x`). 아이폰 Safari에서 `http://192.168.x.x:4174/` 접속. 맥이 켜져 있고 같은 Wi-Fi일 때만 작동.

---

## 모바일 친화 작업 요약 (이미 적용됨)

- `index.html` — viewport-fit, apple-mobile-web-app, theme-color, manifest 메타 추가
- `manifest.webmanifest` — PWA 매니페스트, 홈 화면 추가 시 앱처럼 동작
- `.nojekyll` — GitHub Pages가 Jekyll 처리하지 않도록 차단
- `src/data/cards.js` — 절대경로 `/cards/...` → 상대경로 `cards/...` (서브경로 호스팅 대응)
- `src/styles.css` —
  - `100dvh` 도입 (모바일 Safari URL 바 변화 대응)
  - `env(safe-area-inset-*)` 패딩 (아이폰 노치/홈인디케이터)
  - 글로벌 `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation`
  - 카드 / 버튼 `user-select: none`, `-webkit-user-drag: none`
  - 전용 모바일 미디어쿼리 — 좁은 화면 + 터치스크린에서 더 큰 탭 타깃, 정돈된 레이아웃
  - 가로 모드(landscape) 미디어쿼리로 가로화면 대응
