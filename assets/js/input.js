// ============================================================
// InputController + InputAdapter
//
// 모든 입력 장치는 동일한 명령 집합을 호출한다:
//   prevVideo / nextVideo / prevRadio / nextRadio
//   toggleFullscreen / toggleDebug
//
// 하드웨어 입력이 재생 로직에 직접 결합되지 않도록,
// 어댑터는 명령 이름만 dispatch하고 실제 동작은 AppController가 연결한다.
//
// 어댑터 목록:
//   - DesktopKeyboardAdapter : 방향키 (↑이전영상 ↓다음영상 ←이전라디오 →다음라디오)
//   - ToggleAdapter          : 화면 토글 (실물 ON-OFF-ON 자동복귀 토글 시뮬레이션)
//   - DialAdapter            : 화면 회전 다이얼 (실물 로터리 다이얼 시뮬레이션)
//   - TouchMouseAdapter      : 보조 버튼 (전체화면·디버그)
//   - LocalWebSocketAdapter  : 추후 Raspberry Pi GPIO / ESP32 브리지용
//     (메시지 형식: {"cmd":"NEXT_VIDEO"|"PREVIOUS_VIDEO"|"NEXT_RADIO"|"PREVIOUS_RADIO"})
// ============================================================

const WS_COMMAND_MAP = {
  PREVIOUS_VIDEO: "prevVideo",
  NEXT_VIDEO: "nextVideo",
  PREVIOUS_RADIO: "prevRadio",
  NEXT_RADIO: "nextRadio",
};

export class InputController {
  constructor(diag) {
    this.diag = diag;
    this.handlers = new Map();
    this.adapters = [];
  }

  on(command, handler) { this.handlers.set(command, handler); }

  dispatch(command, source) {
    const handler = this.handlers.get(command);
    if (!handler) return;
    this.diag.lastInput = `${command} (${source})`;
    handler();
  }

  attach(adapter) {
    adapter.connect(this);
    this.adapters.push(adapter);
  }
}

// ---- 키보드 --------------------------------------------------
export class DesktopKeyboardAdapter {
  connect(bus) {
    const keyMap = {
      ArrowUp: "prevVideo",
      ArrowDown: "nextVideo",
      ArrowLeft: "prevRadio",
      ArrowRight: "nextRadio",
      f: "toggleFullscreen",
      F: "toggleFullscreen",
      d: "toggleDebug",
      D: "toggleDebug",
    };
    document.addEventListener("keydown", (e) => {
      if (e.repeat) return; // 키 반복(누르고 있기) 무시 — 토글 디바운싱과 동일한 효과
      const cmd = keyMap[e.key];
      if (!cmd) return;
      e.preventDefault();
      bus.dispatch(cmd, "keyboard");
    });
  }
}

// ---- 영상 토글 (자동 복귀 ON-OFF-ON) ---------------------------
// 실물 토글처럼: 위/아래로 젖히면 1회 입력, 가운데로 복귀하기 전에는
// 같은 입력을 반복 처리하지 않는다.
export class ToggleAdapter {
  constructor(toggleEl, leverEl) {
    this.toggle = toggleEl;
    this.lever = leverEl;
  }
  connect(bus) {
    let engaged = false;   // 복귀 전 재입력 방지
    const press = (e) => {
      if (engaged) return;
      engaged = true;
      const rect = this.toggle.getBoundingClientRect();
      const y = (e.clientY ?? e.touches?.[0]?.clientY) - rect.top;
      const up = y < rect.height / 2;
      this.lever.classList.add(up ? "up" : "down");
      bus.dispatch(up ? "prevVideo" : "nextVideo", "toggle");
    };
    const release = () => {
      if (!engaged) return;
      engaged = false;
      this.lever.classList.remove("up", "down"); // 가운데 복귀
    };
    this.toggle.addEventListener("pointerdown", press);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  }
}

