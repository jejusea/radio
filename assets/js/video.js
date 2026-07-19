// ============================================================
// VideoController — 영상 재생, 원형 순환, 흰색 전환
//
// - videos 배열 순서 고정 원형 순환. 개수는 배열 길이에서만 얻는다.
// - 입력 전환과 자연 종료 모두 동일한 전환 효과 사용.
// - 전환 중 중복 입력 무시(잠금). <video> 요소는 하나를 재사용한다.
// - 라디오와 완전히 독립: 이 모듈은 라디오 상태를 알지 못한다.
// ============================================================

export class VideoController {
  constructor({ videoEl, whiteFlashEl, config, library, diag, onVideoChange }) {
    this.video = videoEl;
    this.whiteFlash = whiteFlashEl;
    this.config = config;
    this.library = library;
    this.diag = diag;
    this.onVideoChange = onVideoChange;  // video info 바 갱신 콜백

    this.currentIndex = 0;
    this.transitioning = false;
    this.failures = new Map();     // src -> 실패 횟수
    this._fadeTimer = null;
    this._started = false;

    this.video.volume = config.videoVolume;

    // 리스너는 생성 시 한 번만 등록 (중복 등록 방지)
    this.video.addEventListener("ended", () => {
      this.diag.log(`영상 자연 종료: #${this.currentIndex}`);
      this.next({ auto: true });
    });
    this.video.addEventListener("error", () => {
      if (!this._started) return;
      this._onMediaFailure("video error 이벤트");
    });
    this.video.addEventListener("stalled", () => this.diag.log("video stalled"));
    this.video.addEventListener("waiting", () => this.diag.log("video waiting"));
  }

  get count() { return this.library.videos.length; }
  get current() { return this.library.videos[this.currentIndex]; }

  async start(initialIndex = 0) {
    this._started = true;
    this.currentIndex = ((initialIndex % this.count) + this.count) % this.count;
    await this._playCurrent();
  }

  next(opts = {}) { return this._step(+1, opts); }
  prev(opts = {}) { return this._step(-1, opts); }

  async _step(direction, { auto = false } = {}) {
    if (!this._started || this.count === 0) return;
    if (this.transitioning) {
      this.diag.log("영상 전환 중 — 입력 무시");
      return;
    }
    this.transitioning = true;
    try {
      // 1) 오디오 짧은 페이드아웃 (클릭 노이즈 방지)
      await this._fadeVolume(this.video, 0, this.config.videoAudioFadeMs);
      this.video.pause();

      // 2) 흰 화면 + 완전한 무음
      this.whiteFlash.classList.add("on");
      await sleep(this.config.videoTransitionMs);

      // 3) 다음/이전 영상을 처음부터 재생 (건너뛸 파일은 제외)
      this.currentIndex = this._nextPlayableIndex(direction);
      await this._playCurrent();
      this.diag.counters.videoSwitches++;
    } finally {
      this.transitioning = false;
    }
  }

  _nextPlayableIndex(direction) {
    const n = this.count;
    let idx = this.currentIndex;
    for (let step = 0; step < n; step++) {
      idx = (idx + direction + n) % n;
      if (!this._isSkipped(this.library.videos[idx].src)) return idx;
    }
    return (this.currentIndex + direction + n) % n; // 전부 실패면 그래도 진행
  }

  _isSkipped(src) {
    return (this.failures.get(src) ?? 0) >= this.config.mediaFailureLimit;
  }

  async _playCurrent() {
    const entry = this.current;
    if (!entry) return;
    this.diag.log(`영상 재생: #${this.currentIndex} ${entry.file}`);
    this.onVideoChange?.(entry, this.currentIndex, this.count);

    this.video.volume = 0;
    // src 교체 + load()로 이전 리소스를 해제하며 요소를 재사용한다.
    if (!this.video.src.endsWith(entry.src)) {
      this.video.src = entry.src;
      this.video.load();
    }
    this.video.currentTime = 0;

    try {
      await this.video.play();          // play() Promise rejection 처리
      this.failures.delete(entry.src);
      this.whiteFlash.classList.remove("on");
      await this._fadeVolume(this.video, this.config.videoVolume, this.config.videoAudioFadeMs);
      if (this.config.restoreLastVideo) {
        try { localStorage.setItem("lastVideoIndex", String(this.currentIndex)); } catch {}
      }
    } catch (e) {
      this._onMediaFailure(`play() 실패: ${e.message}`);
    }
  }

  // 파일 오류: 무한 재시도하지 않고 기록 후 다음 파일로 이동
  _onMediaFailure(reason) {
    const entry = this.current;
    if (!entry) return;
    const fails = (this.failures.get(entry.src) ?? 0) + 1;
    this.failures.set(entry.src, fails);
    if (fails >= this.config.mediaFailureLimit) this.diag.markSkipped(entry.file, reason);
    else this.diag.error(`영상 오류(${fails}/${this.config.mediaFailureLimit}): ${entry.file} — ${reason}`);

    if (this.transitioning) return; // 전환 흐름 안에서는 그 흐름이 마무리한다.
    const allDead = this.library.videos.every((v) => this._isSkipped(v.src));
    if (allDead) {
      this.diag.error("재생 가능한 영상이 없습니다.");
      return;
    }
    this.next({ auto: true });
  }

  // watchdog에서 호출: 멈춰 있으면 복구
  checkAlive() {
    if (!this._started || this.transitioning || this.count === 0) return;
    const v = this.video;
    if (v.paused && !v.ended) {
      this.diag.counters.recoveries++;
      this.diag.log("watchdog: 영상이 멈춰 있어 재생을 복구합니다.");
      v.play().catch(() => this._onMediaFailure("watchdog 복구 실패"));
    }
  }

  _fadeVolume(el, target, ms) {
    if (this._fadeTimer) { clearInterval(this._fadeTimer); this._fadeTimer = null; }
    return fadeVolume(el, target, ms, (t) => { this._fadeTimer = t; });
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 공용 볼륨 페이드. 타이머는 완료/교체 시 반드시 정리한다.
export function fadeVolume(el, target, ms, registerTimer) {
  return new Promise((resolve) => {
    const stepMs = 16;
    const steps = Math.max(1, Math.round(ms / stepMs));
    const from = el.volume;
    let i = 0;
    const timer = setInterval(() => {
      i++;
      el.volume = Math.min(1, Math.max(0, from + (target - from) * (i / steps)));
      if (i >= steps) { clearInterval(timer); resolve(); }
    }, stepMs);
    registerTimer?.(timer);
  });
}
