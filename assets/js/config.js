// ============================================================
// Config — 조정 가능한 설정값
// 기본값 위에 data/config.json 을 덮어쓰고, 마지막으로 URL 파라미터를 적용한다.
//   ?exhibition=1  전시 모드 (컨트롤·디버그 숨김)
//   ?debug=1       디버그 오버레이 켠 상태로 시작
//   ?endurance=1   가속 내구 테스트 (전시 모드에서는 무시됨)
// ============================================================

export const DEFAULT_CONFIG = {
  // 영상
  videoTransitionMs: 300,      // 흰 화면 + 무음 지속 시간
  videoAudioFadeMs: 80,        // 클릭 노이즈 방지용 오디오 페이드
  videoVolume: 1.0,

  // 라디오
  radioVolume: 0.8,
  radioFadeMs: 100,
  tuningDurationMs: [500, 800],   // 튜닝 노이즈 재생 구간 (효과음이 더 길면 잘라냄)
  radioMinRemainingSec: 20,       // 무작위 시작점이 보장해야 할 최소 잔여 재생 시간
  autoRadioSwitch: {              // 선택 기능: 무입력 시 강제 라디오 전환 (기본 꺼짐)
    enabled: false,
    minSec: 45,
    maxSec: 90,
  },

  // 화면
  showControls: true,          // 화면 컨트롤 버튼 표시 (전시 모드에서는 항상 숨김)
  exhibitionMode: false,
  debug: false,
  cursorHideMs: 3000,
  useWakeLock: true,
  restoreLastVideo: false,     // 마지막 영상 인덱스 복원 (localStorage)

  // 안정성
  watchdogIntervalMs: 5000,
  maxLogEntries: 200,
  mediaFailureLimit: 2,        // 이 횟수만큼 실패한 파일은 세션 동안 건너뜀

  // 가속 내구 테스트 (개발 전용)
  enduranceTest: {
    enabled: false,
    videoIntervalMs: 1200,
    radioIntervalMs: 2000,
  },
};

function deepMerge(base, over) {
  const out = { ...base };
  for (const key of Object.keys(over ?? {})) {
    const b = base?.[key];
    const o = over[key];
    if (b && o && typeof b === "object" && typeof o === "object" && !Array.isArray(b) && !Array.isArray(o)) {
      out[key] = deepMerge(b, o);
    } else if (o !== undefined) {
      out[key] = o;
    }
  }
  return out;
}

export async function loadConfig(diag) {
  let fileConfig = {};
  try {
    // 캐시 때문에 수정된 설정이 반영되지 않는 문제를 피하기 위해 쿼리를 붙인다.
    const res = await fetch(`data/config.json?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      const text = await res.text();
      try {
        fileConfig = JSON.parse(text);
      } catch (e) {
        diag?.error(`config.json JSON 문법 오류: ${e.message} — 기본 설정으로 실행합니다.`);
      }
    } else if (res.status !== 404) {
      diag?.error(`config.json 로드 실패 (HTTP ${res.status}) — 기본 설정으로 실행합니다.`);
    }
  } catch (e) {
    diag?.error(`config.json 로드 실패: ${e.message} — 기본 설정으로 실행합니다.`);
  }

  let config = deepMerge(DEFAULT_CONFIG, fileConfig);

  const params = new URLSearchParams(location.search);
  const flag = (name) => ["1", "true", "yes"].includes((params.get(name) ?? "").toLowerCase());
  if (params.has("exhibition")) config.exhibitionMode = flag("exhibition");
  if (params.has("debug")) config.debug = flag("debug");
  if (params.has("endurance")) config.enduranceTest = { ...config.enduranceTest, enabled: flag("endurance") };

  // 전시 모드에서는 테스트·개발 설정을 강제로 끈다.
  if (config.exhibitionMode) {
    config.enduranceTest = { ...config.enduranceTest, enabled: false };
    config.showControls = false;
    config.debug = false;
  }
  return config;
}
