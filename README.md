# C — 김세아 · 여전히 빈 집에 있습니다

전시용 **완전 오프라인 로컬 웹앱** (디지털 영상 + 사운드 오브제).

일상의 영상이 순환하고, 서로 다른 장소에서 수집된 라디오 사운드가 영상과 독립된
시간으로 개입한다. 영상 토글과 라디오 다이얼은 서로 영향을 주지 않으며,
같은 장면으로 돌아와도 함께 들리는 라디오는 달라져 있을 수 있다.

- 기준 화면: **1024×600** (7인치 HDMI IPS)
- 실행 환경: Windows/macOS Chrome·Edge → 최종 Raspberry Pi Chromium 키오스크
- 실행에 인터넷·외부 API·CDN·외부 폰트가 **전혀 필요 없음** (모든 리소스 로컬 포함)
- 백엔드·데이터베이스 없음. 정적 파일 + 로컬 서버만 사용.

데모(온라인 미리보기용, GitHub Pages): 저장소 Settings → Pages → Source를
**GitHub Actions**로 설정하면 `main` 푸시마다 자동 배포된다.
(전시 본번은 반드시 로컬 서버로 실행 — Pages는 확인용이다.)

---

## 1. 빠른 시작 (Windows)

1. [Node.js LTS](https://nodejs.org) 설치 (설치 시에만 인터넷 필요, 실행은 오프라인)
2. 이 저장소를 다운로드/클론
3. 폴더에서 명령 프롬프트를 열고:

   ```
   node tools/serve.mjs
   ```

4. Chrome/Edge에서 <http://localhost:8080> 접속
5. **START RECEIVER** 클릭 → 재생 시작
6. `F` 키로 전체화면

macOS도 동일하다 (터미널에서 같은 명령).

Node 없이 실행하려면 Python으로도 가능하다:
`python -m http.server 8080` (단, manifest 수정 후에는 강력 새로고침 `Ctrl+Shift+R` 필요.
`tools/serve.mjs`는 json을 no-store로 응답해 이 문제가 없다.)

> `index.html`을 더블클릭(file://)으로 열면 fetch/CORS 제한으로 동작하지 않는다.
> 반드시 localhost 서버로 실행한다.

## 2. 조작법

| 입력 | 동작 |
|---|---|
| `↑` / 화면 토글 위 | 이전 영상 |
| `↓` / 화면 토글 아래 | 다음 영상 |
| `←` / 다이얼 반시계(드래그·휠·왼쪽 클릭) | 이전 라디오 |
| `→` / 다이얼 시계(드래그·휠·오른쪽 클릭) | 다음 라디오 |
| `F` | 전체화면 |
| `D` | 개발 진단 오버레이 (전시 모드에서는 비활성) |

- 영상이 끝나면 자동으로 다음 영상으로 넘어간다 (원형 순환).
- 라디오를 바꾸면 TUNING… 과 튜닝 노이즈 후, 해당 파일의 **무작위 지점**부터 재생된다.
- 영상 전환과 라디오 전환은 서로 완전히 독립이다.

## 3. 모드

URL 파라미터 또는 `data/config.json`으로 전환:

- 개발 모드(기본): `http://localhost:8080` — 화면 컨트롤·`D` 진단 사용 가능
- **전시 모드**: `http://localhost:8080/?exhibition=1` — 보조 버튼·진단 완전 숨김
- 디버그 켜고 시작: `?debug=1`
- **가속 내구 테스트**: `?endurance=1` — 빠른 자동 전환 반복 (전시 모드에서는 강제 무시)

## 4. 실제 미디어 넣는 위치

```
media/
├── videos/    ← 영상 (video_001.mp4 ...) — 사진도 사운드와 결합한 MP4로 렌더해 넣는다
├── radio/     ← 라디오 녹음 (radio_001.mp3 ...)
└── effects/   ← 튜닝 노이즈 (tuning_01.mp3 ...)
data/
├── videos.json   ← 영상 목록 (배열 순서 = 재생 순서)
├── radio.json    ← 라디오 목록 + 효과음 목록
└── config.json   ← 설정값
```

현재 포함된 미디어는 ffmpeg로 만든 **placeholder**다(영상 10개 = WebM, 라디오 5개,
튜닝 3개). 실제 파일로 교체하려면 파일을 폴더에 넣고 manifest의 `file` 값만 맞추면
된다. 형식은 브라우저가 재생 가능하면 무엇이든 된다 — 전시(Raspberry Pi)용 권장:
**H.264 MP4 640×480(4:3) + AAC**, 라디오는 MP3.

### manifest 형식

`data/videos.json` — 배열 순서대로 원형 재생:

```json
[
  { "id": "v01", "file": "video_001.mp4", "label": "scene 01" }
]
```

`data/radio.json`:

```json
{
  "stations": [
    { "id": "r01", "file": "radio_001.mp3", "country": "KR", "city": "Jeju",
      "station": "RADIO JEJU", "frequency": "89.1 FM" }
  ],
  "effects": ["tuning_01.mp3"]
}
```

`frequency` 대신 `type`(예: `"AM"`, `"단파"`)을 써도 된다.

### 미디어 개수 변경 (코드 수정 불필요)

1. 폴더에 파일 추가/제거
2. `videos.json` / `radio.json` 항목 추가/제거
3. 브라우저 새로고침 → 앱이 배열 길이를 자동 사용

개수는 어떤 재생 로직에도 하드코딩되어 있지 않다 (1개, 30개, 20개 모두 동작).
항목이 있는데 파일이 없거나 손상된 경우, 해당 항목만 건너뛰고 앱은 계속 동작한다.

### 실제 원본 파일 넣기 — 인제스트 파이프라인 (권장)

원본을 직접 변환할 필요 없이, 아래 절차면 끝난다:

1. 원본 영상을 `incoming/videos/`에, 원본 녹음을 `incoming/radio/`에 넣는다
   (형식 자유: mp4/mov/wav/m4a 등, 파일명 자유 — 이름순으로 재생 순서가 된다)
2. `node tools/ingest.mjs` 실행 (`--dry`로 계획만 미리보기)
   - 영상 → `media/videos/video_NNN.mp4` (H.264 고화질 CRF18 + AAC, **원본 해상도 유지**)
     — 파일마다 해상도·화질이 달라도 무방하다. 앱이 640×480 박스에 알아서 맞춘다
   - 녹음 → `media/radio/radio_NNN.mp3` (128kbps)
   - `videos.json` / `radio.json` 자동 갱신 (이전 manifest는 `.bak`으로 백업)
   - **전시(Raspberry Pi) 빌드**: `node tools/ingest.mjs --size 640x480`
     — Pi 3는 1080p까지만 하드웨어 디코딩되므로 4K급 원본은 그대로 재생 불가.
     데스크탑 데모는 원본 해상도, Pi에는 --size 빌드를 사용한다 (초과 시 경고 표시)
3. `radio.json`에서 새 방송의 국가/도시/방송국/주파수를 채운다
   — **다시 인제스트해도 입력한 정보는 원본 파일명 기준으로 유지된다**
4. 앱 새로고침

ffmpeg 필요: Windows `winget install ffmpeg` / macOS `brew install ffmpeg`.
원본(incoming/)은 삭제되지 않으며 git에도 커밋되지 않는다.

### 용량 가이드

| 항목 | 대략 크기 | 예상 총량 |
|---|---|---|
| 영상 (640×480 H.264 3Mbps) | 분당 약 23MB | 30개 × 1분 ≈ 0.7GB |
| 라디오 (MP3 128kbps) | 분당 약 1MB | 20개 × 10분 ≈ 0.2GB |

- **로컬 실행(전시 본번)**: 수 GB여도 전혀 문제없다. 파일은 스트리밍 재생되고
  전체를 메모리에 올리지 않는다.
- **GitHub**: 파일당 100MB 제한, 저장소 1GB 권장 — 실제 전시 파일 전체를 올리는
  용도로는 부적합. 실제 파일은 로컬에서 관리하고, GitHub/웹 데모에는 소량만 둔다.
- 백업은 GitHub 대신 외장하드/클라우드 드라이브에 media 폴더째 복사가 간단하다.

### 도우미 스크립트

```
node tools/ingest.mjs            # incoming/ 원본을 변환 + manifest 갱신 (위 참고)
node tools/scan-media.mjs        # 폴더를 스캔해 manifest 초안(*.draft.json) 생성
node tools/validate-manifest.mjs # JSON 문법·필수 필드·파일 존재 검사
bash tools/generate-placeholders.sh  # placeholder 재생성 (ffmpeg 필요)
```

## 5. 설정값 (`data/config.json`)

| 키 | 기본값 | 설명 |
|---|---|---|
| `videoTransitionMs` | 300 | 영상 전환 흰 화면+무음 시간 |
| `videoAudioFadeMs` | 80 | 영상 오디오 페이드 (클릭 노이즈 방지) |
| `videoVolume` / `radioVolume` | 1.0 / 0.8 | 독립 볼륨 |
| `radioFadeMs` | 100 | 라디오 페이드 |
| `tuningDurationMs` | [500, 800] | 튜닝 노이즈 구간 |
| `radioMinRemainingSec` | 20 | 무작위 시작점의 최소 잔여 재생 시간 |
| `autoRadioSwitch` | enabled: false | 선택 기능: 강제 자동 라디오 전환 |
| `showControls` | true | 보조 버튼 표시 |
| `exhibitionMode` | false | 전시 모드 |
| `debug` | false | 디버그 오버레이로 시작 |
| `cursorHideMs` | 3000 | 무입력 시 커서 숨김 |
| `useWakeLock` | true | 화면 절전 방지 (미지원 브라우저에서도 앱은 동작) |
| `restoreLastVideo` | false | 재시작 시 마지막 영상 인덱스 복원 |
| `hardwareBridge` | enabled: false | 추후 GPIO/ESP32 WebSocket 브리지 |

## 6. 1024×600 / 화면 테스트

- 화면은 1024:600 비율을 유지하며 다른 해상도에서는 레터박스로 중앙 정렬된다.
- Chrome DevTools(F12) → Device Toolbar에서 1024×600으로 확인 가능.
- 전체화면: `F` 키. 우클릭·드래그·선택은 차단되어 있다.
- 화면 절전: Wake Lock API 사용. OS 차원 설정도 병행 권장 —
  - Windows: 설정 → 시스템 → 전원 → 화면 끄기 "안 함"
  - macOS: 시스템 설정 → 잠금 화면 → 디스플레이 끄기 "안 함"
  - Raspberry Pi: `docs/RASPBERRY_PI.md` 참고

## 7. 장시간(9시간+) 실행

- video/audio DOM 요소 재사용, 리스너 1회 등록, 타이머 정리, 로그 200줄 상한
- watchdog(5초 주기)이 영상·라디오 정지를 감지해 자동 복구
- 오류 파일은 2회 실패 시 세션 동안 건너뛰고 기록(`D` 오버레이에서 확인)
- 가속 내구 테스트: `?endurance=1&debug=1` 로 실행해 수백 회 전환 후
  오버레이의 SWITCHES/recoveries/힙 상태를 확인한다.

## 8. 알려진 제약

- 최초 1회 클릭(START RECEIVER)은 브라우저 자동재생 정책상 반드시 필요하다.
- file:// 직접 실행 불가 (localhost 필수).
- placeholder 영상은 WebM(VP9)이므로 Raspberry Pi 3에서는 하드웨어 디코딩이 안 된다
  — 실제 전시 파일은 H.264 MP4를 사용할 것.
- Python 서버 사용 시 manifest 수정 후 강력 새로고침 필요.

## 9. 하드웨어/전시 이행

- 설계 문서: [`docs/DESIGN.md`](docs/DESIGN.md) — 구조, 상태 머신, Adapter,
  ESP32-C3/TFT/다이얼 메시지 인터페이스
- Raspberry Pi 운영: [`docs/RASPBERRY_PI.md`](docs/RASPBERRY_PI.md) — 자동 부팅,
  키오스크, 안전 종료, 백업, GPIO/WebSocket 브리지 계획
