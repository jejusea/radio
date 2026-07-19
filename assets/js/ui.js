// ============================================================
// UIController — 화면 상태, 라디오 정보 패널, 커서 숨김, 전체화면
// ============================================================

export class UIController {
  constructor({ config, diag }) {
    this.config = config;
    this.diag = diag;
    this.app = document.getElementById("app");
    this.el = {
      station: document.getElementById("radio-station"),
      frequency: document.getElementById("radio-frequency"),
      country: document.getElementById("radio-country"),
      city: document.getElementById("radio-city"),
      signal: document.getElementById("radio-signal"),
      tuning: document.getElementById("radio-tuning"),
      lamp: document.getElementById("radio-lamp"),
      videoLabel: document.getElementById("video-label"),
      controls: document.getElementById("controls"),
      debug: document.getElementById("debug-overlay"),
      startScreen: document.getElementById("start-screen"),
      startError: document.getElementById("start-error"),
      fatal: document.getElementById("fatal-screen"),
      fatalDetail: document.getElementById("fatal-detail"),
    };
    this._cursorTimer = null;
    this._debugTimer = null;
    this._signalTimer = null;
    this.debugVisible = false;

    if (config.exhibitionMode) this.app.classList.add("exhibition");
    if (!config.showControls) this.el.controls.style.display = "none";

    // 불필요한 브라우저 동작 차단
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("dragstart", (e) => e.preventDefault());
    document.addEventListener("selectstart", (e) => e.preventDefault());

    this._setupCursorHiding();
  }

  // ---- 시작/실행 상태 ------------------------------------------
  markRunning() {
    this.app.classList.remove("state-standby");
    this.app.classList.add("state-running");
  }

  showStartError(message) {
    this.el.startError.textContent = message;
  }

  showFatal(message) {
    this.el.fatal.hidden = false;
    this.el.fatalDetail.textContent = message;
  }

  // ---- 라디오 정보 패널 ----------------------------------------
  // state: "tuning" | "playing" | "error"
  setRadioState(state, station) {
    const { tuning, lamp } = this.el;
    if (state === "tuning") {
      tuning.classList.add("on");
      lamp.classList.remove("on");
      this._stopSignalAnimation();
      return;
    }
    tuning.classList.remove("on");
    if (state === "playing" && station) {
      this.el.station.textContent = station.station;
      this.el.frequency.textContent = station.frequency ?? station.type ?? "";
      this.el.country.textContent = station.country;
      this.el.city.textContent = station.city;
      lamp.classList.add("on");
      this._startSignalAnimation(station);
    } else if (state === "error") {
      lamp.classList.remove("on");
    }
  }

  // ---- video info 바 -------------------------------------------
  setVideoInfo(entry, index, count) {
    if (!entry) { this.el.videoLabel.textContent = "—"; return; }
    const label = entry.title ?? entry.label ?? `SCENE ${index + 1}`;
    this.el.videoLabel.textContent = `${label}  ·  ${index + 1}/${count}`;
  }

  // 간단한 신호 상태: 방송국 id 기반 기본 세기 + 느린 흔들림
  _startSignalAnimation(station) {
    this._stopSignalAnimation();
    const bars = this.el.signal.querySelectorAll("i");
    const hash = String(station.id).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const base = 3 + (hash % 3); // 3~5칸
    const render = () => {
      const level = Math.max(2, Math.min(5, base + (Math.random() < 0.25 ? -1 : 0)));
      bars.forEach((b, i) => b.classList.toggle("on", i < level));
    };
    render();
    this._signalTimer = setInterval(render, 1800);
  }

  _stopSignalAnimation() {
    if (this._signalTimer) { clearInterval(this._signalTimer); this._signalTimer = null; }
  }

  // ---- 커서 숨김 -----------------------------------------------
  _setupCursorHiding() {
    const reset = () => {
      this.app.classList.remove("hide-cursor");
      if (this._cursorTimer) clearTimeout(this._cursorTimer);
      this._cursorTimer = setTimeout(
        () => this.app.classList.add("hide-cursor"),
        this.config.cursorHideMs
      );
    };
    document.addEventListener("mousemove", reset, { passive: true });
    document.addEventListener("mousedown", reset, { passive: true });
    reset();
  }

  // ---- 전체화면 ------------------------------------------------
  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (e) {
      this.diag.log(`전체화면 전환 실패: ${e.message}`);
    }
  }

  // ---- 디버그 오버레이 -----------------------------------------
  toggleDebug(getStatusText) {
    if (this.config.exhibitionMode) return; // 전시 모드에서는 완전히 숨김
    this.debugVisible = !this.debugVisible;
    this.el.debug.hidden = !this.debugVisible;
    if (this._debugTimer) { clearInterval(this._debugTimer); this._debugTimer = null; }
    if (this.debugVisible) {
      const render = () => { this.el.debug.textContent = getStatusText(); };
      render();
      this._debugTimer = setInterval(render, 500);
    }
  }
}
