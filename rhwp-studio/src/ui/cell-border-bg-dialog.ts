import { ModalDialog } from './dialog';
import type { WasmBridge } from '@/core/wasm-bridge';
import type { CellProperties } from '@/core/types';
import type { EventBus } from '@/core/event-bus';

const HWPUNIT_PER_MM = 7200 / 25.4;

function hwp16ToMm(hu: number): number {
  return Math.round(hu * 25.4 / 7200 * 10) / 10;
}

function mmToHwp16(mm: number): number {
  return Math.round(mm * HWPUNIT_PER_MM);
}

/** 탭 정의 */
interface TabDef {
  id: string;
  label: string;
  builder: () => HTMLElement;
}

/**
 * 셀 테두리/배경 대화상자 (3탭: 테두리/배경/대각선)
 *
 * 셀 선택 모드에서 우클릭 컨텍스트 메뉴를 통해 접근.
 * applyMode: 'each' = 각 셀마다 적용, 'asOne' = 하나의 셀처럼 적용
 */
export class CellBorderBgDialog extends ModalDialog {
  private wasm: WasmBridge;
  private eventBus: EventBus;
  private tableCtx: { sec: number; ppi: number; ci: number };
  private cellIdx: number;
  private applyMode: 'each' | 'asOne';

  // 탭 UI
  private tabs: HTMLButtonElement[] = [];
  private panels: HTMLDivElement[] = [];

  // 테두리 탭 필드
  private borderLineTypeGrid!: HTMLDivElement;
  private borderSelectedLineType = 1;
  private borderWidthSelect!: HTMLSelectElement;
  private borderColorInput!: HTMLInputElement;
  private borderPreviewSvg!: SVGSVGElement;
  private borderEdits: { type: number; width: number; color: string }[] = [
    { type: 1, width: 0, color: '#000000' },
    { type: 1, width: 0, color: '#000000' },
    { type: 1, width: 0, color: '#000000' },
    { type: 1, width: 0, color: '#000000' },
  ];
  private borderApplyImmediateCheck!: HTMLInputElement;
  private borderScopeRadios!: HTMLInputElement[];

  // 배경 탭 필드
  private bgNoneRadio!: HTMLInputElement;
  private bgColorRadio!: HTMLInputElement;
  private bgColorPicker!: HTMLInputElement;
  private bgPatternColorPicker!: HTMLInputElement;
  private bgPatternTypeSelect!: HTMLSelectElement;
  private bgPreviewBox!: HTMLDivElement;
  private bgScopeRadios!: HTMLInputElement[];

  // 대각선 탭 필드
  private diagLineTypeSelect!: HTMLSelectElement;
  private diagWidthSelect!: HTMLSelectElement;
  private diagColorInput!: HTMLInputElement;
  private diagScopeRadios!: HTMLInputElement[];

  // 셀 속성 캐시
  private cellProps!: CellProperties;

  constructor(
    wasm: WasmBridge,
    eventBus: EventBus,
    tableCtx: { sec: number; ppi: number; ci: number },
    cellIdx: number,
    applyMode: 'each' | 'asOne' = 'each',
  ) {
    super('셀 테두리/배경', 460);
    this.wasm = wasm;
    this.eventBus = eventBus;
    this.tableCtx = tableCtx;
    this.cellIdx = cellIdx;
    this.applyMode = applyMode;
  }

  show(): void {
    super.show();
    const { sec, ppi, ci } = this.tableCtx;
    this.cellProps = this.wasm.getCellProperties(sec, ppi, ci, this.cellIdx);
    this.populateFields();
  }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');

    const tabDefs: TabDef[] = [
      { id: 'border', label: '테두리', builder: () => this.buildBorderTab() },
      { id: 'background', label: '배경', builder: () => this.buildBackgroundTab() },
      { id: 'diagonal', label: '대각선', builder: () => this.buildDiagonalTab() },
    ];

