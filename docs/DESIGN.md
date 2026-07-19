# 설계 문서 — C · 여전히 빈 집에 있습니다

## 1. 데스크탑 미리보기 ↔ 최종 Raspberry Pi 구조 비교

두 버전은 **같은 웹앱 코어**를 사용한다. 다른 것은 입출력 장치뿐이다.

| | 데스크탑 미리보기 (현재) | 최종 Raspberry Pi |
|---|---|---|
| 앱 코어 | 동일한 HTML/CSS/JS | 동일한 HTML/CSS/JS |
| 서버 | `node tools/serve.mjs` 수동 실행 | systemd로 자동 실행 |
| 브라우저 | Chrome/Edge 수동 접속 | Chromium 키오스크 자동 실행 |
| 영상 입력 | 키보드 ↑↓, 화면 토글 | 물리 ON-OFF-ON 토글 (GPIO) |
| 라디오 입력 | 키보드 ←→, 화면 다이얼 | 물리 회전 다이얼 (GPIO 또는 ESP32) |
| 라디오 정보 | 메인 화면 내 TFT 스타일 패널 | (옵션) 별도 TFT — ESP32가 갱신 |
| 오디오 출력 | 단일 출력에 혼합 | (옵션) 영상음/라디오음 물리 분리 |
| 화면 | 브라우저 창 / 전체화면 | 1024×600 HDMI 전체화면 |

화면 레이아웃은 실물 케이싱 도면을 따른다:
왼쪽 = 스피커 그릴 / TFT 라디오 정보 / 라이트 / 다이얼,
오른쪽 = 영상(640×480, 4:3) / video info 바 / 토글.
최종 케이싱에서는 화면 다이얼·토글 영역이 물리 부품으로 대체된다.

## 2. 공통 코어와 Adapter 구조

```
assets/js/
├── app.js      AppController  — 시작·정지, 모듈 연결, Wake Lock, endurance test
├── config.js   Config         — 기본값 + data/config.json + URL 파라미터
├── library.js  MediaLibrary   — manifest 로딩·검증 (개수는 배열 길이로만 결정)
├── video.js    VideoController— 영상 재생, 원형 순환, 흰색 전환, 오류 건너뛰기
├── radio.js    RadioController— 라디오 재생, 무작위 시작점, 튜닝 전환
├── ui.js       UIController   — 패널 표시, TUNING, 커서 숨김, 전체화면, 진단
├── input.js    InputController + Adapters
└── diagnostics.js Diagnostics — 로그 링버퍼, 오류 기록, watchdog
```

### 입력 명령 버스

모든 입력 장치는 동일한 명령만 발행한다:

```
prevVideo · nextVideo · prevRadio · nextRadio · toggleFullscreen · toggleDebug
```

어댑터는 재생 로직을 모른다. `InputController.dispatch(cmd)` → AppController가
`videoCtl.next()` 등에 연결한다. 하드웨어가 추가되어도 코어는 변경되지 않는다.

현재 어댑터: `DesktopKeyboardAdapter`, `ToggleAdapter`(화면 토글, 자동복귀·재입력 방지),
`DialAdapter`(드래그 30°/스텝·휠·클릭), `TouchMouseAdapter`(보조 버튼),
`LocalWebSocketAdapter`(하드웨어 브리지 수신용, 기본 비활성).

## 3. 미디어 manifest 구조

- `data/videos.json`: `[{ id, file, label? }]` — 배열 순서 = 고정 원형 재생 순서
- `data/radio.json`: `{ stations: [{ id, file, country, city, station, frequency|type }], effects: [파일명] }`
- 재생 코드는 `videos.length` / `stations.length`만 사용한다. 개수 하드코딩 없음.
- 인덱스 계산: `next = (i + 1) % n`, `prev = (i - 1 + n) % n`
- 캐시 무효화: manifest fetch에 `?t=Date.now()` + `cache: no-store`
- 오류 내성: 필수 필드 누락 항목 제외, 파일 없음/손상 시 2회 실패 후 세션 동안
  건너뛰고 기록, 전 항목 실패 시에도 앱은 살아 있음(NO SIGNAL 상태로 로그 유지)

## 4. 상태 머신과 전환 중 입력 잠금

### 영상 (VideoController)

```
IDLE ──입력(↑/↓) 또는 ended──▶ TRANSITIONING ──완료──▶ IDLE
```

TRANSITIONING 동안 `transitioning` 플래그로 모든 영상 입력을 무시한다
(빠른 연타로 여러 장면을 건너뛰는 것을 방지 — 테스트로 검증됨).

전환 시퀀스: ① 오디오 80ms 페이드아웃 → ② 흰 화면+무음 300ms(설정 가능) →
③ 새 영상 0초부터 재생 → ④ 오디오 80ms 페이드인.
입력 전환과 자연 종료가 동일한 경로를 사용한다.

### 라디오 (RadioController)

```
PLAYING ──입력(←/→) 또는 ended──▶ SWITCHING(TUNING) ──완료──▶ PLAYING
```

