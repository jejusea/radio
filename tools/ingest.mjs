// ============================================================
// 실제 미디어 인제스트 파이프라인
//
//   1) incoming/videos/ 에 원본 영상(아무 형식), incoming/radio/ 에 원본 녹음을 넣는다
//   2) node tools/ingest.mjs                      ← 변환 + manifest 자동 갱신
//      node tools/ingest.mjs --dry                ← 변환 없이 계획만 표시
//      node tools/ingest.mjs --size 640x480       ← Raspberry Pi용 저해상도 빌드
//   3) 앱 새로고침
//
// 하는 일:
//   - 영상 → media/videos/video_NNN.mp4  (H.264 + AAC, CRF 18 고화질)
//     · 기본: 원본 해상도 유지 (데스크탑 고해상도 송출용 — 파일마다 화질 달라도 무방)
//     · --size WxH: 해당 해상도로 축소 + 4:3 여백 패딩 (Pi 3는 1080p까지만
//       하드웨어 디코딩되므로 전시 빌드는 --size 640x480 권장)
//   - 녹음 → media/radio/radio_NNN.mp3   (128kbps)
//   - data/videos.json / radio.json 재작성 (기존 파일은 .bak으로 백업)
//   - 라디오 metadata(국가/도시/방송국/주파수)는 원본 파일명(source) 기준으로
//     기존 manifest에서 이어받는다 → 다시 실행해도 입력한 정보가 사라지지 않는다
//
// 필요: ffmpeg (Windows: winget install ffmpeg / macOS: brew install ffmpeg)
// 원본은 삭제하지 않는다. incoming/은 .gitignore에 포함되어 커밋되지 않는다.
// ============================================================
import { readdir, mkdir, readFile, writeFile, copyFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, parse } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dry = process.argv.includes("--dry");

// --size WxH → 축소 + 4:3 패딩 / 미지정 → 원본 해상도 유지
const sizeArgIndex = process.argv.indexOf("--size");
const sizeArg = sizeArgIndex > -1 ? process.argv[sizeArgIndex + 1] : null;
let targetSize = null;
if (sizeArg) {
  const m = sizeArg.match(/^(\d+)x(\d+)$/i);
  if (!m) { console.error(`--size 형식이 잘못됐습니다: "${sizeArg}" (예: --size 640x480)`); process.exit(1); }
  targetSize = { w: Number(m[1]), h: Number(m[2]) };
}

const VIDEO_EXT = [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mts"];
const AUDIO_EXT = [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".wma", ".aif", ".aiff"];
const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const pad3 = (n) => String(n).padStart(3, "0");
const mb = (bytes) => (bytes / 1048576).toFixed(1) + " MB";

function ffmpegExists() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; }
  catch { return false; }
}

async function listIncoming(dir, exts) {
  const files = await readdir(join(root, dir)).catch(() => []);
  return files.filter((f) => exts.includes(parse(f).ext.toLowerCase()) && !f.startsWith(".")).sort(byName);
}

async function readJson(rel, fallback) {
  try { return JSON.parse(await readFile(join(root, rel), "utf8")); } catch { return fallback; }
}

async function backup(rel) {
  await copyFile(join(root, rel), join(root, rel + ".bak")).catch(() => {});
}

// ---- 준비 ----------------------------------------------------
await mkdir(join(root, "incoming/videos"), { recursive: true });
await mkdir(join(root, "incoming/radio"), { recursive: true });
await mkdir(join(root, "media/videos"), { recursive: true });
await mkdir(join(root, "media/radio"), { recursive: true });

const videosIn = await listIncoming("incoming/videos", VIDEO_EXT);
const radioIn = await listIncoming("incoming/radio", AUDIO_EXT);

if (videosIn.length === 0 && radioIn.length === 0) {
  console.log("incoming/videos/ 와 incoming/radio/ 가 비어 있습니다.");
  console.log("원본 파일을 넣은 뒤 다시 실행하세요. (원본 형식은 자유 — mp4/mov/wav/m4a 등)");
  process.exit(0);
}
if (!dry && !ffmpegExists()) {
  console.error("ffmpeg를 찾을 수 없습니다.");
  console.error("  Windows: winget install ffmpeg   /  macOS: brew install ffmpeg");
  console.error("설치 후 터미널을 새로 열고 다시 실행하세요. (--dry 로 계획만 볼 수 있음)");
  process.exit(1);
}

console.log(`영상 ${videosIn.length}개, 녹음 ${radioIn.length}개 발견${dry ? " (dry run — 변환 안 함)" : ""}\n`);

// ---- 영상 변환 ----------------------------------------------
function probeResolution(path) {
  try {
    const out = execFileSync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "csv=p=0", path,
    ]).toString().trim();
    const [w, h] = out.split(",").map(Number);
    return w && h ? { w, h } : null;
  } catch { return null; }
}

