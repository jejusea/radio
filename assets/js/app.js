// ============================================================
// AppController — 전체 상태, 시작·정지, 모듈 연결
// ============================================================

import { loadConfig } from "./config.js";
import { Diagnostics } from "./diagnostics.js";
import { MediaLibrary } from "./library.js";
import { VideoController } from "./video.js";
import { RadioController } from "./radio.js";
import { UIController } from "./ui.js";
import {
  InputController,
  DesktopKeyboardAdapter,
  ToggleAdapter,
  DialAdapter,
  TouchMouseAdapter,
  LocalWebSocketAdapter,
} from "./input.js";

class AppController {
  constructor() {
    this.started = false;
    this.wakeLock = null;
    this._enduranceTimers = [];
  }

  async boot() {
    this.diag = new Diagnostics();
    this.config = await loadConfig(this.diag);
    this.diag.maxEntries = this.config.maxLogEntries;
    this.diag.debugEnabled = this.config.debug;

    this.ui = new UIController({ config: this.config, diag: this.diag });
    this.library = new MediaLibrary(this.diag);

    try {
      await this.library.load();
    } catch (e) {
      this.ui.showStartError(e.message);
      this.diag.error(e.message);
      return;
    }

    if (this.library.videos.length === 0 && this.library.radios.length === 0) {
      this.ui.showStartError("videos.json / radio.json에 재생할 항목이 없습니다.");
      return;
    }

    this.videoCtl = new VideoController({
      videoEl: document.getElementById("video-player"),
      whiteFlashEl: document.getElementById("white-flash"),
      config: this.config,
      library: this.library,
      diag: this.diag,
      onVideoChange: (entry, index, count) => this.ui.setVideoInfo(entry, index, count),
    });

    this.radioCtl = new RadioController({
      audioEl: document.getElementById("radio-player"),
      fxEl: document.getElementById("fx-player"),
      config: this.config,
      library: this.library,
      diag: this.diag,
      onStateChange: (state, station) => this.ui.setRadioState(state, station),
    });

    this._setupInput();

    // 시작 버튼: 브라우저 자동재생 정책 준수 — 최초 사용자 입력에서 미디어 시작
    document.getElementById("start-button").addEventListener("click", () => {
      this.start().catch((e) => {
        this.diag.error(`시작 실패: ${e.message}`);
        this.ui.showStartError(`시작 실패: ${e.message}`);
      });
    });

    this.diag.log("boot 완료 — 시작 대기");
  }

