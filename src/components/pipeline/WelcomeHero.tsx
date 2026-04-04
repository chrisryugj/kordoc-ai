import {
  FileText, Scan, GitCompareArrows, Sparkles,
  BookOpen, Upload, AlertTriangle,
} from "lucide-react";
import { Button } from "../ui/Button";
import { motion } from "framer-motion";

interface WelcomeHeroProps {
  sidecarReady: boolean;
  sidecarError?: string;
  apiKeySet: boolean;
  onStart: () => void;
  onHelp: () => void;
  onSettings: () => void;
}

const FEATURES = [
  { icon: <FileText size={18} />, label: "문서 변환", desc: "HWP/PDF → 마크다운", color: "var(--color-accent)" },
  { icon: <Scan size={18} />, label: "AI OCR", desc: "이미지 PDF 인식", color: "#7C3AED" },
  { icon: <Sparkles size={18} />, label: "AI 요약", desc: "문서 핵심 요약", color: "#2563EB" },
  { icon: <GitCompareArrows size={18} />, label: "문서 비교", desc: "신구대조표 생성", color: "#059669" },
];

export function WelcomeHero({ sidecarReady, sidecarError, apiKeySet, onStart, onHelp, onSettings }: WelcomeHeroProps) {
  return (
    <div className="relative w-full h-full flex overflow-hidden select-none bg-primary/5" onContextMenu={(e) => e.preventDefault()}>
      
      {/* Floating API Key Warning - Top Right */}
      {sidecarReady && !apiKeySet && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="absolute top-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border glass"
          style={{
            backgroundColor: "var(--color-warning-bg)",
            borderColor: "var(--color-warning)",
            color: "var(--color-warning)"
          }}
        >
          <AlertTriangle size={18} />
          <span className="ts-sm font-medium">Gemini API 키가 설정되지 않았습니다.</span>
          <button
            onClick={onSettings}
            className="ts-xs px-3 py-1.5 rounded-md text-white font-semibold transition-transform active:scale-95 ml-2"
            style={{ backgroundColor: "var(--color-warning)", boxShadow: "0 2px 4px rgba(217, 119, 6, 0.2)" }}
          >
            설정하기
          </button>
        </motion.div>
      )}

      {/* LEFT PANEL : Typography & Actions (60%) */}
      <div className="w-[60%] h-full flex flex-col justify-center px-12 md:px-20 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="max-w-2xl"
        >
          {/* Badge */}
          <div
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full ts-xs font-semibold mb-6"
            style={{
              backgroundColor: "var(--color-accent-subtle)",
              color: "var(--color-accent)",
              border: "1px solid var(--color-accent-light)",
            }}
          >
            <Sparkles size={12} />
            한국 문서 변환 AI 도구
          </div>

          {/* Title */}
          <h1
            className="text-display font-bold leading-[1.15] mb-6"
            style={{
              color: "var(--color-text-primary)",
              fontSize: "clamp(2.5rem, 4vw, 3.5rem)",
              letterSpacing: "var(--tracking-hero)",
            }}
          >
            문서를 넣으세요. <br />
            <span className="text-gradient">AI가 변환</span>합니다.
          </h1>

          <p
            className="ts-md mb-10"
            style={{ 
              color: "var(--color-text-muted)", 
              letterSpacing: "var(--tracking-body)", 
              lineHeight: 1.6,
              maxWidth: "500px" 
            }}
          >
            HWP, HWPX, PDF, XLSX 등 한국 공공문서를 <br />
            마크다운으로 변환하고, AI로 요약·비교·분석합니다.
          </p>

          {/* CTA Group */}
          <div className="flex items-center gap-4 mb-12">
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button size="lg" onClick={onStart} disabled={!sidecarReady} className="shadow-lg h-14 px-8 text-base">
                <span className="flex items-center gap-2">
                  {!sidecarReady ? (
                    <>
                      <div className="w-4 h-4 border-2 border-current rounded-full animate-spin" style={{ borderTopColor: "transparent" }} />
                      엔진 시작 중...
                    </>
                  ) : (
                    <><Upload size={18} /> 시작하기 (문서 가져오기)</>
                  )}
                </span>
              </Button>
            </motion.div>
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button variant="secondary" size="lg" onClick={onHelp} className="h-14 px-6 text-base">
                <span className="flex items-center gap-2">
                  <BookOpen size={18} /> 사용 설명서
                </span>
              </Button>
            </motion.div>
          </div>

          {/* Status & Processing Flow */}
          <div className="pt-8 border-t" style={{ borderColor: "var(--color-border-subtle)" }}>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex items-center gap-2 ts-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
                {sidecarError ? (
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--color-error)", boxShadow: "0 0 8px var(--color-error)" }} />
                ) : !sidecarReady ? (
                  <div className="w-4 h-4 border-2 border-current rounded-full animate-spin" style={{ borderTopColor: "transparent", color: "var(--color-warning)" }} />
                ) : (
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--color-success)", boxShadow: "0 0 8px var(--color-success)" }} />
                )}
                <span style={sidecarError ? { color: "var(--color-error)" } : undefined}>
                  {sidecarError ? `엔진 오류: ${sidecarError}` : sidecarReady ? "AI 분석 엔진 On-line" : "AI 엔진 시작 중..."}
                </span>
              </div>
              <div className="w-px h-4" style={{ backgroundColor: "var(--color-border)" }} />
              <div className="flex items-center gap-1.5">
                {["HWP", "HWPX", "PDF", "XLSX"].map((ft) => (
                  <span
                    key={ft}
                    className="px-2 py-0.5 rounded text-[11px] font-bold tracking-wider opacity-80"
                    style={{
                      color: ft === "PDF" ? "var(--color-file-pdf)" : "var(--color-file-hwp)",
                      backgroundColor: ft === "PDF" ? "var(--color-file-pdf-bg)" : "var(--color-file-hwp-bg)",
                    }}
                  >
                    {ft}
                  </span>
                ))}
              </div>
            </div>

            {/* Features Info - Elegant Grid */}
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 max-w-lg">
              {FEATURES.map((f, i) => (
                <div key={i} className="flex items-start gap-3 opacity-80 hover:opacity-100 transition-opacity duration-300">
                  <div className="mt-0.5 p-1.5 rounded-lg" style={{ backgroundColor: `color-mix(in srgb, ${f.color} 10%, transparent)` }}>
                    <span style={{ color: f.color }}>{f.icon}</span>
                  </div>
                  <div>
                    <div className="ts-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>{f.label}</div>
                    <div className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      {/* RIGHT PANEL : Graphic Metaphor (40%) */}
      <div 
        className="w-[40%] h-full relative flex items-center justify-center overflow-hidden"
        style={{ backgroundColor: "var(--color-bg-secondary)", borderLeft: "1px solid var(--color-border-subtle)" }}
      >
        {/* Subtle mesh gradient background */}
        <div className="absolute inset-0 opacity-40 dark:opacity-20 pointer-events-none" style={{ background: "radial-gradient(circle at 70% 30%, var(--color-accent-subtle) 0%, transparent 60%)" }} />
        
        {/* AI Metaphor 3D-ish Composition */}
        <div className="relative w-full aspect-square max-w-[500px] flex items-center justify-center pointer-events-none">
          {/* Animated Blob 1 */}
          <motion.div
            animate={{ y: [-15, 15, -15], rotate: [0, 10, -5, 0] }}
            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
            className="absolute rounded-[40px] shadow-2xl"
            style={{ 
              width: "60%", height: "60%", 
              background: "linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 20%, transparent) 0%, color-mix(in srgb, #7C3AED 20%, transparent) 100%)", 
              backdropFilter: "blur(24px)", 
              border: "1px solid var(--color-border-subtle)",
              transform: "rotate(-10deg)"
            }}
          />
          
          {/* Animated Blob 2 */}
          <motion.div
            animate={{ y: [15, -15, 15], rotate: [0, -10, 10, 0] }}
            transition={{ duration: 9, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            className="absolute rounded-full shadow-xl"
            style={{ 
              width: "45%", height: "45%", right: "10%", top: "15%",
              background: "linear-gradient(135deg, color-mix(in srgb, #059669 15%, transparent) 0%, color-mix(in srgb, var(--color-accent) 15%, transparent) 100%)", 
              backdropFilter: "blur(16px)", 
              border: "1px solid var(--color-border-subtle)"
            }}
          />

          {/* Center Glass Card */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.2, type: "spring" }}
            className="relative z-10 p-8 rounded-3xl glass shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] dark:shadow-none flex flex-col items-center border"
            style={{ borderColor: "var(--color-border)", minWidth: "260px" }}
          >
            {/* Document icon stack with file type labels */}
            <div className="flex gap-3 mb-6 relative">
              {([
                { label: "HWP", color: "var(--color-file-hwp)", bg: "var(--color-file-hwp-bg)", delay: 0 },
                { label: "PDF", color: "var(--color-file-pdf)", bg: "var(--color-file-pdf-bg)", delay: 0.5 },
                { label: "HWPX", color: "var(--color-file-hwp)", bg: "var(--color-file-hwp-bg)", delay: 1 },
              ] as const).map((f, i) => (
                <motion.div key={f.label}
                  animate={{ y: [0, i === 1 ? -8 : -5, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: f.delay }}
                  className={`w-14 h-[4.5rem] rounded-lg shadow-md border flex flex-col items-center justify-center gap-1 ${i === 1 ? "-translate-y-2 z-10" : "opacity-80"}`}
                  style={{ backgroundColor: "var(--color-bg-primary)", borderColor: i === 1 ? "var(--color-accent-light)" : "var(--color-border)" }}
                >
                  <FileText size={18} style={{ color: f.color }} />
                  <span className="text-[9px] font-bold tracking-wider" style={{ color: f.color }}>{f.label}</span>
                </motion.div>
              ))}
            </div>

            {/* Arrow → Markdown output */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-px" style={{ backgroundColor: "var(--color-border)" }} />
              <Sparkles size={16} style={{ color: "var(--color-accent)" }} />
              <div className="w-8 h-px" style={{ backgroundColor: "var(--color-border)" }} />
            </div>

            <div className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl" style={{ backgroundColor: "var(--color-accent-subtle)", border: "1px solid var(--color-accent-light)" }}>
              <FileText size={15} style={{ color: "var(--color-accent)" }} />
              <span className="ts-xs font-bold tracking-wide" style={{ color: "var(--color-accent)" }}>MARKDOWN</span>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
