// ============================================================
// manifest 검증 스크립트
//
//   node tools/validate-manifest.mjs
//
// - JSON 문법 오류를 위치와 함께 알기 쉽게 표시
// - 필수 필드 확인
// - manifest에 등록된 파일이 실제로 존재하는지 확인
// - 폴더에는 있는데 manifest에 없는 파일 안내
// ============================================================
import { readFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
let problems = 0;

function fail(msg) { console.error(`  ✗ ${msg}`); problems++; }
function ok(msg) { console.log(`  ✓ ${msg}`); }

async function parseJson(relPath) {
  const text = await readFile(join(root, relPath), "utf8");
  try {
    return JSON.parse(text);
  } catch (e) {
    const m = e.message.match(/position (\d+)/);
    if (m) {
      const pos = Number(m[1]);
      const line = text.slice(0, pos).split("\n").length;
      fail(`${relPath} JSON 문법 오류 (약 ${line}번째 줄): ${e.message}`);
      console.error(`    → 쉼표 누락/초과, 따옴표, 괄호를 확인하세요.`);
    } else {
      fail(`${relPath} JSON 문법 오류: ${e.message}`);
    }
    return null;
  }
}

async function exists(relPath) {
  try { await access(join(root, relPath)); return true; } catch { return false; }
}

async function checkEntries(entries, required, mediaDir, manifestName) {
  const usedFiles = new Set();
  const ids = new Set();
  for (const [i, entry] of entries.entries()) {
    const missing = required.filter((k) => entry?.[k] === undefined || entry[k] === "");
    if (missing.length) fail(`${manifestName}[${i}] 필수 필드 누락: ${missing.join(", ")}`);
    if (entry?.id) {
      if (ids.has(entry.id)) fail(`${manifestName}[${i}] id 중복: ${entry.id}`);
      ids.add(entry.id);
    }
    if (entry?.file) {
      usedFiles.add(entry.file);
      if (!(await exists(join(mediaDir, entry.file)))) {
        fail(`${manifestName}[${i}] 파일 없음: ${mediaDir}/${entry.file}`);
      }
    }
  }
  // 폴더에는 있지만 manifest에 없는 파일 안내 (오류 아님)
  const onDisk = await readdir(join(root, mediaDir)).catch(() => []);
  for (const f of onDisk) {
    if (!usedFiles.has(f) && !f.startsWith(".")) {
      console.log(`  ⚠ ${mediaDir}/${f} 는 ${manifestName}에 등록되어 있지 않습니다 (재생되지 않음)`);
    }
  }
  ok(`${manifestName}: ${entries.length}개 항목 검사 완료`);
}

console.log("videos.json 검사:");
const videos = await parseJson("data/videos.json");
if (videos) {
  if (!Array.isArray(videos)) fail("videos.json 최상위는 배열이어야 합니다.");
  else await checkEntries(videos, ["id", "file"], "media/videos", "videos.json");
}

console.log("\nradio.json 검사:");
const radio = await parseJson("data/radio.json");
if (radio) {
  const stations = Array.isArray(radio) ? radio : radio?.stations;
  if (!Array.isArray(stations)) fail("radio.json은 배열이거나 { stations: [...] } 형태여야 합니다.");
  else await checkEntries(stations, ["id", "file", "country", "city", "station"], "media/radio", "radio.json");

  const effects = Array.isArray(radio) ? [] : radio?.effects ?? [];
  for (const f of effects) {
    if (!(await exists(join("media/effects", f)))) fail(`효과음 파일 없음: media/effects/${f}`);
  }
  if (effects.length) ok(`효과음 ${effects.length}개 확인`);
}

console.log("\nconfig.json 검사:");
const config = await parseJson("data/config.json");
if (config) ok("config.json 문법 정상");

console.log(problems ? `\n문제 ${problems}건 발견` : "\n모든 검사 통과");
process.exit(problems ? 1 : 0);
