import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Badge } from "../ui/Badge";
import {
  PlayCircle, FileText, Lightbulb, Scan, Key, Upload, FolderOpen,
  CheckCircle, AlertTriangle, Zap, HelpCircle,
  GitCompareArrows, Table, FileOutput, Merge, Receipt, Sparkles, ClipboardList,
} from "lucide-react";

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabId = "start" | "features" | "faq" | "tips";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "start", label: "시작하기", icon: <PlayCircle size={15} /> },
  { id: "features", label: "주요 기능", icon: <FileText size={15} /> },
  { id: "faq", label: "자주 묻는 질문", icon: <HelpCircle size={15} /> },
  { id: "tips", label: "활용 팁", icon: <Lightbulb size={15} /> },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="ts-sm font-bold mb-3" style={{ color: "var(--color-text-primary)" }}>{title}</h3>
      {children}
    </div>
  );
}

function Step({ title, desc, icon }: { title: string; desc: string; icon?: React.ReactNode }) {
  return (
    <div className="flex gap-3 mb-3.5">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 ts-2xs font-bold"
        style={{ backgroundColor: "var(--color-accent-subtle)", color: "var(--color-accent)" }}
      >
        {icon}
      </div>
      <div className="pt-0.5">
        <span className="ts-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>{title}</span>
        <p className="ts-2xs mt-0.5 leading-relaxed" style={{ color: "var(--color-text-muted)" }}>{desc}</p>
      </div>
    </div>
  );
}

function FaqItem({ q, a, link }: { q: string; a: string; link?: { label: string; url: string } }) {
  return (
    <div className="mb-4 p-3.5 rounded-lg" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
      <p className="ts-sm font-semibold flex items-start gap-2" style={{ color: "var(--color-text-primary)" }}>
        <span className="ts-2xs font-bold px-1.5 py-0.5 rounded shrink-0"
          style={{ backgroundColor: "var(--color-accent-subtle)", color: "var(--color-accent)" }}>Q</span>
        {q}
      </p>
      <p className="ts-2xs mt-2 leading-relaxed pl-7" style={{ color: "var(--color-text-muted)" }}>
        {a}
        {link && (
          <>
            {" "}
            <a href={link.url} target="_blank" rel="noopener noreferrer"
              className="underline font-medium" style={{ color: "var(--color-accent)" }}>
              {link.label}
            </a>
          </>
        )}
      </p>
    </div>
  );
}