// ---- 라디오 회전 다이얼 ---------------------------------------
// 드래그로 돌리기(30°마다 1스텝), 좌/우 클릭, 마우스 휠을 지원한다.
export class DialAdapter {
  constructor(dialEl, knobEl) {
    this.dial = dialEl;
    this.knob = knobEl;
    this.angle = 0;        // 시각적 누적 회전각
  }
  connect(bus) {
    const STEP_DEG = 30;
    let dragging = false;
    let moved = false;
    let lastPointerAngle = 0;
    let accum = 0;

    const center = () => {
      const r = this.dial.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const pointerAngle = (e) => {
      const c = center();
      return (Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180) / Math.PI;
    };
    const rotate = (deg) => {
      this.angle += deg;
      this.knob.style.transform = `rotate(${this.angle}deg)`;
    };
    const emitSteps = (source) => {
      while (accum >= STEP_DEG) { accum -= STEP_DEG; bus.dispatch("nextRadio", source); }
      while (accum <= -STEP_DEG) { accum += STEP_DEG; bus.dispatch("prevRadio", source); }
    };

    this.dial.addEventListener("pointerdown", (e) => {
      dragging = true; moved = false;
      lastPointerAngle = pointerAngle(e);
      this.dial.setPointerCapture(e.pointerId);
    });
    this.dial.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const a = pointerAngle(e);
      let delta = a - lastPointerAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      lastPointerAngle = a;
      if (Math.abs(delta) > 0.5) moved = true;
      rotate(delta);
      accum += delta;
      emitSteps("dial-drag");
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      accum = 0;
      // 드래그 없이 짧게 탭/클릭 → 좌우 절반으로 이전/다음
      if (!moved) {
        const r = this.dial.getBoundingClientRect();
        const right = e.clientX > r.left + r.width / 2;
        rotate(right ? STEP_DEG : -STEP_DEG);
        bus.dispatch(right ? "nextRadio" : "prevRadio", "dial-click");
      }
    };
    this.dial.addEventListener("pointerup", endDrag);
    this.dial.addEventListener("pointercancel", () => { dragging = false; accum = 0; });

    // 마우스 휠로도 회전
    this.dial.addEventListener("wheel", (e) => {
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      rotate(dir * STEP_DEG);
      bus.dispatch(dir > 0 ? "nextRadio" : "prevRadio", "dial-wheel");
    }, { passive: false });
  }
}

// ---- 보조 버튼 (전체화면·디버그) -------------------------------
export class TouchMouseAdapter {
  constructor(rootEl) { this.root = rootEl; }
  connect(bus) {
    this.root.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-cmd]");
      if (!btn) return;
      bus.dispatch(btn.dataset.cmd, "button");
    });
  }
}

// ---- 로컬 WebSocket (추후 Pi GPIO / ESP32 브리지) --------------
// 데스크탑 MVP에서는 기본 비활성. config.hardwareBridge.enabled=true 이고
// 브리지 프로그램이 로컬에서 돌고 있을 때만 연결을 시도한다.
export class LocalWebSocketAdapter {
  constructor({ url = "ws://localhost:8765", diag }) {
    this.url = url;
    this.diag = diag;
    this.ws = null;
    this._retryTimer = null;
  }
  connect(bus) {
    const open = () => {
      try {
        this.ws = new WebSocket(this.url);
      } catch {
        this._scheduleRetry(open);
        return;
      }
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const cmd = WS_COMMAND_MAP[msg.cmd];
          if (cmd) bus.dispatch(cmd, "hardware");
        } catch {
          this.diag?.log(`bridge 메시지 파싱 실패: ${event.data}`);
        }
      };
      this.ws.onclose = () => this._scheduleRetry(open);
      this.ws.onopen = () => this.diag?.log(`hardware bridge 연결됨: ${this.url}`);
    };
    open();
  }
  _scheduleRetry(open) {
    if (this._retryTimer) clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(open, 5000);
  }
}
