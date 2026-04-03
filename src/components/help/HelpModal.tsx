import { useState } from "react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { Modal } from "../ui/Modal";
import { Badge } from "../ui/Badge";
import {
  PlayCircle, FileText, Tag, Scissors, BarChart3,
  Lightbulb, Scan, Key, Upload, FolderOpen,
  CheckCircle, AlertTriangle, Zap, HelpCircle,
} from "lucide-react";

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabId = "start" | "pipeline" | "faq" | "tips";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "start", label: "시작하기", icon: <PlayCircle size={15} /> },
  { id: "pipeline", label: "처리 과정", icon: <FileText size={15} /> },
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

function Step({ num, title, desc, icon }: { num: number; title: string; desc: string; icon?: React.ReactNode }) {
  return (
    <div className="flex gap-3 mb-3.5">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 ts-2xs font-bold"
        style={{ backgroundColor: "var(--color-accent-subtle)", color: "var(--color-accent)" }}
      >
        {icon || num}
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
            <button
              onClick={() => shellOpen(link.url)}
              className="underline font-medium"
              style={{ color: "var(--color-accent)" }}
            >
              {link.label}
            </button>
          </>
        )}
      </p>
    </div>
  );
}

const PIPELINE_STEPS = [
  {
    icon: <Upload size={16} />, title: "1단계: 문서 가져오기", color: "var(--color-accent)",
    desc: "HWP/PDF 파일을 드래그앤드롭하거나 파일 선택 다이얼로그로 추가합니다. 여러 파일을 한 번에 처리할 수 있습니다.",
  },
  {
    icon: <Scan size={16} />, title: "2단계: OCR 변환", color: "var(--color-accent)",
    desc: "Gemini Vision AI가 문서의 텍스트, 표, 다이어그램을 정밀하게 인식합니다. HWP는 자동으로 PDF 변환 후 OCR됩니다.",
  },
  {
    icon: <Tag size={16} />, title: "3단계: AI 자동 태깅", color: "#7C3AED",
    desc: "AI가 각 페이지를 학급수, 면적, 사업유형 등 테마별로 자동 분류합니다. 분류 결과를 검토하고 수동으로 조정할 수 있습니다.",
  },
  {
    icon: <Scissors size={16} />, title: "4단계: 테마별 추출", color: "#2563EB",
    desc: "확인된 태그를 기반으로 PDF 페이지를 테마별 폴더로 추출하고, 각 페이지에 출처 라벨을 자동 삽입합니다.",
  },
  {
    icon: <BarChart3 size={16} />, title: "5단계: 교육과정 분석", color: "#059669",
    desc: "교육과정 문서를 2단계로 요약합니다. 개별 학교 요약 → 통합 특색교육 리포트. 비교 분석을 위해 2개 버전의 리포트를 생성합니다.",
  },
];

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
              한국교육시설안전원
              <br />사전기획팀 자문
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
                <Step num={1} title="API 키 설정" icon={<Key size={13} />}
                  desc="좌측 하단 '설정'을 클릭하고 Gemini API 키를 입력하세요. Google AI Studio에서 무료로 발급받을 수 있습니다." />
                <Step num={2} title="문서 가져오기" icon={<Upload size={13} />}
                  desc="홈 화면에서 '문서 가져오기'를 클릭하거나, HWP/PDF 파일을 직접 드래그앤드롭하세요." />
                <Step num={3} title="자동 처리 시작" icon={<Zap size={13} />}
                  desc="OCR → AI 태깅 → 추출/분석을 순차적으로 처리합니다. 각 단계에서 진행률을 확인할 수 있어요." />
                <Step num={4} title="결과 확인" icon={<FolderOpen size={13} />}
                  desc="처리 완료 후 '폴더 열기' 버튼으로 테마별 PDF와 분석 리포트를 확인하세요." />
              </Section>

              <Section title="지원 파일 형식">
                <div className="flex gap-2 flex-wrap mb-2">
                  <Badge variant="hwp">HWP/HWPX</Badge>
                  <Badge variant="pdf">PDF</Badge>
                </div>
                <div className="space-y-1.5">
                  <p className="ts-2xs flex items-start gap-1.5" style={{ color: "var(--color-text-muted)" }}>
                    <CheckCircle size={11} className="shrink-0 mt-0.5" style={{ color: "var(--color-success)" }} />
                    PDF는 스캔본/텍스트본 모두 처리 가능
                  </p>
                  <p className="ts-2xs flex items-start gap-1.5" style={{ color: "var(--color-text-muted)" }}>
                    <AlertTriangle size={11} className="shrink-0 mt-0.5" style={{ color: "var(--color-warning)" }} />
                    HWP는 한컴오피스가 설치된 Windows에서만 변환 가능
                  </p>
                </div>
              </Section>

              <Section title="시스템 요구사항">
                <div className="space-y-1.5">
                  <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                    <strong style={{ color: "var(--color-text-secondary)" }}>운영체제:</strong> Windows 10/11
                  </p>
                  <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                    <strong style={{ color: "var(--color-text-secondary)" }}>HWP 변환:</strong> 한컴오피스 2020 이상
                  </p>
                  <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                    <strong style={{ color: "var(--color-text-secondary)" }}>인터넷:</strong> Gemini API 호출에 필요
                  </p>
                </div>
              </Section>
            </div>
          )}

          {tab === "pipeline" && (
            <div className="animate-fade-in">
              <Section title="5단계 자동 처리 과정">
                <div className="space-y-3">
                  {PIPELINE_STEPS.map((s) => (
                    <div key={s.title} className="flex items-start gap-3 p-3 rounded-lg" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `color-mix(in srgb, ${s.color} 8%, transparent)`, color: s.color }}
                      >
                        {s.icon}
                      </div>
                      <div>
                        <h4 className="ts-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>{s.title}</h4>
                        <p className="ts-2xs mt-0.5 leading-relaxed" style={{ color: "var(--color-text-muted)" }}>{s.desc}</p>
                      </div>
                    </div>
                  ))}
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
                  a="Gemini API 무료 티어로 분당 15회, 하루 1,500회 호출 가능합니다. 100페이지 문서 처리 시 약 5~20회 호출됩니다."
                />
                <FaqItem
                  q="HWP 파일이 변환되지 않아요"
                  a="HWP 변환에는 한컴오피스가 설치되어 있어야 합니다. 한컴오피스 2020 이상을 권장합니다."
                />
                <FaqItem
                  q="이미 처리한 파일을 다시 처리하고 싶어요"
                  a="이미 OCR된 파일은 자동으로 건너뜁니다. 재처리하려면 출력 폴더의 기존 결과를 삭제 후 다시 실행하세요."
                />
                <FaqItem
                  q="AI 태깅이 잘못된 경우 어떻게 하나요?"
                  a="3단계 태그 검토 화면에서 잘못된 태그를 수동으로 수정할 수 있습니다. 수정 후 '확인' 버튼을 눌러주세요."
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
                      한 번에 여러 파일을 드래그앤드롭하면 순차적으로 처리됩니다.
                      진행 중 취소 버튼으로 안전하게 중단할 수 있습니다.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-lg" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
                    <h4 className="ts-sm font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>모델 선택 가이드</h4>
                    <p className="ts-2xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                      <strong>OCR:</strong> Flash 모델이 속도/비용 대비 최적. 표가 복잡하면 Pro 추천.
                      <br /><strong>분석:</strong> Flash Lite로 충분. 심층 분석이 필요하면 Pro 선택.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-lg" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
                    <h4 className="ts-sm font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>출력 파일 구조</h4>
                    <p className="ts-2xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                      output/ 폴더에 테마별 하위 폴더가 생성됩니다.
                      각 PDF 페이지에는 출처 학교명과 페이지 번호가 라벨링됩니다.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-lg" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
                    <h4 className="ts-sm font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>문서 품질</h4>
                    <p className="ts-2xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                      OCR 정확도는 원본 문서 품질에 크게 좌우됩니다.
                      스캔 해상도 300dpi 이상, 기울기 없는 문서가 최적입니다.
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