function FeatureCard({ icon, title, desc, color, badge }: {
  icon: React.ReactNode; title: string; desc: string; color: string; badge?: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 8%, transparent)`, color }}
      >
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h4 className="ts-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>{title}</h4>
          {badge && <Badge variant="primary" className="text-[0.55rem]">{badge}</Badge>}
        </div>
        <p className="ts-2xs mt-0.5 leading-relaxed" style={{ color: "var(--color-text-muted)" }}>{desc}</p>
      </div>
    </div>
  );
}

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  const [tab, setTab] = useState<TabId>("start");

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="사용 설명서" size="lg">
      <div className="flex gap-5" style={{ minHeight: 440 }}>
        {/* Sidebar Tabs */}
        <div className="flex flex-col gap-1 shrink-0" style={{ width: 150 }} role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`help-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`help-tabpanel-${t.id}`}
              className="flex items-center gap-2 px-3 py-2 rounded-lg ts-xs font-medium transition-colors text-left whitespace-nowrap"
              style={{
                backgroundColor: tab === t.id ? "var(--color-accent-subtle)" : "transparent",
                color: tab === t.id ? "var(--color-accent)" : "var(--color-text-muted)",
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}

          {/* Bottom credit */}
          <div className="mt-auto pt-4 px-2">
            <p className="ts-2xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
              KorDoc AI
              <br />한국 문서 변환 도구
            </p>
            <p className="ts-2xs mt-1" style={{ color: "var(--color-border-hover)", cursor: "default" }} title="광진구청 류주임">
              2026 © Chris Ryu.
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto pr-2" style={{ maxHeight: 480 }} role="tabpanel" id={`help-tabpanel-${tab}`} aria-labelledby={`help-tab-${tab}`}>
          {tab === "start" && (
            <div className="animate-fade-in">
              <Section title="빠른 시작 가이드">
                <Step title="API 키 설정" icon={<Key size={13} />}
                  desc="좌측 하단 '설정'을 클릭하고 Gemini API 키를 입력하세요. Google AI Studio에서 무료로 발급받을 수 있습니다." />
                <Step title="문서 가져오기" icon={<Upload size={13} />}
                  desc="홈 화면에서 '시작하기'를 클릭하거나, HWP/HWPX/PDF 파일을 직접 드래그앤드롭하세요." />
                <Step title="변환 시작" icon={<Zap size={13} />}
                  desc="파일을 선택하면 kordoc 엔진이 마크다운으로 변환합니다. 이미지 PDF는 Gemini Vision OCR로 자동 처리됩니다." />
                <Step title="결과 확인" icon={<FolderOpen size={13} />}
                  desc="변환 완료 후 '폴더 열기' 버튼으로 생성된 마크다운 파일을 확인하세요." />
              </Section>

              <Section title="지원 파일 형식">
                <div className="flex gap-2 flex-wrap mb-2">
                  <Badge variant="hwp">HWP</Badge>
                  <Badge variant="hwp">HWPX</Badge>
                  <Badge variant="pdf">PDF</Badge>
                  <Badge variant="xlsx">XLSX</Badge>
                </div>
                <div className="space-y-1.5">
                  <p className="ts-2xs flex items-start gap-1.5" style={{ color: "var(--color-text-muted)" }}>
                    <CheckCircle size={11} className="shrink-0 mt-0.5" style={{ color: "var(--color-success)" }} />
                    HWPX는 kordoc이 직접 파싱 (한컴오피스 불필요)
                  </p>
                  <p className="ts-2xs flex items-start gap-1.5" style={{ color: "var(--color-text-muted)" }}>
                    <CheckCircle size={11} className="shrink-0 mt-0.5" style={{ color: "var(--color-success)" }} />
                    PDF는 텍스트 기반 / 이미지 스캔본 모두 처리 가능
                  </p>
                  <p className="ts-2xs flex items-start gap-1.5" style={{ color: "var(--color-text-muted)" }}>
                    <AlertTriangle size={11} className="shrink-0 mt-0.5" style={{ color: "var(--color-warning)" }} />
                    HWP(구형)는 한컴오피스가 설치된 Windows에서만 변환 가능
                  </p>
                </div>
              </Section>

              <Section title="시스템 요구사항">
                <div className="space-y-1.5">
                  <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                    <strong style={{ color: "var(--color-text-secondary)" }}>운영체제:</strong> Windows 10/11
                  </p>
                  <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                    <strong style={{ color: "var(--color-text-secondary)" }}>Node.js:</strong> 20 이상 (엔진 실행에 필요)
                  </p>
                  <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                    <strong style={{ color: "var(--color-text-secondary)" }}>인터넷:</strong> AI 기능(OCR, 요약, 비교) 사용 시 필요. 오프라인 모드에서는 로컬 변환만 가능.
                  </p>
                </div>
              </Section>
            </div>
          )}

          {tab === "features" && (
            <div className="animate-fade-in">
              <Section title="문서 변환">
                <div className="space-y-2">
                  <FeatureCard icon={<FileText size={16} />} title="문서 → 마크다운 변환" color="var(--color-accent)"
                    desc="HWP, HWPX, PDF 문서를 마크다운으로 변환합니다. 표, 리스트, 제목 구조를 유지합니다." />
                  <FeatureCard icon={<Upload size={16} />} title="배치 변환" color="var(--color-accent)"
                    desc="여러 파일을 한 번에 선택하여 순차적으로 변환합니다. 진행률 표시와 취소를 지원합니다." />
                  <FeatureCard icon={<Scan size={16} />} title="AI OCR" color="#7C3AED" badge="Gemini"
                    desc="이미지 기반 PDF를 Gemini Vision에 직접 전송하여 텍스트를 인식합니다. 스캔 문서도 처리 가능합니다." />
                </div>
              </Section>

              <Section title="AI 분석">
                <div className="space-y-2">
                  <FeatureCard icon={<Sparkles size={16} />} title="AI 요약" color="#2563EB" badge="Gemini"
                    desc="문서 전체 또는 텍스트를 AI가 핵심 내용으로 요약합니다. 요약 길이와 언어를 선택할 수 있습니다." />
                  <FeatureCard icon={<GitCompareArrows size={16} />} title="문서 비교 (신구대조표)" color="#059669"
                    desc="두 문서의 차이점을 비교하여 신구대조표를 생성합니다. 개정 전/후 문서 비교에 유용합니다." />
                  <FeatureCard icon={<Receipt size={16} />} title="영수증 스캔" color="#D97706" badge="Gemini"
                    desc="영수증 이미지를 Gemini Vision으로 스캔하여 날짜, 금액, 항목 등을 JSON으로 구조화합니다." />
                </div>
              </Section>

              <Section title="문서 도구">
                <div className="space-y-2">
                  <FeatureCard icon={<Table size={16} />} title="표 추출" color="#7C3AED"
                    desc="문서에서 표만 추출합니다. 마크다운 표 또는 구조화된 데이터로 출력됩니다." />
                  <FeatureCard icon={<ClipboardList size={16} />} title="양식 필드 추출" color="#2563EB"
                    desc="신청서, 보고서 등의 양식에서 입력 필드와 값을 자동으로 추출합니다." />
                  <FeatureCard icon={<FileOutput size={16} />} title="마크다운 → HWPX 역변환" color="#059669"
                    desc="마크다운 텍스트를 HWPX 파일로 변환합니다. AI가 생성한 문서를 한글 문서로 내보낼 수 있습니다." />
                  <FeatureCard icon={<Merge size={16} />} title="문서 병합" color="#D97706"
                    desc="여러 문서를 하나의 마크다운으로 병합합니다. 구분선을 자동으로 삽입합니다." />
                </div>
              </Section>
            </div>
          )}

          {tab === "faq" && (
            <div className="animate-fade-in">
              <Section title="자주 묻는 질문">
                <FaqItem
                  q="API 키는 어디서 받나요?"
                  a="Google AI Studio에서 무료로 발급받을 수 있습니다. Google 계정만 있으면 됩니다."
                  link={{ label: "AI Studio 열기", url: "https://aistudio.google.com/apikey" }}
                />
                <FaqItem
                  q="API 사용 비용이 있나요?"
                  a="Gemini API 무료 티어로 분당 15회, 하루 1,500회 호출 가능합니다. 일반적인 문서 변환은 무료 범위 내에서 충분합니다."
                />
                <FaqItem
                  q="오프라인에서도 사용할 수 있나요?"
                  a="설정에서 '오프라인 모드'를 선택하면 API 없이 로컬 변환만 수행합니다. HWPX, 텍스트 PDF 변환은 오프라인에서도 가능하지만, OCR·요약·비교 등 AI 기능은 온라인이 필요합니다."
                />
                <FaqItem
                  q="HWP 파일이 변환되지 않아요"
                  a="구형 HWP(.hwp) 변환에는 한컴오피스가 필요합니다. HWPX(.hwpx)는 한컴오피스 없이 직접 파싱됩니다. 가능하면 HWPX로 저장 후 사용하세요."
                />
                <FaqItem
                  q="이미지 PDF가 빈 텍스트로 나와요"
                  a="이미지 기반 PDF는 Gemini API 키가 설정되어 있어야 OCR 처리됩니다. 설정에서 API 키를 입력하고 온라인 모드인지 확인하세요."
                />
                <FaqItem
                  q="변환 결과에 표가 깨져요"
                  a="kordoc 엔진이 문서 구조를 최대한 보존하지만, 복잡한 병합 셀이 있는 표는 단순화될 수 있습니다. 이 경우 '표 추출' 기능을 별도로 사용해 보세요."
                />
              </Section>
            </div>
          )}

          {tab === "tips" && (
            <div className="animate-fade-in">
              <Section title="활용 팁">
                <div className="space-y-3">
                  <div className="p-3.5 rounded-lg" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
                    <h4 className="ts-sm font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>대량 처리</h4>
                    <p className="ts-2xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                      여러 파일을 드래그앤드롭하거나 폴더를 선택하면 순차적으로 변환됩니다.
                      진행 중 취소 버튼으로 안전하게 중단할 수 있습니다.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-lg" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
                    <h4 className="ts-sm font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>모델 선택 가이드</h4>
                    <p className="ts-2xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                      <strong>OCR/변환:</strong> Gemini 3 Flash가 속도와 품질의 균형이 가장 좋습니다.
                      <br /><strong>분석/요약:</strong> Flash Lite로도 충분합니다. 복잡한 문서 분석이 필요하면 Pro를 선택하세요.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-lg" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
                    <h4 className="ts-sm font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>HWPX 우선 사용</h4>
                    <p className="ts-2xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                      가능하면 HWP 대신 HWPX 형식으로 저장 후 사용하세요.
                      HWPX는 한컴오피스 없이 직접 파싱되어 더 빠르고 정확합니다.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-lg" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
                    <h4 className="ts-sm font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>오프라인 활용</h4>
                    <p className="ts-2xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                      인터넷이 없는 환경에서는 설정에서 오프라인 모드를 선택하세요.
                      HWPX/텍스트 PDF 변환은 로컬에서 완전히 처리됩니다.
                    </p>
                  </div>
                </div>
              </Section>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
