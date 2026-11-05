# Flashnote 배포·설치 파일 운영 가이드

_Status: 현재 구현 기준 · 2026-11-05_

이 문서는 "사용자가 어느 OS에서든 내려받아 바로 설치"할 수 있게 만드는 절차를 소유합니다.
사용자용 안내는 [`README.md`](../README.md)가, 제품·기술·개발 규칙은 `PRODUCT.md` / `TECHNICAL.md` / `DEVELOPMENT.md`가 각각 소유합니다.

## 1. 지금 되는 것 / 아직 안 되는 것

| 항목 | 상태 |
| --- | --- |
| macOS DMG (Apple silicon + Intel, macOS 12+) | 됨 · GitHub Releases로 배포 |
| Windows 설치본 (x64 + ARM64 한 파일, NSIS) | 됨 · GitHub Releases로 배포 |
| Windows portable 실행 파일 (x64 / ARM64, 설치 없이 실행) | 됨 |
| 체크섬(SHA-256) | 됨 |
| Apple Developer ID 서명·공증 | 안 됨 → macOS 첫 실행 시 경고 1회 |
| Windows Authenticode 서명 | 안 됨 → SmartScreen 경고 1회 |
| 앱 내 자동 업데이트 | 안 됨 (수동 다운로드) |
| Linux(AppImage/deb), 스토어 배포, Homebrew/winget | 범위 밖 (§7) |

핵심만 말하면 **다운로드 → 설치 파일 실행 → 경고 한 번 넘기기**까지는 지금 구조로 완성되어 있고,
경고를 없애는 일은 돈과 계정(서명 인증서)이 필요한 별도 단계입니다.

## 2. 릴리스 한 번 내보내기

### 2-1. 태그로 배포 (정상 경로)

태그 이름이 유일한 버전 소스입니다. `v` 접두사를 뗀 값이 제품 버전이 됩니다.

```bash
git tag v0.2.0
git push origin v0.2.0
```

그러면 `.github/workflows/release-installers.yml`이 다음을 수행합니다.

1. `v0.2.0` → 버전 `0.2.0` 해석
2. macOS 러너: universal DMG 빌드 → `Flashnote-0.2.0-macOS-universal.dmg`
3. Windows 러너: x64/ARM64 실행 파일 + NSIS 설치본 → `Flashnote-0.2.0-windows-setup.exe`, portable 실행 파일 2종
4. 체크섬 파일 생성 후 GitHub Release 생성 및 자산 업로드

### 2-2. 태그 없이 파이프라인만 검증

릴리스를 만들지 않고 빌드만 확인할 때 씁니다(권장: 태그를 만들기 전에 한 번).

```bash
gh workflow run release-installers.yml --ref main -f version=0.1.0 -f publish=false
gh run watch
```

`publish=true`로 주면 태그 없이도 `v0.1.0` 릴리스가 만들어집니다. 이미 릴리스가 있으면 자산만 덮어씁니다(`--clobber`).

### 2-3. 버전 각인

CI는 패키징 전에 `scripts/stamp-release-version.mjs <버전>`을 실행해 다음 파일의 버전을 한 값으로 맞춥니다.

- `build/config.yml` (`info.version`)
- `build/darwin/Info.plist`, `build/darwin/Info.dev.plist` (`CFBundleShortVersionString`, `CFBundleVersion`)
- `build/windows/info.json` (exe 파일 버전/제품 버전)
- `build/windows/wails.exe.manifest` (어셈블리 버전)
- `build/windows/nsis/wails_tools.nsh` (설치본 기본 버전)

> 앱 화면에 표시되는 버전은 아직 Go 소스의 `app_service.go` `appVersion` 상수(`0.1.0-dev`)입니다.
> 릴리스마다 화면 버전까지 맞추려면 이 상수를 `var`로 바꾸고 빌드 시 `-ldflags "-X main.appVersion=<버전>"`을 넘기는 후속 작업이 필요합니다.

### 2-4. 산출물 이름 규칙

| 파일 | 대상 |
| --- | --- |
| `Flashnote-<버전>-macOS-universal.dmg` | macOS 12+, Apple silicon + Intel |
| `Flashnote-<버전>-windows-setup.exe` | Windows 10+ x64/ARM64, 사용자 단위 설치 |
| `Flashnote-<버전>-windows-x64-portable.exe` | 설치 없이 실행 (x64) |
| `Flashnote-<버전>-windows-arm64-portable.exe` | 설치 없이 실행 (ARM64) |
| `SHA256SUMS.txt` | 전체 체크섬 |

## 3. 파이프라인 구조

```
태그 v*  ─┐
          ├─ resolve (버전 해석, ubuntu)
          │
          ├─ macos   (macos-15)   : Wails universal 빌드 + DMG
          ├─ windows (windows-latest) : go build x2 + NSIS 설치본
          │
          └─ publish (ubuntu, 조건부) : 자산 모아서 GitHub Release 생성
```

