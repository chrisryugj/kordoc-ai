/** 내장 한글 편집기(rhwp-studio) 서버 — 127.0.0.1 임시 포트, 읽기 전용 정적 파일
 *
 * @rhwp/editor SDK 는 HTTP(S) 출처에서만 돌아서 tauri:// 창에 바로 못 붙인다. 그래서 사이드카가
 * 편집기(studio/)·SDK(sdk/)·중계 페이지(host.html)를 같은 출처로 서빙하고, 앱 창은 host.html 을
 * iframe 으로 연다. 문서 바이트는 서버를 거치지 않고 postMessage 로만 오간다.
 */

import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, normalize, sep } from 'node:path';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { logger } from '../../infra/logger.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** 설치본: <sidecar>/dist/bundle.mjs → <sidecar>/editor · 개발(tsc): dist/core/editor-server → ../../../editor */
export function editorRoot(): string | null {
  const env = process.env.KORDOC_AI_EDITOR_DIR;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [env, join(here, '..', 'editor'), join(here, '..', '..', '..', 'editor')].filter((p): p is string => !!p);
  return candidates.find((d) => existsSync(join(d, 'host.html')) && existsSync(join(d, 'studio', 'index.html'))) ?? null;
}

let server: Server | null = null;
let started: Promise<{ host_url: string; studio_version: string }> | null = null;

export function startEditorServer(): Promise<{ host_url: string; studio_version: string }> {
  if (started) return started;
  const root = editorRoot();
  if (!root) return Promise.reject(new Error('내장 한글 편집기 파일이 없습니다. 앱을 다시 설치하세요.'));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  let version = 'unknown';
  try { version = JSON.parse(readFileSync(join(root, 'version.json'), 'utf-8')).studio ?? version; } catch { /* 버전 표시만 */ }

  started = new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = normalize(join(root, pathname));
      // 루트 밖·숨김 파일 차단
      if (!file.startsWith(rootWithSep) || /(^|[\\/])\./.test(file.slice(rootWithSep.length))) {
        res.writeHead(403).end();
        return;
      }
      let size: number;
      try {
        const st = statSync(file);
        if (!st.isFile()) throw new Error('not file');
        size = st.size;
      } catch {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-length': size,
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      // 읽기 오류(권한·잠금)가 처리 안 된 예외로 엔진 전체를 끝내지 않게
      pipeline(createReadStream(file), res, (err) => { if (err) logger.warn(`[editor-server] ${basename(file)} 보내기 실패: ${err.message}`); });
    });
    srv.on('error', (err) => {
      started = null;
      reject(err);
    });
    srv.listen(0, '127.0.0.1', () => {
      server = srv;
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      logger.info(`[editor] 한글 편집기 서버 127.0.0.1:${port} (${root})`);
      resolve({ host_url: `http://127.0.0.1:${port}/host.html`, studio_version: version });
    });
  });
  return started;
}

export function stopEditorServer(): void {
  server?.close();
  server = null;
  started = null;
}
