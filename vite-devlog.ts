/**
 * Vite Dev Logger Plugin — 프론트엔드 RPC 호출 로그를 Vite 터미널에 표시
 * HMR 메시지와 같은 스타일로 출력
 */
import type { Plugin } from "vite";

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

function timestamp(): string {
  const d = new Date();
  return `${COLORS.dim}${d.toLocaleTimeString("ko-KR", { hour12: false })}${COLORS.reset}`;
}

export default function devLogPlugin(): Plugin {
  return {
    name: "kordoc-devlog",
    apply: "serve", // dev 모드에서만 활성화
    configureServer(server) {
      server.middlewares.use("/__devlog", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }

        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", () => {
          try {
            const { level, method, message, elapsed } = JSON.parse(body);
            const tag = `${COLORS.cyan}[kordoc]${COLORS.reset}`;
            const elapsedStr = elapsed ? ` ${COLORS.dim}${elapsed}${COLORS.reset}` : "";

            let color = COLORS.blue;
            let icon = "→";
            if (level === "ok") { color = COLORS.green; icon = "✓"; }
            else if (level === "error") { color = COLORS.red; icon = "✗"; }
            else if (level === "warn") { color = COLORS.yellow; icon = "⚠"; }
            else if (level === "start") { color = COLORS.magenta; icon = "▶"; }

            const methodStr = method ? `${color}${method}${COLORS.reset} ` : "";
            console.log(`${timestamp()} ${tag} ${icon} ${methodStr}${message}${elapsedStr}`);
          } catch {
            // 파싱 실패 무시
          }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}