| 구성 요소 | 역할 |
| --- | --- |
| `.github/workflows/release-installers.yml` | 릴리스 진입점(태그/수동 실행), 잡 오케스트레이션 |
| `.github/actions/setup-toolchain/action.yml` | Go 1.27.3, Node 24, pnpm 11.21.0, wails3 v3.0.0 고정 설치 |
| `.github/release-notes.md` | 릴리스 본문의 설치 안내(버전 치환 후 사용) |
| `Taskfile.release.yml` | 로컬·CI 공용 진입점: `package:macos:universal:dmg`, `package:windows`, `stamp:version` |
| `build/darwin/` | macOS 번들/서명/DMG 자산 |
| `build/windows/` | Windows 매니페스트, exe 파일 정보, NSIS 스크립트(`project.nsi`, `wails_tools.nsh`) |
| `scripts/package-windows-release.sh` | Windows 실행 파일 2종 + 설치본 빌드 |
| `scripts/stamp-release-version.mjs` | 릴리스 버전 각인 |

패키징 입력(워크플로, `build/**` 자산, `scripts/` 스크립트, `Taskfile.release.yml`)을 건드리는 pull request는
같은 두 잡(macOS DMG / Windows installer)을 실행하되 배포하지 않습니다. 태그를 만들기 전에 설치 파일이 실제로
만들어지는지 PR 단계에서 확인하는 게이트입니다.

`build/windows/`의 자산은 Wails v3.0.0이 생성하는 형식과 같습니다. `wails3 generate build-assets`를 실행하면
이 디렉터리가 템플릿 기본값으로 덮어써지므로, Flashnote 값(제품명·버전·아이콘)이 들어 있는 현재 파일을 기준으로 삼으세요.

### 로컬에서 같은 명령 실행

```bash
# macOS
wails3 task --taskfile ./Taskfile.release.yml package:macos:universal:dmg

# Windows (Git Bash) 또는 NSIS가 있는 macOS/Linux
VERSION=0.2.0 wails3 task --taskfile ./Taskfile.release.yml package:windows
# 위와 동일:
VERSION=0.2.0 bash ./scripts/package-windows-release.sh

# 설치 파일 없이 실행 파일만
VERSION=0.2.0 SKIP_INSTALLER=1 bash ./scripts/package-windows-release.sh
```

## 4. 사용자 설치 경험

### macOS

1. DMG 열기 → `Flashnote.app`을 Applications로 이동
2. 첫 실행 시 경고 → **Control-클릭 → 열기**, 또는 **시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기**
3. 터미널 대안: `xattr -dr com.apple.quarantine /Applications/Flashnote.app`

서명이 없기 때문에 생기는 동작입니다. 앱을 신뢰할 수 없는 상태에서 Gatekeeper를 전역 해제하는 방법은 안내하지 않습니다.

### Windows

1. `setup.exe` 실행
2. SmartScreen → **추가 정보 → 실행**
3. 관리자 권한 없이 `%LOCALAPPDATA%\Programs\Flashnote`에 설치, 시작 메뉴/바탕화면 바로가기 생성, 제거 프로그램 등록

설치본은 x64와 ARM64 실행 파일을 함께 담고 있어 기기에 맞는 쪽이 설치됩니다.
Windows 10/11에는 WebView2가 기본 포함되어 있고, 없는 환경에서는 설치본이 Microsoft 부트스트래퍼로 자동 설치합니다.

## 5. 서명: 경고를 없애는 단계

### 5-1. macOS — Apple Developer Program

| 준비물 | 값/비용 |
| --- | --- |
| Apple Developer Program 멤버십 | 연 99 USD |
| Developer ID Application 인증서 | 멤버십으로 발급(`.p12`) |
| 공증 자격 증명 | App Store Connect API 키 또는 Apple ID + 앱 전용 암호 |

필요한 secret(예): `APPLE_CERTIFICATE_P12`(base64), `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_ID`, `APPLE_APP_PASSWORD`.

CI에 추가할 순서:

1. 임시 키체인 생성 → `.p12` import → `codesign --keychain`으로 서명
2. `build/darwin/Taskfile.yml`의 `darwin:sign` / `darwin:sign:notarize`(=`wails3 tool sign --notarize`) 사용
3. DMG는 서명된 `.app`으로 만든 뒤 `xcrun notarytool submit --wait` → `xcrun stapler staple bin/flashnote.dmg`

공증은 Apple 서버 응답을 기다리므로 잡 시간이 몇 분 늘어납니다.

### 5-2. Windows — Authenticode

| 방식 | 특징 |
| --- | --- |
| OV 코드서명 인증서 | 연 200~400 USD대, SmartScreen 평판이 쌓일 때까지 경고가 남을 수 있음 |
| EV 코드서명 인증서 | 더 비쌈, 평판 즉시 확보(하드웨어 토큰/클라우드 HSM 필요) |
| Azure Trusted Signing | 월 과금, 클라우드 서명이라 CI 연동이 단순 |

CI에 추가할 순서:

1. `scripts/package-windows-release.sh`에서 실행 파일과 설치본을 만든 뒤 `signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 <파일>` 실행
2. 인증서는 secret(base64 `.pfx` + 암호)으로 주입하고, 서명 후 반드시 `signtool verify /pa`로 검증
3. 서명은 **exe 2종과 설치본 모두**에 적용해야 설치 과정에서 경고가 사라집니다

### 5-3. 서명 없이 배포할 때의 원칙

- 릴리스 본문과 README에 경고 우회 절차를 항상 적는다(현재 `.github/release-notes.md`가 담당).
- Gatekeeper/SmartScreen 전역 해제, 출처 불명 바이너리 승인을 안내하지 않는다.
- 체크섬을 제공해 사용자가 파일 무결성을 확인할 수 있게 한다.

## 6. 자동 업데이트 (후속)

현재는 새 버전을 직접 내려받아 덮어 설치합니다. 자동 업데이트를 넣으려면 다음 순서가 현실적입니다.

1. 앱 시작 시 GitHub Releases API로 최신 태그 확인 → 새 버전이면 조용한 안내(설정 화면에 링크)
2. macOS에서 자동 설치까지 하려면 Sparkle 또는 자체 다운로드+교체가 필요한데, 둘 다 **공증된 서명**이 전제입니다
3. Windows는 설치본 재실행 방식이 가장 단순합니다

서명 전에는 "알림만" 하는 1단계까지만 하는 편이 안전합니다.

## 7. 배포 채널 확장

| 채널 | 필요한 일 | 비고 |
| --- | --- | --- |
| Homebrew cask | `savior714/homebrew-flashnote` tap + cask 파일(DMG URL, sha256) | macOS 서명 전에는 `--no-quarantine` 안내 필요 |
| winget | manifest 작성 후 `microsoft/winget-pkgs` PR | 설치본 URL + sha256 |
| Mac App Store | 샌드박스, 데이터 경로 변경, App Store 서명 | 앱 구조 수정이 필요해 별도 프로젝트 규모 |
| Microsoft Store | MSIX 패키징(`wails3 tool msix`) | 서명 인증서 필요 |
| Linux | WebKitGTK 의존성, `AppImage`/`deb`(`build/linux` 자산 추가) | 지금 제품 방향은 macOS/Windows |

## 8. 데이터 위치와 이전

| OS | 경로 |
| --- | --- |
| macOS | `~/Library/Application Support/Flashnote/` |
| Windows | `%APPDATA%\Flashnote\` |

`flashnote.db`(노트·폴더·휴지통), `attachments/`, `backups/`가 한 세트입니다.
앱을 다시 설치해도 이 폴더는 건드리지 않으므로 노트는 남습니다.
동기화 폴더(iCloud Drive, Dropbox, OneDrive 등)에 두면 SQLite와 첨부 파일이 어긋날 수 있으므로 금지입니다.

## 9. 릴리스 체크리스트

**태그 전**

- [ ] `wails3 task check` 통과 (`go test`, `go vet`, 프런트 타입 검사)
- [ ] macOS: `wails3 task --taskfile ./Taskfile.release.yml package:macos:universal:dmg`로 로컬 DMG 생성 확인
- [ ] Windows: `VERSION=<버전> bash ./scripts/package-windows-release.sh` 실행 확인(가능한 환경에서)
- [ ] `gh workflow run release-installers.yml -f version=<버전> -f publish=false`로 빌드만 검증
- [ ] `docs/PRODUCT.md`의 범위를 벗어나는 변경이 없는지 확인

**태그 후**

- [ ] Release 자산 4종(DMG, 설치본, portable 2종) + `SHA256SUMS.txt` 확인
- [ ] 실제 macOS/Windows 기기에서 설치 → 첫 실행 → 노트 저장 확인
- [ ] 이전 버전 위에 덮어 설치했을 때 노트가 유지되는지 확인

## 10. 문제 해결

| 증상 | 원인 / 해결 |
| --- | --- |
| `wails3: command not found` | `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0` 후 `$(go env GOPATH)/bin`을 PATH에 추가 |
| `makensis: command not found` | macOS `brew install makensis`, Ubuntu `apt install nsis`, Windows `choco install nsis` |
| `NSIS: Undefined ARCH` | `-DARG_WAILS_AMD64_BINARY`/`-DARG_WAILS_ARM64_BINARY` 없이 `project.nsi`를 직접 실행한 경우 |
| `corepack prepare pnpm@...` 실패 | 네트워크 또는 `frontend/package.json`의 `packageManager` 값 확인 |
| exe 실행 시 콘솔 창이 함께 뜸 | `-H windowsgui` 링크 플래그 누락(스크립트가 처리) |
| macOS 앱이 "손상되었습니다" | 서명 전 빌드의 정상 동작. Control-클릭 → 열기 또는 quarantine 제거 |
| Windows에서 앱이 빈 화면 | WebView2 런타임 미설치 또는 차단. `winget install Microsoft.EdgeWebView2Runtime` |
| 릴리스 업로드 403 | 워크플로 `permissions: contents: write`와 저장소 Actions 권한 확인 |