    // 탭 헤더
    const tabBar = document.createElement('div');
    tabBar.className = 'dialog-tabs';
    const panelContainer = document.createElement('div');

    for (let i = 0; i < tabDefs.length; i++) {
      const def = tabDefs[i];
      const btn = document.createElement('button');
      btn.className = 'dialog-tab';
      btn.textContent = def.label;
      btn.type = 'button';
      btn.addEventListener('click', () => this.switchTab(i));
      this.tabs.push(btn);
      tabBar.appendChild(btn);

      const panel = document.createElement('div');
      panel.className = 'dialog-tab-panel';
      panel.appendChild(def.builder());
      this.panels.push(panel);
      panelContainer.appendChild(panel);
    }

    body.appendChild(tabBar);
    body.appendChild(panelContainer);
    this.switchTab(0);

    return body;
  }

  private switchTab(idx: number): void {
    for (let i = 0; i < this.tabs.length; i++) {
      this.tabs[i].classList.toggle('active', i === idx);
      this.panels[i].classList.toggle('active', i === idx);
    }
  }

  // ─── 테두리 탭 ────────────────────────────────

  private buildBorderTab(): HTMLElement {
    const frag = document.createElement('div');
    frag.className = 'tcp-tab-content';

    // 선 종류 시각적 격자
    const lineSection = this.createSection('선 종류(Y)');
    this.borderLineTypeGrid = document.createElement('div');
    this.borderLineTypeGrid.className = 'tcp-line-type-grid';
    const lineTypeDefs = [
      { type: 0, label: '없음' },
      { type: 1, dash: '' },
      { type: 2, dash: '6,3' },
      { type: 3, dash: '2,2' },
      { type: 4, dash: '8,3,2,3' },
      { type: 5, dash: '8,3,2,3,2,3' },
      { type: 6, dash: '12,3' },
      { type: 8, label: '이중' },
    ];
    lineTypeDefs.forEach(def => {
      const item = document.createElement('div');
      item.className = 'tcp-line-type-item';
      if (def.type === 1) item.classList.add('active');
      if (def.type === 0) {
        const span = document.createElement('span');
        span.className = 'tcp-line-type-none';
        span.textContent = '없음';
        item.appendChild(span);
      } else if (def.type === 8) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 48 10');
        for (const y of [3, 7]) {
          const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          l.setAttribute('x1', '0'); l.setAttribute('y1', String(y));
          l.setAttribute('x2', '48'); l.setAttribute('y2', String(y));
          l.setAttribute('stroke', '#333'); l.setAttribute('stroke-width', '1');
          svg.appendChild(l);
        }
        item.appendChild(svg);
      } else {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 48 10');
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '0'); line.setAttribute('y1', '5');
        line.setAttribute('x2', '48'); line.setAttribute('y2', '5');
        line.setAttribute('stroke', '#333'); line.setAttribute('stroke-width', '1.5');
        if (def.dash) line.setAttribute('stroke-dasharray', def.dash);
        svg.appendChild(line);
        item.appendChild(svg);
      }
      item.addEventListener('click', () => {
        this.borderLineTypeGrid.querySelectorAll('.tcp-line-type-item').forEach(el =>
          el.classList.remove('active'));
        item.classList.add('active');
        this.borderSelectedLineType = def.type;
      });
      this.borderLineTypeGrid.appendChild(item);
    });
    lineSection.appendChild(this.borderLineTypeGrid);
    frag.appendChild(lineSection);

    // 굵기 + 색
    const attrSection = this.createSection('선 속성');
    const widthRow = this.row();
    widthRow.appendChild(this.label('굵기'));
    this.borderWidthSelect = document.createElement('select');
    this.borderWidthSelect.className = 'dialog-select';
    ['0.1mm', '0.12mm', '0.15mm', '0.2mm', '0.25mm', '0.3mm', '0.4mm'].forEach((text, i) => {
      const opt = document.createElement('option');
      opt.value = String(i); opt.textContent = text;
      this.borderWidthSelect.appendChild(opt);
    });
    widthRow.appendChild(this.borderWidthSelect);
    attrSection.appendChild(widthRow);

    const colorRow = this.row();
    colorRow.appendChild(this.label('색'));
    this.borderColorInput = document.createElement('input');
    this.borderColorInput.type = 'color';
    this.borderColorInput.value = '#000000';
    this.borderColorInput.style.width = '40px';
    this.borderColorInput.style.height = '22px';
    colorRow.appendChild(this.borderColorInput);
    attrSection.appendChild(colorRow);
    frag.appendChild(attrSection);

    // 프리셋 버튼 + 미리보기
    const previewSection = this.createSection('미리 보기');

    // 프리셋: 모두/바깥쪽/안쪽
    const presetRow = this.row();
    const presetGroup = document.createElement('div');
    presetGroup.className = 'dialog-btn-group';
    const presets = [
      { label: '모두', dirs: [0, 1, 2, 3] },
      { label: '바깥쪽', dirs: [0, 1, 2, 3] },
      { label: '안쪽', dirs: [] as number[] },
    ];
    presets.forEach(p => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = p.label;
      btn.addEventListener('click', () => {
        for (const d of p.dirs) this.applyBorderDir(d);
        this.updateBorderPreview();
      });
      presetGroup.appendChild(btn);
    });
    presetRow.appendChild(presetGroup);
    previewSection.appendChild(presetRow);

    // SVG 미리보기 + 방향 버튼
    const previewWrap = document.createElement('div');
    previewWrap.className = 'tcp-border-preview-wrap';

    const mkDirBtn = (text: string, cls: string, dirIdx: number) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `tcp-dir-btn ${cls}`;
      btn.textContent = text;
      btn.addEventListener('click', () => { this.applyBorderDir(dirIdx); this.updateBorderPreview(); });
      return btn;
    };
    previewWrap.appendChild(mkDirBtn('O', 'tcp-dir-all', 4));
    previewWrap.appendChild(mkDirBtn('▲', 'tcp-dir-top', 2));
    previewWrap.appendChild(document.createElement('span'));
    previewWrap.appendChild(mkDirBtn('◀', 'tcp-dir-left', 0));
    this.borderPreviewSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.borderPreviewSvg.classList.add('tcp-border-preview-svg');
    this.borderPreviewSvg.setAttribute('viewBox', '0 0 120 100');
    previewWrap.appendChild(this.borderPreviewSvg);
    previewWrap.appendChild(mkDirBtn('▶', 'tcp-dir-right', 1));
    previewWrap.appendChild(document.createElement('span'));
    previewWrap.appendChild(mkDirBtn('▼', 'tcp-dir-bottom', 3));
    previewSection.appendChild(previewWrap);

    // 선 모양 바로 적용
    const immediateRow = this.row();
    this.borderApplyImmediateCheck = this.checkbox('선 모양 바로 적용(I)');
    immediateRow.appendChild(this.borderApplyImmediateCheck.parentElement!);
    previewSection.appendChild(immediateRow);

    frag.appendChild(previewSection);

    // 적용 범위
    frag.appendChild(this.buildScopeSection('border'));

    return frag;
  }

  private applyBorderDir(dirIdx: number): void {
    const val = {
      type: this.borderSelectedLineType,
      width: parseInt(this.borderWidthSelect.value, 10),
      color: this.borderColorInput.value,
    };
    if (dirIdx === 4) {
      this.borderEdits = [val, val, val, val];
    } else {
      this.borderEdits[dirIdx] = val;
    }
  }

  private updateBorderPreview(): void {
    const svg = this.borderPreviewSvg;
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const ns = 'http://www.w3.org/2000/svg';
    const bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('x', '0'); bg.setAttribute('y', '0');
    bg.setAttribute('width', '120'); bg.setAttribute('height', '100');
    bg.setAttribute('fill', '#fff');
    svg.appendChild(bg);

    // 십자선
    for (const [x1, y1, x2, y2] of [['60', '5', '60', '95'], ['5', '50', '115', '50']]) {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('stroke', '#ccc'); line.setAttribute('stroke-width', '0.5');
      line.setAttribute('stroke-dasharray', '3,2');
      svg.appendChild(line);
    }

    const dashMap: Record<number, string> = {
      2: '6,3', 3: '2,2', 4: '8,3,2,3', 5: '8,3,2,3,2,3', 6: '12,3',
    };
    const drawLine = (x1: number, y1: number, x2: number, y2: number, b: { type: number; width: number; color: string }) => {
      if (b.type === 0) return;
      const w = Math.max(0.5, (b.width + 1) * 0.7);
      if (b.type === 7) {
        const offset = w * 0.8;
        const isVert = x1 === x2;
        for (const off of [-offset, offset]) {
          const l = document.createElementNS(ns, 'line');
          l.setAttribute('x1', String(x1 + (isVert ? off : 0)));
          l.setAttribute('y1', String(y1 + (isVert ? 0 : off)));
          l.setAttribute('x2', String(x2 + (isVert ? off : 0)));
          l.setAttribute('y2', String(y2 + (isVert ? 0 : off)));
          l.setAttribute('stroke', b.color); l.setAttribute('stroke-width', String(w * 0.5));
          svg.appendChild(l);
        }
      } else {
        const l = document.createElementNS(ns, 'line');
        l.setAttribute('x1', String(x1)); l.setAttribute('y1', String(y1));
        l.setAttribute('x2', String(x2)); l.setAttribute('y2', String(y2));
        l.setAttribute('stroke', b.color); l.setAttribute('stroke-width', String(w));
        if (dashMap[b.type]) l.setAttribute('stroke-dasharray', dashMap[b.type]);
        svg.appendChild(l);
      }
    };

    drawLine(2, 2, 2, 98, this.borderEdits[0]);
    drawLine(118, 2, 118, 98, this.borderEdits[1]);
    drawLine(2, 2, 118, 2, this.borderEdits[2]);
    drawLine(2, 98, 118, 98, this.borderEdits[3]);
  }

  // ─── 배경 탭 ────────────────────────────────

  private buildBackgroundTab(): HTMLElement {
    const frag = document.createElement('div');
    frag.className = 'tcp-tab-content';

    const fillSection = this.createSection('채우기');

    const noneRow = this.row();
    this.bgNoneRadio = document.createElement('input');
    this.bgNoneRadio.type = 'radio';
    this.bgNoneRadio.name = 'cellBgFill';
    this.bgNoneRadio.checked = true;
    this.bgNoneRadio.addEventListener('change', () => this.updateBgPreview());
    noneRow.appendChild(this.bgNoneRadio);
    noneRow.appendChild(document.createTextNode(' 채우기 없음'));
    fillSection.appendChild(noneRow);

    const colorRow = this.row();
    this.bgColorRadio = document.createElement('input');
    this.bgColorRadio.type = 'radio';
    this.bgColorRadio.name = 'cellBgFill';
    this.bgColorRadio.addEventListener('change', () => this.updateBgPreview());
    colorRow.appendChild(this.bgColorRadio);
    colorRow.appendChild(document.createTextNode(' 색(Q)'));
    fillSection.appendChild(colorRow);

    // 면색 + 무늬색 + 무늬모양
    const colorFields = document.createElement('div');
    colorFields.style.marginLeft = '20px';

    const faceRow = this.row();
    faceRow.appendChild(this.label('면색(C)'));
    this.bgColorPicker = document.createElement('input');
    this.bgColorPicker.type = 'color';
    this.bgColorPicker.value = '#ffffff';
    this.bgColorPicker.style.width = '40px';
    this.bgColorPicker.style.height = '22px';
    this.bgColorPicker.addEventListener('input', () => {
      this.bgColorRadio.checked = true;
      this.updateBgPreview();
    });
    faceRow.appendChild(this.bgColorPicker);
    colorFields.appendChild(faceRow);

    const patColorRow = this.row();
    patColorRow.appendChild(this.label('무늬색(K)'));
    this.bgPatternColorPicker = document.createElement('input');
    this.bgPatternColorPicker.type = 'color';
    this.bgPatternColorPicker.value = '#000000';
    this.bgPatternColorPicker.style.width = '40px';
    this.bgPatternColorPicker.style.height = '22px';
    this.bgPatternColorPicker.addEventListener('input', () => {
      this.bgColorRadio.checked = true;
      this.updateBgPreview();
    });
    patColorRow.appendChild(this.bgPatternColorPicker);
    colorFields.appendChild(patColorRow);

    const patTypeRow = this.row();
    patTypeRow.appendChild(this.label('무늬모양(L)'));
    this.bgPatternTypeSelect = this.selectOptions([
      ['0', '없음'], ['1', '가로줄'], ['2', '세로줄'], ['3', '역슬래시'],
      ['4', '슬래시'], ['5', '십자'], ['6', 'X자'],
    ]);
    this.bgPatternTypeSelect.addEventListener('change', () => {
      this.bgColorRadio.checked = true;
      this.updateBgPreview();
    });
    patTypeRow.appendChild(this.bgPatternTypeSelect);
    colorFields.appendChild(patTypeRow);

    fillSection.appendChild(colorFields);

    // 미리보기
    this.bgPreviewBox = document.createElement('div');
    this.bgPreviewBox.className = 'tcp-bg-preview';
    fillSection.appendChild(this.bgPreviewBox);

    frag.appendChild(fillSection);

    // 적용 범위
    frag.appendChild(this.buildScopeSection('bg'));

    return frag;
  }

  private updateBgPreview(): void {
    if (!this.bgColorRadio.checked) {
      this.bgPreviewBox.style.background = '#ffffff';
      return;
    }
    const faceColor = this.bgColorPicker.value;
    const patType = parseInt(this.bgPatternTypeSelect.value, 10);
    if (patType === 0) {
      this.bgPreviewBox.style.background = faceColor;
      return;
    }
    const patColor = this.bgPatternColorPicker.value;
    const patternMap: Record<number, string> = {
      1: `repeating-linear-gradient(0deg,${patColor} 0px,${patColor} 1px,transparent 1px,transparent 4px)`,
      2: `repeating-linear-gradient(90deg,${patColor} 0px,${patColor} 1px,transparent 1px,transparent 4px)`,
      3: `repeating-linear-gradient(135deg,${patColor} 0px,${patColor} 1px,transparent 1px,transparent 5px)`,
      4: `repeating-linear-gradient(45deg,${patColor} 0px,${patColor} 1px,transparent 1px,transparent 5px)`,
      5: `repeating-linear-gradient(0deg,${patColor} 0px,${patColor} 1px,transparent 1px,transparent 4px),repeating-linear-gradient(90deg,${patColor} 0px,${patColor} 1px,transparent 1px,transparent 4px)`,
      6: `repeating-linear-gradient(45deg,${patColor} 0px,${patColor} 1px,transparent 1px,transparent 5px),repeating-linear-gradient(135deg,${patColor} 0px,${patColor} 1px,transparent 1px,transparent 5px)`,
    };
    this.bgPreviewBox.style.background = `${patternMap[patType] || ''},${faceColor}`;
  }

  // ─── 대각선 탭 ────────────────────────────────

  private buildDiagonalTab(): HTMLElement {
    const frag = document.createElement('div');
    frag.className = 'tcp-tab-content';

    // 선 속성
    const lineSection = this.createSection('선 속성');
    const typeRow = this.row();
    typeRow.appendChild(this.label('종류'));
    this.diagLineTypeSelect = this.selectOptions([
      ['0', '없음'], ['1', '실선'], ['2', '파선'], ['3', '점선'],
      ['4', '일점쇄선'], ['5', '이점쇄선'], ['6', '긴 파선'], ['7', '이중 실선'],
    ]);
    typeRow.appendChild(this.diagLineTypeSelect);
    lineSection.appendChild(typeRow);

    const widthRow = this.row();
    widthRow.appendChild(this.label('굵기'));
    this.diagWidthSelect = this.selectOptions([
      ['0', '0.1mm'], ['1', '0.12mm'], ['2', '0.15mm'], ['3', '0.2mm'],
      ['4', '0.25mm'], ['5', '0.3mm'], ['6', '0.4mm'],
    ]);
    widthRow.appendChild(this.diagWidthSelect);
    lineSection.appendChild(widthRow);

    const colorRow = this.row();
    colorRow.appendChild(this.label('색'));
    this.diagColorInput = document.createElement('input');
    this.diagColorInput.type = 'color';
    this.diagColorInput.value = '#000000';
    this.diagColorInput.style.width = '40px';
    this.diagColorInput.style.height = '22px';
    colorRow.appendChild(this.diagColorInput);
    lineSection.appendChild(colorRow);
    frag.appendChild(lineSection);

    // 대각선 방향 아이콘
    const dirSection = this.createSection('대각선 방향');

    // \ 대각선
    const bsRow = this.row();
    bsRow.appendChild(this.label('\\ 대각선'));
    const bsGroup = document.createElement('div');
    bsGroup.className = 'dialog-btn-group';
    const bsBtn = document.createElement('button');
    bsBtn.type = 'button';
    bsBtn.textContent = '\\';
    bsBtn.addEventListener('click', () => bsBtn.classList.toggle('active'));
    bsGroup.appendChild(bsBtn);
    bsRow.appendChild(bsGroup);
    dirSection.appendChild(bsRow);

    // / 대각선
    const fsRow = this.row();
    fsRow.appendChild(this.label('/ 대각선'));
    const fsGroup = document.createElement('div');
    fsGroup.className = 'dialog-btn-group';
    const fsBtn = document.createElement('button');
    fsBtn.type = 'button';
    fsBtn.textContent = '/';
    fsBtn.addEventListener('click', () => fsBtn.classList.toggle('active'));
    fsGroup.appendChild(fsBtn);
    fsRow.appendChild(fsGroup);
    dirSection.appendChild(fsRow);

    // + 중심선
    const csRow = this.row();
    csRow.appendChild(this.label('+ 중심선'));
    const csGroup = document.createElement('div');
    csGroup.className = 'dialog-btn-group';
    const csBtn = document.createElement('button');
    csBtn.type = 'button';
    csBtn.textContent = '+';
    csBtn.addEventListener('click', () => csBtn.classList.toggle('active'));
    csGroup.appendChild(csBtn);
    csRow.appendChild(csGroup);
    dirSection.appendChild(csRow);

    frag.appendChild(dirSection);

    // 적용 범위
    frag.appendChild(this.buildScopeSection('diag'));

    return frag;
  }

  // ─── 공통: 적용 범위 섹션 ────────────────────

  private buildScopeSection(prefix: string): HTMLDivElement {
    const section = this.createSection('적용 범위');
    const radioGroup = document.createElement('div');
    radioGroup.className = 'dialog-radio-group';
    const radios: HTMLInputElement[] = [];

    for (const [val, text] of [['selected', '선택된 셀(S)'], ['all', '모든 셀(E)']] as const) {
      const lbl = document.createElement('label');
      const inp = document.createElement('input');
      inp.type = 'radio';
      inp.name = `${prefix}Scope`;
      inp.value = val;
      if (val === 'selected') inp.checked = true;
      lbl.appendChild(inp);
      lbl.appendChild(document.createTextNode(text));
      radioGroup.appendChild(lbl);
      radios.push(inp);
    }
    section.appendChild(radioGroup);

    if (prefix === 'border') this.borderScopeRadios = radios;
    else if (prefix === 'bg') this.bgScopeRadios = radios;
    else this.diagScopeRadios = radios;

    return section;
  }

  // ─── 필드 채우기 ────────────────────────────

  private populateFields(): void {
    const cp = this.cellProps;

    // 테두리
    const dirs = ['borderLeft', 'borderRight', 'borderTop', 'borderBottom'] as const;
    for (let i = 0; i < 4; i++) {
      const b = cp[dirs[i]];
      if (b) {
        this.borderEdits[i] = { type: b.type, width: b.width, color: b.color };
      }
    }
    this.updateBorderPreview();

    // 배경
    if (cp.fillType === 'solid' && cp.fillColor) {
      this.bgColorRadio.checked = true;
      this.bgColorPicker.value = cp.fillColor;
      if (cp.patternColor) this.bgPatternColorPicker.value = cp.patternColor;
      if (cp.patternType != null) this.bgPatternTypeSelect.value = String(cp.patternType);
    } else {
      this.bgNoneRadio.checked = true;
    }
    this.updateBgPreview();
  }

  protected onConfirm(): void {
    const { sec, ppi, ci } = this.tableCtx;

    const newProps: Record<string, unknown> = {};

    // 테두리
    newProps.borderLeft = this.borderEdits[0];
    newProps.borderRight = this.borderEdits[1];
    newProps.borderTop = this.borderEdits[2];
    newProps.borderBottom = this.borderEdits[3];

    // 배경
    if (this.bgColorRadio.checked) {
      newProps.fillType = 'solid';
      newProps.fillColor = this.bgColorPicker.value;
      newProps.patternColor = this.bgPatternColorPicker.value;
      newProps.patternType = parseInt(this.bgPatternTypeSelect.value, 10);
    } else {
      newProps.fillType = 'none';
    }

    // 적용 범위 결정: 테두리 탭의 scope를 기준으로 판단
    const borderScope = this.borderScopeRadios?.find(r => r.checked)?.value ?? 'selected';
    if (borderScope === 'all') {
      const dims = this.wasm.getTableDimensions(sec, ppi, ci);
      for (let i = 0; i < dims.cellCount; i++) {
        this.wasm.setCellProperties(sec, ppi, ci, i, newProps as Partial<CellProperties>);
      }
    } else {
      this.wasm.setCellProperties(sec, ppi, ci, this.cellIdx, newProps as Partial<CellProperties>);
    }
    this.eventBus.emit('document-changed');
  }

  // ─── DOM 헬퍼 ────────────────────────────────

  private createSection(title: string): HTMLDivElement {
    const sec = document.createElement('div');
    sec.className = 'dialog-section';
    const t = document.createElement('div');
    t.className = 'dialog-section-title';
    t.textContent = title;
    sec.appendChild(t);
    return sec;
  }

  private row(): HTMLDivElement {
    const r = document.createElement('div');
    r.className = 'dialog-row';
    return r;
  }

  private label(text: string): HTMLSpanElement {
    const l = document.createElement('span');
    l.className = 'dialog-label';
    l.textContent = text;
    return l;
  }

  private checkbox(text: string): HTMLInputElement {
    const lbl = document.createElement('label');
    lbl.className = 'dialog-checkbox';
    const inp = document.createElement('input');
    inp.type = 'checkbox';
    lbl.appendChild(inp);
    lbl.appendChild(document.createTextNode(text));
    return inp;
  }

  private selectOptions(items: string[][]): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.className = 'dialog-select';
    for (const [value, text] of items) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      sel.appendChild(opt);
    }
    return sel;
  }
}
