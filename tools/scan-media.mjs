// ============================================================
// 미디어 폴더 스캔 → manifest 생성
//
//   node tools/scan-media.mjs           # 초안(*.draft.json)만 생성 (기존 manifest 유지)
//   node tools/scan-media.mjs --apply   # videos.json / radio.json에 바로 적용
//
// media/videos, media/radio, media/effects 폴더의 파일을 이름순으로 읽는다.
// --apply 시:
//   - 기존 manifest는 .bak으로 백업
//   - 라디오 방송 정보(country/city/station/frequency)는 파일명이 같으면
//     기존 값을 그대로 이어받는다 → 다시 실행해도 입력한 정보가 사라지지 않는다
// ============================================================
import { readdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const apply = process.argv.includes("--apply");

const VIDEO_EXT = [".mp4", ".webm", ".mov", ".mkv", ".m4v"];
const AUDIO_EXT = [".mp3", ".ogg", ".wav", ".m4a", ".aac", ".flac"];
const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const pad2 = (n) => String(n).padStart(2, "0");

async function listMedia(dir, exts) {
  const files = await readdir(join(root, dir)).catch(() => []);
  return files
    .filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)) && !f.startsWith("."))
    .sort(byName);
}

async function readJson(rel, fallback) {
  try { return JSON.parse(await readFile(join(root, rel), "utf8")); } catch { return fallback; }
}

const videoFiles = await listMedia("media/videos", VIDEO_EXT);
const radioFiles = await listMedia("media/radio", AUDIO_EXT);
const effectFiles = await listMedia("media/effects", AUDIO_EXT);

// 기존 정보 이어받기 (파일명 기준)
const prevVideos = await readJson("data/videos.json", []);
const prevVideoByFile = new Map((Array.isArray(prevVideos) ? prevVideos : []).map((v) => [v.file, v]));
const prevRadio = await readJson("data/radio.json", {});
const prevStationByFile = new Map((prevRadio.stations ?? []).map((s) => [s.file, s]));

const videos = videoFiles.map((file, i) => ({
  id: `v${pad2(i + 1)}`,
  file,
  label: prevVideoByFile.get(file)?.label ?? file.replace(/\.[^.]+$/, ""),
}));

const stations = radioFiles.map((file, i) => {
  const prev = prevStationByFile.get(file);
  return {
    id: `r${pad2(i + 1)}`,
    file,
    country: prev?.country ?? "KR",
    city: prev?.city ?? "CITY",
    station: prev?.station ?? `STATION ${i + 1}`,
    frequency: prev?.frequency ?? "0.0 FM",
  };
});

const radioManifest = { stations, effects: effectFiles };

if (apply) {
  await copyFile(join(root, "data/videos.json"), join(root, "data/videos.json.bak")).catch(() => {});
  await copyFile(join(root, "data/radio.json"), join(root, "data/radio.json.bak")).catch(() => {});
  await writeFile(join(root, "data/videos.json"), JSON.stringify(videos, null, 2) + "\n");
  await writeFile(join(root, "data/radio.json"), JSON.stringify(radioManifest, null, 2) + "\n");
  console.log(`videos.json 적용: 영상 ${videos.length}개`);
  console.log(`radio.json 적용: 라디오 ${stations.length}개, 효과음 ${effectFiles.length}개`);
  console.log("(이전 manifest는 data/*.json.bak 에 백업)");
  const needInfo = stations.filter((s) => !prevStationByFile.has(s.file));
  if (needInfo.length) {
    console.log(`\n다음 ${needInfo.length}개 방송의 정보(country/city/station/frequency)를 data/radio.json에서 채워주세요:`);
    for (const s of needInfo) console.log(`  - ${s.file}`);
  }
  console.log("\n앱을 새로고침하면 반영됩니다. 검사: node tools/validate-manifest.mjs");
} else {
  await writeFile(join(root, "data/videos.draft.json"), JSON.stringify(videos, null, 2) + "\n");
  await writeFile(join(root, "data/radio.draft.json"), JSON.stringify(radioManifest, null, 2) + "\n");
  console.log(`videos.draft.json: 영상 ${videos.length}개`);
  console.log(`radio.draft.json: 라디오 ${stations.length}개, 효과음 ${effectFiles.length}개`);
  console.log("\n내용 확인 후 그대로 적용하려면: node tools/scan-media.mjs --apply");
}
