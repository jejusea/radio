// ============================================================
// 미디어 폴더 스캔 → manifest 초안 생성
//
//   node tools/scan-media.mjs
//
// media/videos, media/radio, media/effects 폴더를 읽어
// data/videos.draft.json / data/radio.draft.json 초안을 만든다.
// 초안을 확인·수정한 뒤 videos.json / radio.json으로 바꿔 사용한다.
// (기존 manifest를 덮어쓰지 않는다.)
// ============================================================
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const VIDEO_EXT = [".mp4", ".webm", ".mov", ".mkv"];
const AUDIO_EXT = [".mp3", ".ogg", ".wav", ".m4a", ".aac", ".flac"];

const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true });

async function listMedia(dir, exts) {
  const files = await readdir(join(root, dir)).catch(() => []);
  return files
    .filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)) && !f.startsWith("."))
    .sort(byName);
}

const videos = (await listMedia("media/videos", VIDEO_EXT)).map((file, i) => ({
  id: `v${String(i + 1).padStart(2, "0")}`,
  file,
  label: `scene ${String(i + 1).padStart(2, "0")}`,
}));

const stations = (await listMedia("media/radio", AUDIO_EXT)).map((file, i) => ({
  id: `r${String(i + 1).padStart(2, "0")}`,
  file,
  country: "COUNTRY",
  city: "CITY",
  station: `STATION ${i + 1}`,
  frequency: "0.0 MHz",
}));

const effects = await listMedia("media/effects", AUDIO_EXT);

await writeFile(join(root, "data/videos.draft.json"), JSON.stringify(videos, null, 2) + "\n");
await writeFile(join(root, "data/radio.draft.json"), JSON.stringify({ stations, effects }, null, 2) + "\n");

console.log(`videos.draft.json: 영상 ${videos.length}개`);
console.log(`radio.draft.json: 라디오 ${stations.length}개, 효과음 ${effects.length}개`);
console.log("\n초안의 country/city/station/frequency를 실제 값으로 수정한 뒤");
console.log("data/videos.json, data/radio.json으로 내용을 옮겨 사용하세요.");
