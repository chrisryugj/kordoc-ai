/**
 * E2E 테스트 HTML 보고서 생성기
 *
 * 사용법:
 *   import { TestReporter } from './report-generator.mjs';
 *   const reporter = new TestReporter('편집 파이프라인 테스트');
 *   reporter.pass('TC #2', '문단 추가 성공', 'edit-01-split.png');
 *   reporter.fail('TC #3', '병합 실패', 'edit-02-merge.png');
 *   reporter.generate('e2e/report.html');
 */
import fs from 'fs';
import path from 'path';

export class TestReporter {
  constructor(title) {
    this.title = title;
    this.results = [];
    this.startTime = Date.now();
    this.currentSection = null;
  }

  section(name) {
    this.currentSection = name;
  }

  pass(tc, message, screenshot = null) {
    this.results.push({ tc, status: 'PASS', message, screenshot, section: this.currentSection });
  }

  fail(tc, message, screenshot = null) {
    this.results.push({ tc, status: 'FAIL', message, screenshot, section: this.currentSection });
  }

  skip(tc, message, screenshot = null) {
    this.results.push({ tc, status: 'SKIP', message, screenshot, section: this.currentSection });
  }

  generate(outputPath) {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const skipped = this.results.filter(r => r.status === 'SKIP').length;
    const total = this.results.length;
    const statusClass = failed > 0 ? 'fail' : 'pass';

    // 스크린샷을 base64로 인코딩
    const embedScreenshot = (screenshotPath) => {
      if (!screenshotPath) return null;
      const fullPath = path.resolve('e2e/screenshots', path.basename(screenshotPath));
      try {
        const data = fs.readFileSync(fullPath);
        return `data:image/png;base64,${data.toString('base64')}`;
      } catch {
        return null;
      }
    };

    // TC별 그룹화
    const tcGroups = new Map();
    for (const r of this.results) {
      const key = r.tc || r.section || 'General';
      if (!tcGroups.has(key)) tcGroups.set(key, []);
      tcGroups.get(key).push(r);
    }

    let tcRows = '';
    for (const [tc, items] of tcGroups) {
      const tcPassed = items.every(i => i.status !== 'FAIL');
      const tcStatus = items.some(i => i.status === 'FAIL') ? 'FAIL'
        : items.some(i => i.status === 'SKIP') ? 'SKIP' : 'PASS';
      const statusBadge = tcStatus === 'PASS' ? '<span class="badge pass">PASS</span>'
        : tcStatus === 'FAIL' ? '<span class="badge fail">FAIL</span>'
        : '<span class="badge skip">SKIP</span>';

      // 스크린샷 (마지막 항목의 것 사용)
      const lastScreenshot = [...items].reverse().find(i => i.screenshot)?.screenshot;
      const imgData = embedScreenshot(lastScreenshot);

      let assertionRows = items.map(i => {
        const icon = i.status === 'PASS' ? '✅' : i.status === 'FAIL' ? '❌' : '⏭️';
        return `<div class="assertion ${i.status.toLowerCase()}">${icon} ${escapeHtml(i.message)}</div>`;
      }).join('\n');

      tcRows += `
      <div class="tc-card ${tcStatus.toLowerCase()}">
        <div class="tc-header">
          <h3>${statusBadge} ${escapeHtml(tc)}</h3>
        </div>
        <div class="tc-body">
          <div class="assertions">${assertionRows}</div>
          ${imgData ? `<div class="screenshot"><img src="${imgData}" alt="${escapeHtml(tc)}" loading="lazy"></div>` : ''}
        </div>
      </div>`;
    }

    const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(this.title)} — E2E 테스트 보고서</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', -apple-system, sans-serif; background: #f5f5f5; color: #333; }
  .header { background: ${failed > 0 ? '#dc3545' : '#28a745'}; color: white; padding: 24px 32px; }
  .header h1 { font-size: 24px; margin-bottom: 8px; }
  .header .meta { font-size: 14px; opacity: 0.9; }
  .summary { display: flex; gap: 16px; padding: 20px 32px; background: white; border-bottom: 1px solid #e0e0e0; }
  .summary .stat { text-align: center; padding: 12px 24px; border-radius: 8px; }
  .summary .stat.pass { background: #d4edda; color: #155724; }
  .summary .stat.fail { background: #f8d7da; color: #721c24; }
  .summary .stat.skip { background: #fff3cd; color: #856404; }
  .summary .stat.total { background: #d1ecf1; color: #0c5460; }
  .stat .number { font-size: 32px; font-weight: bold; }
  .stat .label { font-size: 12px; text-transform: uppercase; margin-top: 4px; }
  .content { padding: 24px 32px; max-width: 1200px; margin: 0 auto; }
  .tc-card { background: white; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden; }
  .tc-card.fail { border-left: 4px solid #dc3545; }
  .tc-card.pass { border-left: 4px solid #28a745; }
  .tc-card.skip { border-left: 4px solid #ffc107; }
  .tc-header { padding: 12px 16px; border-bottom: 1px solid #f0f0f0; cursor: pointer; }
  .tc-header h3 { font-size: 16px; display: flex; align-items: center; gap: 8px; }
  .tc-body { padding: 16px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
  .badge.pass { background: #28a745; color: white; }
  .badge.fail { background: #dc3545; color: white; }
  .badge.skip { background: #ffc107; color: #333; }
  .assertions { margin-bottom: 12px; }
  .assertion { padding: 4px 0; font-size: 14px; font-family: monospace; }
  .assertion.fail { color: #dc3545; font-weight: bold; }
  .assertion.skip { color: #856404; }
  .screenshot { margin-top: 12px; }
  .screenshot img { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; transition: transform 0.2s; }
  .screenshot img:hover { transform: scale(1.02); }
  .footer { text-align: center; padding: 20px; font-size: 12px; color: #999; }
</style>
</head>
<body>
<div class="header">
  <h1>${escapeHtml(this.title)}</h1>
  <div class="meta">생성: ${now} | 소요: ${elapsed}초 | rhwp E2E CDP 테스트</div>
</div>
<div class="summary">
  <div class="stat total"><div class="number">${total}</div><div class="label">Total</div></div>
  <div class="stat pass"><div class="number">${passed}</div><div class="label">Passed</div></div>
  <div class="stat fail"><div class="number">${failed}</div><div class="label">Failed</div></div>
  <div class="stat skip"><div class="number">${skipped}</div><div class="label">Skipped</div></div>
</div>
<div class="content">
${tcRows}
</div>
<div class="footer">rhwp E2E Test Report — ${escapeHtml(this.title)}</div>
</body>
</html>`;

    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outputPath, html, 'utf-8');
    console.log(`\n📋 HTML 보고서: ${outputPath}`);
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
