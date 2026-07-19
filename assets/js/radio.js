// ============================================================
// RadioController — 라디오 재생, 무작위 시작점, 튜닝 전환
//
// - 영상과 완전히 독립. 영상 전환은 라디오에 어떤 영향도 주지 않는다.
// - radio.json 배열 순서 원형 순환. 개수는 배열 길이에서만 얻는다.
// - 전환할 때마다 duration 기반의 안전한 무작위 시작점을 새로 계산한다.
// - 파일이 끝나면 다음 라디오로 자동 이동.
// - 강제 자동 전환(45~90초)은 기본 꺼짐 — config.autoRadioSwitch로만 활성화.
// ============================================================

import { sleep, fadeVolume } from "./video.js";

export class RadioController {
  constructor({ audioEl, fxEl, config, library, diag, onStateChange }) {
    this.audio = audioEl;
    this.fx = fxEl;
    this.config = config;
    this.library = library;
    this.diag = diag;
    this.onStateChange = onStateChange;  // UI 갱신 콜백 (state, station)

    this.currentIndex = 0;
    this.switching = false;
    this.lastStartPoint = 0;
    this.failures = new Map();
    this._fadeTimer = null;
    this._autoSwitchTimer = null;
    this._started = false;

    this.audio.volume = config.radioVolume;
    this.fx.volume = Math.min(1, config.radioVolume);

    this.audio.addEventListener("ended", () => {
      this.diag.log(`라디오 파일 종료: #${this.currentIndex} — 다음 라디오로 이동`);
      this.next({ auto: true });
    });
    this.audio.addEventListener("error", () => {
      if (!this._started) return;
      this._onMediaFailure("audio error 이벤트");
    });
    this.audio.addEventListener("stalled", () => this.diag.log("radio stalled"));
  }

  get count() { return this.library.radios.length; }
  get current() { return this.library.radios[this.currentIndex]; }

  async start(initialIndex = 0) {
    this._started = true;
    if (this.count === 0) return;
    this.currentIndex = ((initialIndex % this.count) + this.count) % this.count;
    await this._tuneTo(this.currentIndex, { firstStart: true });
  }

  next(opts = {}) { return this._step(+1, opts); }
  prev(opts = {}) { return this._step(-1, opts); }

  async _step(direction, { auto = false } = {}) {
    if (!this._started || this.count === 0) return;
    if (this.switching) {
      this.diag.log("라디오 전환 중 — 입력 무시");
      return;
    }
    const n = this.count;
    let idx = this.currentIndex;
    for (let step = 0; step < n; step++) {
      idx = (idx + direction + n) % n;
      if (!this._isSkipped(this.library.radios[idx].src)) break;
    }
    await this._tuneTo(idx);
    this.diag.counters.radioSwitches++;
  }

  async _tuneTo(index, { firstStart = false } = {}) {
    this.switching = true;
    try {
      // 1) 기존 라디오 페이드아웃 (~100ms)
      if (!firstStart) {
        await this._fadeVolume(this.audio, 0, this.config.radioFadeMs);
        this.audio.pause();
      }

      // 2) 정보 패널에 TUNING… 표시
      this.onStateChange?.("tuning", null);

      // 3) 튜닝 노이즈 재생 (여러 효과 파일 중 무작위 선택)
      const tuningMs = this._playTuningNoise();

      // 병렬로 새 방송 로드 → 무작위 시작점 계산
      this.currentIndex = index;
      const entry = this.current;
      const loadPromise = this._loadAndSeek(entry);
      await sleep(tuningMs);
      this._stopTuningNoise();

      const ok = await loadPromise;
      if (!ok) {
        this._onMediaFailure("로드 실패");
        return;
      }

      // 4) 새 방송 정보 표시  5) 무작위 위치 재생  6) 페이드인
      this.audio.volume = 0;
      try {
        await this.audio.play();
        this.failures.delete(entry.src);
      } catch (e) {
        this._onMediaFailure(`play() 실패: ${e.message}`);
        return;
      }
      this.onStateChange?.("playing", entry);
      await this._fadeVolume(this.audio, this.config.radioVolume, this.config.radioFadeMs);
      this.diag.log(`라디오 재생: #${this.currentIndex} ${entry.file} @ ${this.lastStartPoint.toFixed(1)}s`);
      this._armAutoSwitch();
    } finally {
      this.switching = false;
    }
  }

