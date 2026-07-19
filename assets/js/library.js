// ============================================================
// MediaLibrary — manifest(videos.json / radio.json) 로딩과 검증
//
// 재생 코드는 배열 길이만 사용한다. 개수를 어디에도 하드코딩하지 않는다.
// 항목 개수 변경 = 파일 추가/제거 + manifest 수정 + 새로고침.
// ============================================================

const VIDEO_REQUIRED = ["id", "file"];
const RADIO_REQUIRED = ["id", "file", "country", "city", "station"];

async function fetchJson(path, diag) {
  // 캐시 무효화: manifest 수정이 즉시 반영되게 한다.
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} 로드 실패 (HTTP ${res.status})`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    // JSON 문법 오류를 이해하기 쉽게 전달
    throw new Error(`${path} JSON 문법 오류: ${e.message}\n쉼표 누락/초과, 따옴표, 괄호를 확인하세요.`);
  }
}

function validateEntries(entries, required, manifestName, diag) {
  if (!Array.isArray(entries)) {
    throw new Error(`${manifestName}의 최상위는 배열이어야 합니다.`);
  }
  const valid = [];
  entries.forEach((entry, i) => {
    const missing = required.filter((k) => entry?.[k] === undefined || entry[k] === "");
    if (missing.length) {
      diag.error(`${manifestName}[${i}] 필수 항목 누락 (${missing.join(", ")}) — 이 항목은 제외합니다.`);
      return;
    }
    valid.push(entry);
  });
  return valid;
}

export class MediaLibrary {
  constructor(diag) {
    this.diag = diag;
    this.videos = [];
    this.radios = [];
    this.effects = [];
  }

  async load() {
    const [videosRaw, radioRaw] = await Promise.all([
      fetchJson("data/videos.json", this.diag),
      fetchJson("data/radio.json", this.diag),
    ]);

    this.videos = validateEntries(videosRaw, VIDEO_REQUIRED, "videos.json", this.diag)
      .map((v) => ({ ...v, src: `media/videos/${encodeURIComponent(v.file)}` }));

    // radio.json은 배열 또는 { stations: [...], effects: [...] } 형태를 허용
    const stations = Array.isArray(radioRaw) ? radioRaw : radioRaw?.stations;
    this.radios = validateEntries(stations ?? [], RADIO_REQUIRED, "radio.json", this.diag)
      .map((r) => ({ ...r, src: `media/radio/${encodeURIComponent(r.file)}` }));

    const effects = Array.isArray(radioRaw) ? [] : radioRaw?.effects;
    this.effects = (effects ?? []).map((f) => `media/effects/${encodeURIComponent(f)}`);

    this.diag.log(`manifest 로드: 영상 ${this.videos.length}개, 라디오 ${this.radios.length}개, 효과음 ${this.effects.length}개`);

    if (this.videos.length === 0) this.diag.error("videos.json에 사용할 수 있는 영상이 없습니다.");
    if (this.radios.length === 0) this.diag.error("radio.json에 사용할 수 있는 라디오가 없습니다.");
  }
}