SWITCHING 동안 `switching` 플래그로 라디오 입력을 무시한다.
시퀀스: ① 100ms 페이드아웃 → ② TUNING… 표시 → ③ 튜닝 노이즈(효과 파일 무작위,
500~800ms) — 이 사이에 새 파일 로드·무작위 시작점 계산을 병렬 수행 → ④ 정보 갱신 →
⑤ 무작위 지점부터 재생 → ⑥ 100ms 페이드인.

무작위 시작점: `loadedmetadata` 이후
`start = random() × max(0, duration − minRemaining)`;
duration이 NaN/Infinity/짧음 → 0초. metadata 8초 타임아웃 → 오류 처리.

두 상태 머신은 완전히 독립이다. 서로의 요소·플래그를 참조하지 않는다.

## 5. ESP32-C3 / TFT / 회전 다이얼 예정 인터페이스

펌웨어는 아직 구현하지 않는다(부품 미확정). 메시지 형식만 고정한다.

### 전송 계층

- 방식 A: Pi의 Python 프로그램이 GPIO를 읽고 로컬 WebSocket(`ws://localhost:8765`)으로 명령 전송
- 방식 B: ESP32-C3가 다이얼+TFT를 담당, USB Serial 또는 WebSocket으로 Pi와 통신

웹앱 쪽 수신은 두 방식 모두 `LocalWebSocketAdapter` 하나로 처리한다
(`config.json`의 `hardwareBridge.enabled: true`로 활성화).

### 입력 메시지 (브리지 → 웹앱), JSON 한 줄

```json
{ "cmd": "NEXT_VIDEO" }      // PREVIOUS_VIDEO / NEXT_RADIO / PREVIOUS_RADIO
```

물리 다이얼 시계 방향 1스텝 = `NEXT_RADIO` 1회 = 데스크탑 `→` 키와 완전히 동일한
경로로 처리된다. 디바운싱·복귀 대기는 브리지(펌웨어) 쪽 책임,
전환 중 입력 잠금은 웹앱 쪽 책임으로 이중화한다.

### 상태 메시지 (웹앱/Pi → ESP32 TFT 갱신용)

```json
{ "type": "RADIO_STATE", "state": "TUNING" }
{ "type": "RADIO_STATE", "state": "PLAYING",
  "station": "TANGER FM", "country": "Morocco", "city": "Tangier",
  "frequency": "91.5 MHz", "signal": 4 }
```

(웹앱 `UIController.setRadioState`와 동일한 데이터 — 추후 같은 지점에서 브리지로
송신만 추가하면 된다.)

## 6. 9시간+ 연속 실행 안정성 계획

- **DOM 재사용**: `<video>` 1개, 라디오 `<audio>` 1개, 효과 `<audio>` 1개를 src 교체로만 사용
- **리스너**: 컨트롤러 생성 시 1회 등록. 전환마다 등록하는 리스너는
  `_loadAndSeek`의 3개뿐이며 완료·오류·타임아웃 모든 경로에서 제거
- **타이머**: 페이드 interval은 시작 전 기존 것 clear, watchdog 1개, 신호 애니메이션
  1개(재튜닝 시 교체), 디버그 렌더는 오버레이 표시 중에만
- **메모리**: 미디어는 브라우저 스트리밍에 맡기고 사전 로드하지 않음. Object URL 미사용.
  로그 200줄 상한
- **오류 경로**: play() rejection·error·stalled·metadata 타임아웃 처리,
  파일당 2회 실패 후 건너뜀(무한 재시도 없음), 건너뛴 파일 목록 기록
- **watchdog**: 5초마다 영상·라디오가 의도치 않게 pause 상태면 재생 복구,
  visibilitychange 복귀 시에도 점검
- **검증**: `?endurance=1` 가속 테스트 — 90초/117회 전환에서 힙 2MB, 복구 0회,
  로그 상한 유지, 외부 요청 0건 확인(2026-07 CI 환경)

## 7. Raspberry Pi 부팅·자동 실행·안전 종료 계획

`docs/RASPBERRY_PI.md`에 상세 절차 수록. 요약:

1. 전원 인가 → Pi 부팅 → systemd가 정적 서버 실행 → Chromium 키오스크가
   `http://localhost:8080/?exhibition=1` 자동 접속 → START 자동화(키오스크 플래그
   `--autoplay-policy=no-user-gesture-required` 사용 시 시작 화면 자동 통과 가능)
2. 폐장: 물리 종료 버튼(GPIO) → `shutdown -h now` → LED 소등 후 전원 차단.
   콘센트 뽑기는 비상시에만.
3. 안정화: 서비스 자동 재시작(Restart=always), 화면 절전/블랭킹 해제, 알림 차단,
   커서 숨김, microSD 백업 이미지, OverlayFS 읽기 전용 루트 검토.
4. Pi 3 B V1.2 성능: 1024×600 H.264 1스트림 + MP3 1스트림은 하드웨어 디코딩 범위.
   실측으로 확인 후 보드 교체 여부 판단(선구매 전제하지 않음).
