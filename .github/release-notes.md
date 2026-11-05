## 설치 방법

### macOS (macOS 12 이상 · Apple silicon / Intel)

1. `Flashnote-VERSION-macOS-universal.dmg`를 내려받아 엽니다.
2. `Flashnote.app`을 **Applications** 폴더로 끌어다 놓습니다.
3. 처음 실행할 때 macOS가 막으면 Finder에서 앱을 **Control-클릭 → 열기**를 누르거나, **시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기**를 선택합니다.
   터미널을 쓰는 경우: `xattr -dr com.apple.quarantine /Applications/Flashnote.app`

이 빌드는 아직 Developer ID 서명·공증이 없어서 위 과정이 한 번 필요합니다. 노트는 계정이나 서버 없이 이 컴퓨터에만 저장됩니다.

### Windows (Windows 10 이상 · x64 / ARM64)

1. `Flashnote-VERSION-windows-setup.exe`를 내려받아 실행합니다.
2. SmartScreen이 "Windows가 PC를 보호했습니다"라고 막으면 **추가 정보 → 실행**을 누릅니다.
3. 설치 파일 하나가 x64와 ARM64를 모두 지원하며, 관리자 권한 없이 사용자 폴더에 설치되고 시작 메뉴·바탕화면 바로가기를 만듭니다.

설치 없이 쓰려면 `Flashnote-VERSION-windows-portable.zip`을 풀어 `flashnote-amd64.exe`(또는 ARM64 기기에서는 `flashnote-arm64.exe`)를 실행하면 됩니다.

각 파일의 SHA-256은 `SHA256SUMS.txt`에 있습니다.
