/** 윈도 기본 도구의 절대 경로
 *
 * 이름만 주고 실행하면(`powershell`) Node 는 현재 폴더에서 먼저 찾는다. 엔진이 MCP 서버로 뜰 때의 현재 폴더는
 * AI 프로그램이 정한 작업 폴더다 → 받은 압축 파일을 푼 폴더에 `powershell.exe` 가 섞여 있으면 그것이 실행된다.
 * 그래서 윈도 폴더 아래의 절대 경로로만 띄운다. 다른 OS 에서는 이름 그대로.
 */

import { win32 } from 'node:path';

const TOOLS = {
  powershell: ['System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'],
  explorer: ['explorer.exe'],
} as const;

export function winTool(name: keyof typeof TOOLS, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform !== 'win32') return name;
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows';
  return win32.join(root, ...TOOLS[name]);
}
