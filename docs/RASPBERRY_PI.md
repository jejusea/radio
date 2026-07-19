# Raspberry Pi 운영 계획 (최종 전시)

대상: Raspberry Pi 3 Model B V1.2 · Raspberry Pi OS (32-bit, Lite 또는 Desktop)
· 1024×600 HDMI · Chromium 키오스크.

## 1. 개장(부팅) 흐름

1. 전원 공급 → Pi 부팅
2. systemd가 로컬 정적 서버 자동 시작
3. Chromium 키오스크 모드 자동 실행 → `http://localhost:8080/?exhibition=1`
4. 부팅 중 화면은 검은 배경(플리커 없음), 앱 진입 후 작품 시작
5. 자동재생: 키오스크 Chromium은 `--autoplay-policy=no-user-gesture-required`로
   실행해 START 화면 없이 바로 시작하거나, 브리지가 시작 신호를 보낸다

### 정적 서버 서비스 (`/etc/systemd/system/radio-server.service`)

```ini
[Unit]
Description=Exhibition static server
After=network.target

[Service]
WorkingDirectory=/home/pi/radio
ExecStart=/usr/bin/node tools/serve.mjs 8080
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

### 키오스크 서비스 (`/etc/systemd/system/radio-kiosk.service`)

```ini
[Unit]
Description=Exhibition kiosk
After=graphical.target radio-server.service

[Service]
User=pi
Environment=DISPLAY=:0
ExecStartPre=/bin/sh -c 'until curl -s http://localhost:8080 >/dev/null; do sleep 1; done'
ExecStart=/usr/bin/chromium-browser --kiosk --noerrdialogs --disable-infobars \
  --autoplay-policy=no-user-gesture-required --check-for-update-interval=31536000 \
  --overscroll-history-navigation=0 --disable-pinch \
  http://localhost:8080/?exhibition=1
Restart=always
RestartSec=3

[Install]
WantedBy=graphical.target
```

활성화: `sudo systemctl enable radio-server radio-kiosk`

Chromium이나 웹앱이 죽으면 systemd `Restart=always`가 자동 재시작한다.
웹앱 내부에서는 watchdog이 재생 정지를 복구한다.

## 2. 화면 절전·알림 차단

```bash
# 화면 블랭킹/절전 해제 (X11)
xset s off; xset -dpms; xset s noblank
# 또는 raspi-config → Display → Screen Blanking → Off
```

- 커서 숨김: 앱이 자체적으로 숨기지만 `unclutter -idle 1` 병행 가능
- OS 업데이트 팝업: Lite 이미지 사용 또는 `sudo systemctl disable apt-daily.timer apt-daily-upgrade.timer`
- 불필요한 알림/스크린세이버 패키지 제거

## 3. 폐장(종료) 흐름

**콘센트를 바로 뽑지 않는다** (SD 카드 손상 위험).

1. 물리 종료 버튼(GPIO) 또는 SSH에서 `sudo shutdown -h now`
2. 활동 LED가 완전히 꺼진 뒤(약 10초) 전원 차단

종료 버튼 예 (GPIO3 — 부팅 전 누르면 부팅도 됨):

```
# /boot/firmware/config.txt
dtoverlay=gpio-shutdown,gpio_pin=3
```

## 4. 하드웨어 입력 브리지

### 방식 A — Pi GPIO + Python 브리지

- ON-OFF-ON 토글: GPIO 2핀 (위/아래), 공통 GND, 내부 풀업
- 회전 다이얼(로터리 엔코더): GPIO 2핀 (A/B 상)
- Python(gpiozero) 프로그램이 디바운싱 후 로컬 WebSocket 서버(`ws://localhost:8765`)로
  `{"cmd":"NEXT_VIDEO"}` 등 전송
- 웹앱: `data/config.json`에서 `"hardwareBridge": { "enabled": true }` 로 수신 활성화
- 브리지도 systemd 서비스로 자동 실행

### 방식 B — ESP32-C3 + TFT

- ESP32-C3가 회전 다이얼과 라디오 정보 TFT를 담당
- USB Serial 또는 WebSocket으로 Pi와 통신, 메시지 형식은 `docs/DESIGN.md` 5장 고정
- Pi는 현재 방송 정보(`RADIO_STATE`)를 ESP32로 전달해 TFT 갱신

부품 확정 후 브리지 구현. 웹앱 쪽은 `LocalWebSocketAdapter`가 이미 준비되어 있어
코어 수정이 필요 없다.

## 5. 오디오 출력

- 기본: HDMI 또는 3.5mm 단일 출력에 영상음+라디오음 혼합 (현 데스크탑과 동일)
- 분리 필요 시: USB 오디오 어댑터 추가 → 라디오 `<audio>`에 `setSinkId()`로
  다른 출력 장치 지정 (Chromium 지원). 오디오 로직이 요소별로 분리되어 있어
  코어 변경 없이 적용 가능.

## 6. 성능 검증 (Pi 3 B V1.2)

새 보드 구매를 전제하지 않는다. 실측 순서:

1. 실제 전시 파일 인코딩: **H.264 (High까지 가능, 권장 Main), 640×480(4:3), 24~30fps,
   3~5Mbps, AAC** — Pi 3의 하드웨어 H.264 디코더 범위
2. placeholder(VP9)는 소프트웨어 디코딩이라 Pi 테스트에 쓰지 말 것
3. 키오스크로 9시간 연속 실행, `vcgencmd measure_temp`로 온도(방열판·통풍 확보),
   프레임 드랍 여부 확인
4. 부족할 때만 해상도/비트레이트 조정 → 그래도 부족하면 보드 업그레이드 검토

## 7. 백업·복구

- 완성 후 microSD 전체 이미지 백업 (`Win32DiskImager` 또는 `dd`), 예비 SD 1장 상시 휴대
- 정전 대비: OverlayFS 읽기 전용 루트(raspi-config → Performance → Overlay File System)
  적용 검토 — 적용 시 미디어 교체는 오버레이 해제 후 수행
- 재부팅 = 자동 복구: 모든 서비스가 enable 상태이므로 전원만 다시 넣으면 작품 복귀
