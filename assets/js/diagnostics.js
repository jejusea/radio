// ============================================================
// Diagnostics — 로그 링버퍼, 오류 기록, 경량 watchdog
// 로그는 maxLogEntries 개수까지만 유지해 장시간 실행 시 누적을 막는다.
// ============================================================

export class Diagnostics {
  constructor(maxEntries = 200) {
    this.maxEntries = maxEntries;
    this.logs = [];
    this.skippedFiles = [];       // { file, reason }
    this.lastInput = "—";
    this.counters = { videoSwitches: 0, radioSwitches: 0, recoveries: 0 };
    this._watchdogTimer = null;
  }

  log(message) {
    const line = `${new Date().toLocaleTimeString("en-GB")} ${message}`;
    this.logs.push(line);
    if (this.logs.length > this.maxEntries) this.logs.splice(0, this.logs.length - this.maxEntries);
    if (this.debugEnabled) console.log(`[app] ${message}`);
  }

  error(message) {
    this.log(`ERROR: ${message}`);
    console.error(`[app] ${message}`);
  }

  markSkipped(file, reason) {
    if (!this.skippedFiles.some((s) => s.file === file)) {
      this.skippedFiles.push({ file, reason });
    }
    this.error(`파일 건너뜀: ${file} (${reason})`);
  }

  // ---- watchdog ------------------------------------------------
  // 등록된 검사 함수를 주기적으로 호출한다. 검사 함수는 스스로 복구를 시도한다.
  startWatchdog(intervalMs, checks) {
    this.stopWatchdog();
    this._watchdogTimer = setInterval(() => {
      for (const check of checks) {
        try { check(); } catch (e) { this.error(`watchdog 검사 실패: ${e.message}`); }
      }
    }, intervalMs);
  }

  stopWatchdog() {
    if (this._watchdogTimer) { clearInterval(this._watchdogTimer); this._watchdogTimer = null; }
  }

  get watchdogRunning() { return this._watchdogTimer !== null; }
}
