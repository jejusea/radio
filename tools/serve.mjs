// ============================================================
// 의존성 없는 로컬 정적 서버 (Node 내장 모듈만 사용 — 완전 오프라인)
//
//   node tools/serve.mjs [포트]     기본 포트 8080
//   → http://localhost:8080
//
// - .json / manifest는 no-store로 응답해 수정이 즉시 반영되게 한다.
// - 미디어 파일은 Range 요청을 지원한다 (currentTime 탐색에 필요).
// ============================================================
import { createServer } from "node:http";
import { stat, open } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.argv[2]) || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (urlPath.endsWith("/")) urlPath += "index.html";
    const filePath = normalize(join(root, urlPath));
    if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404); res.end("404 Not Found"); return; }

    const ext = extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Accept-Ranges": "bytes",
      // manifest/설정 수정이 캐시 때문에 반영되지 않는 문제 방지
      "Cache-Control": ext === ".json" || ext === ".html" ? "no-store" : "max-age=60",
    };

    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    let start = 0, end = info.size - 1, status = 200;
    if (range && (range[1] || range[2])) {
      start = range[1] ? parseInt(range[1], 10) : Math.max(0, info.size - parseInt(range[2], 10));
      end = range[1] && range[2] ? parseInt(range[2], 10) : end;
      if (start > end || start >= info.size) {
        res.writeHead(416, { "Content-Range": `bytes */${info.size}` }); res.end(); return;
      }
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
    }
    headers["Content-Length"] = end - start + 1;

    res.writeHead(status, headers);
    if (req.method === "HEAD") { res.end(); return; }
    const fh = await open(filePath);
    fh.createReadStream({ start, end, autoClose: true }).pipe(res);
  } catch (e) {
    res.writeHead(500); res.end(String(e?.message ?? e));
  }
});

server.listen(port, () => {
  console.log(`─────────────────────────────────────────`);
  console.log(`  C — 여전히 빈 집에 있습니다`);
  console.log(`  http://localhost:${port}`);
  console.log(`  종료: Ctrl+C`);
  console.log(`─────────────────────────────────────────`);
});