  // 새 파일을 로드하고 metadata 기반 무작위 시작점으로 이동
  _loadAndSeek(entry) {
    return new Promise((resolve) => {
      const audio = this.audio;
      const cleanup = () => {
        audio.removeEventListener("loadedmetadata", onMeta);
        audio.removeEventListener("error", onErr);
        clearTimeout(guard);
      };
      const onMeta = () => {
        cleanup();
        this.lastStartPoint = this._pickStartPoint(audio.duration);
        try { audio.currentTime = this.lastStartPoint; } catch { this.lastStartPoint = 0; }
        resolve(true);
      };
      const onErr = () => { cleanup(); resolve(false); };
      const guard = setTimeout(() => { cleanup(); resolve(false); }, 8000); // metadata 로딩 실패 대비
      audio.addEventListener("loadedmetadata", onMeta);
      audio.addEventListener("error", onErr);
      audio.src = entry.src;
      audio.load();
    });
  }

  // 무작위 시작점: 끝부분이 걸려 바로 종료되지 않게 최소 잔여 시간을 확보
  _pickStartPoint(duration) {
    if (!Number.isFinite(duration) || Number.isNaN(duration) || duration <= 0) return 0;
    const safeMax = duration - this.config.radioMinRemainingSec;
    if (safeMax <= 0) return 0;   // duration이 최소 잔여 시간보다 짧으면 처음부터
    return Math.random() * safeMax;
  }

  _playTuningNoise() {
    const [minMs, maxMs] = this.config.tuningDurationMs;
    const ms = Math.round(minMs + Math.random() * Math.max(0, maxMs - minMs));
    const effects = this.library.effects;
    if (effects.length > 0) {
      const src = effects[Math.floor(Math.random() * effects.length)];
      this.fx.src = src;
      this.fx.currentTime = 0;
      this.fx.play().catch((e) => this.diag.log(`튜닝 효과 재생 실패: ${e.message}`));
    }
    return ms;
  }

  _stopTuningNoise() {
    if (!this.fx.paused) this.fx.pause();
  }

  _isSkipped(src) {
    return (this.failures.get(src) ?? 0) >= this.config.mediaFailureLimit;
  }

  _onMediaFailure(reason) {
    const entry = this.current;
    if (!entry) return;
    const fails = (this.failures.get(entry.src) ?? 0) + 1;
    this.failures.set(entry.src, fails);
    if (fails >= this.config.mediaFailureLimit) this.diag.markSkipped(entry.file, reason);
    else this.diag.error(`라디오 오류(${fails}/${this.config.mediaFailureLimit}): ${entry.file} — ${reason}`);

    this.onStateChange?.("error", entry);
    const allDead = this.library.radios.every((r) => this._isSkipped(r.src));
    if (allDead) {
      this.diag.error("재생 가능한 라디오가 없습니다.");
      return;
    }
    // 전환 흐름 밖에서 재시도 (무한 루프 방지: switching 해제 후 한 번만)
    setTimeout(() => { if (!this.switching) this.next({ auto: true }); }, 500);
  }

  // 선택 기능: 강제 자동 전환 (기본 꺼짐)
  _armAutoSwitch() {
    this._clearAutoSwitch();
    const cfg = this.config.autoRadioSwitch;
    if (!cfg.enabled) return;
    const sec = cfg.minSec + Math.random() * Math.max(0, cfg.maxSec - cfg.minSec);
    this._autoSwitchTimer = setTimeout(() => this.next({ auto: true }), sec * 1000);
  }

  _clearAutoSwitch() {
    if (this._autoSwitchTimer) { clearTimeout(this._autoSwitchTimer); this._autoSwitchTimer = null; }
  }

  // watchdog에서 호출
  checkAlive() {
    if (!this._started || this.switching || this.count === 0) return;
    const a = this.audio;
    if (a.paused && !a.ended) {
      this.diag.counters.recoveries++;
      this.diag.log("watchdog: 라디오가 멈춰 있어 재생을 복구합니다.");
      a.play().catch(() => this._onMediaFailure("watchdog 복구 실패"));
    }
  }

  _fadeVolume(el, target, ms) {
    if (this._fadeTimer) { clearInterval(this._fadeTimer); this._fadeTimer = null; }
    return fadeVolume(el, target, ms, (t) => { this._fadeTimer = t; });
  }
}