  _setupInput() {
    const input = new InputController(this.diag);
    this.input = input;

    // 명령 → 동작 연결 (어댑터는 재생 로직을 직접 알지 못한다)
    input.on("prevVideo", () => this.started && this.videoCtl.prev());
    input.on("nextVideo", () => this.started && this.videoCtl.next());
    input.on("prevRadio", () => this.started && this.radioCtl.prev());
    input.on("nextRadio", () => this.started && this.radioCtl.next());
    input.on("toggleFullscreen", () => this.ui.toggleFullscreen());
    input.on("toggleDebug", () => this.ui.toggleDebug(() => this._statusText()));

    input.attach(new DesktopKeyboardAdapter());
    input.attach(new ToggleAdapter(
      document.getElementById("toggle"),
      document.getElementById("toggle-lever"),
    ));
    input.attach(new DialAdapter(
      document.getElementById("dial"),
      document.getElementById("dial-knob"),
    ));
    input.attach(new TouchMouseAdapter(document.getElementById("controls")));

    // 추후 하드웨어 브리지 (기본 비활성)
    if (this.config.hardwareBridge?.enabled) {
      input.attach(new LocalWebSocketAdapter({
        url: this.config.hardwareBridge.url,
        diag: this.diag,
      }));
    }
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.ui.markRunning();

    let initialVideo = 0;
    if (this.config.restoreLastVideo) {
      try {
        const saved = parseInt(localStorage.getItem("lastVideoIndex") ?? "0", 10);
        if (Number.isFinite(saved)) initialVideo = saved;
      } catch {}
    }

    // 영상과 라디오는 서로 독립적으로 시작·진행된다.
    await Promise.all([
      this.library.videos.length ? this.videoCtl.start(initialVideo) : Promise.resolve(),
      this.library.radios.length ? this.radioCtl.start(0) : Promise.resolve(),
    ]);

    this._requestWakeLock();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this._requestWakeLock();
        // 탭 복귀 시 재생 상태 점검
        this.videoCtl.checkAlive();
        this.radioCtl.checkAlive();
      }
    });

    // 경량 watchdog: 영상·라디오가 예기치 않게 멈추면 복구
    this.diag.startWatchdog(this.config.watchdogIntervalMs, [
      () => this.videoCtl.checkAlive(),
      () => this.radioCtl.checkAlive(),
    ]);

    if (this.config.debug) this.ui.toggleDebug(() => this._statusText());
    if (this.config.enduranceTest.enabled) this._startEnduranceTest();

    this.diag.log("작품 재생 시작");
  }

  // Wake Lock: 지원하면 사용, 지원하지 않아도 앱은 계속 작동
  async _requestWakeLock() {
    if (!this.config.useWakeLock || !("wakeLock" in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request("screen");
      this.wakeLock.addEventListener("release", () => this.diag.log("Wake Lock 해제됨"));
      this.diag.log("Wake Lock 획득");
    } catch (e) {
      this.diag.log(`Wake Lock 실패(무시): ${e.message}`);
    }
  }

  // 가속 내구 테스트 (개발 전용, 전시 모드에서는 config에서 강제 차단됨)
  _startEnduranceTest() {
    const { videoIntervalMs, radioIntervalMs } = this.config.enduranceTest;
    this.diag.log(`endurance test 시작: video ${videoIntervalMs}ms / radio ${radioIntervalMs}ms`);
    this._enduranceTimers.push(setInterval(() => this.videoCtl.next({ auto: true }), videoIntervalMs));
    this._enduranceTimers.push(setInterval(() => this.radioCtl.next({ auto: true }), radioIntervalMs));
  }

  _statusText() {
    const v = this.videoCtl?.video;
    const a = this.radioCtl?.audio;
    const fmt = (t) => (Number.isFinite(t) ? t.toFixed(1) : "—");
    const c = this.diag.counters;
    return [
      `MODE      ${this.config.exhibitionMode ? "exhibition" : "dev"}${this.config.enduranceTest.enabled ? " +endurance" : ""}`,
      `VIDEO     ${this.videoCtl?.currentIndex + 1}/${this.videoCtl?.count}  ${this.videoCtl?.current?.file ?? "—"}`,
      `          t=${fmt(v?.currentTime)}/${fmt(v?.duration)}  vol=${v?.volume?.toFixed(2)}  ${v?.paused ? "PAUSED" : "playing"}`,
      `RADIO     ${this.radioCtl?.currentIndex + 1}/${this.radioCtl?.count}  ${this.radioCtl?.current?.file ?? "—"}`,
      `          t=${fmt(a?.currentTime)}/${fmt(a?.duration)}  vol=${a?.volume?.toFixed(2)}  start=${fmt(this.radioCtl?.lastStartPoint)}s  ${a?.paused ? "PAUSED" : "playing"}`,
      `SWITCHES  video=${c.videoSwitches}  radio=${c.radioSwitches}  recoveries=${c.recoveries}`,
      `FS/LOCK   fullscreen=${!!document.fullscreenElement}  wakeLock=${this.wakeLock && !this.wakeLock.released ? "on" : "off"}  watchdog=${this.diag.watchdogRunning ? "on" : "off"}`,
      `INPUT     ${this.diag.lastInput}`,
      `SKIPPED   ${this.diag.skippedFiles.map((s) => s.file).join(", ") || "—"}`,
      `--- 최근 로그 ---`,
      ...this.diag.logs.slice(-8),
    ].join("\n");
  }
}

const app = new AppController();
app.boot();
// 개발 콘솔에서 접근할 수 있게 노출 (전역 상태 오염 아님 — 단일 진입점)
window.__app = app;