const videoEntries = [];
const overFullHD = [];
if (videosIn.length) {
  for (const [i, src] of videosIn.entries()) {
    const out = `video_${pad3(i + 1)}.mp4`;
    const res = ffmpegExists() ? probeResolution(join(root, "incoming/videos", src)) : null;
    const resNote = res ? `  (원본 ${res.w}×${res.h})` : "";
    if (!targetSize && res && (res.w > 1920 || res.h > 1080)) overFullHD.push(src);
    console.log(`영상: ${src} → media/videos/${out}${resNote}`);
    if (!dry) {
      const vf = targetSize
        ? `scale=${targetSize.w}:${targetSize.h}:force_original_aspect_ratio=decrease,pad=${targetSize.w}:${targetSize.h}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`
        : "format=yuv420p"; // 원본 해상도 유지
      execFileSync("ffmpeg", [
        "-y", "-loglevel", "error",
        "-i", join(root, "incoming/videos", src),
        "-vf", vf,
        "-c:v", "libx264", "-profile:v", "high", "-crf", "18", "-preset", "medium",
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart",
        join(root, "media/videos", out),
      ], { stdio: ["ignore", "inherit", "inherit"] });
    }
    videoEntries.push({ id: `v${pad3(i + 1)}`, file: out, label: parse(src).name, source: src });
  }
}

if (overFullHD.length) {
  console.log(`\n⚠ 1080p 초과 원본 ${overFullHD.length}개 — 데스크탑 재생은 문제없지만,`);
  console.log(`  Raspberry Pi 3는 1080p까지만 하드웨어 디코딩됩니다.`);
  console.log(`  전시(Pi) 빌드 시에는 다음으로 다시 변환하세요: node tools/ingest.mjs --size 640x480`);
}

// ---- 라디오 변환 (기존 metadata를 source 기준으로 이어받음) ----
const radioEntries = [];
const prevRadio = await readJson("data/radio.json", {});
const prevBySource = new Map(
  (prevRadio.stations ?? []).filter((s) => s.source).map((s) => [s.source, s])
);
if (radioIn.length) {
  for (const [i, src] of radioIn.entries()) {
    const out = `radio_${pad3(i + 1)}.mp3`;
    console.log(`라디오: ${src} → media/radio/${out}`);
    if (!dry) {
      execFileSync("ffmpeg", [
        "-y", "-loglevel", "error",
        "-i", join(root, "incoming/radio", src),
        "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100",
        join(root, "media/radio", out),
      ], { stdio: ["ignore", "inherit", "inherit"] });
    }
    const prev = prevBySource.get(src);
    radioEntries.push({
      id: `r${pad3(i + 1)}`,
      file: out,
      country: prev?.country ?? "KR",
      city: prev?.city ?? "CITY",
      station: prev?.station ?? `STATION ${i + 1}`,
      frequency: prev?.frequency ?? "0.0 FM",
      source: src,
    });
  }
}

// ---- manifest 갱신 ------------------------------------------
if (!dry) {
  if (videoEntries.length) {
    await backup("data/videos.json");
    await writeFile(join(root, "data/videos.json"), JSON.stringify(videoEntries, null, 2) + "\n");
    console.log(`\nvideos.json 갱신 (${videoEntries.length}개, 이전 파일은 videos.json.bak)`);
  }
  if (radioEntries.length) {
    await backup("data/radio.json");
    const effects = prevRadio.effects ?? ["tuning_01.mp3", "tuning_02.mp3", "tuning_03.mp3"];
    await writeFile(join(root, "data/radio.json"), JSON.stringify({ stations: radioEntries, effects }, null, 2) + "\n");
    console.log(`radio.json 갱신 (${radioEntries.length}개, 이전 파일은 radio.json.bak)`);
    const missing = radioEntries.filter((r) => !prevBySource.has(r.source));
    if (missing.length) {
      console.log(`\n다음 ${missing.length}개 방송의 정보(country/city/station/frequency)를 radio.json에서 채워주세요:`);
      for (const r of missing) console.log(`  - ${r.file}  (원본: ${r.source})`);
    }
  }

  // 용량 리포트
  let total = 0;
  for (const dir of ["media/videos", "media/radio", "media/effects"]) {
    for (const f of await readdir(join(root, dir)).catch(() => [])) {
      total += (await stat(join(root, dir, f))).size;
    }
  }
  console.log(`\n변환 후 media/ 총 용량: ${mb(total)}`);
  console.log("완료. 앱을 새로고침하면 새 미디어가 반영됩니다. (검사: node tools/validate-manifest.mjs)");
} else {
  console.log("\n(dry run 종료 — 실제 변환하려면 --dry 없이 실행)");
}
