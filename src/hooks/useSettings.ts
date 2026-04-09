import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SAVED_API_KEY_SENTINEL } from "../components/settings/SettingsModal";
import { devLogInfo, devLogOk, devLogError } from "../utils/devlog";

export interface SettingsState {
  apiKey: string;
  apiKeyMasked: string;
  ocrModel: string;
  analysisModel: string;
  aiMode: "online" | "offline";
  outputDir: string;
  theme: "light" | "dark";
}

export interface UseSettingsReturn extends SettingsState {
  setTheme: (theme: "light" | "dark") => void;
  setOutputDir: (dir: string) => void;
  toggleAiMode: () => void;
  handleSettingsSave: (values: {
    apiKey: string;
    ocrModel: string;
    analysisModel: string;
    aiMode: "online" | "offline";
    outputDir: string;
    theme: "light" | "dark";
  }) => void;
}

type SidecarCall = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export function useSettings(sidecarReady: boolean, sidecarCall: SidecarCall, isProcessing: boolean): UseSettingsReturn {
  const [apiKey, setApiKey] = useState("");
  const [apiKeyMasked, setApiKeyMasked] = useState("");
  const [ocrModel, setOcrModel] = useState("gemini-3-flash-preview");
  const [analysisModel, setAnalysisModel] = useState("gemini-3-flash-preview");
  const [aiMode, setAiMode] = useState<"online" | "offline">("online");
  const [outputDir, setOutputDir] = useState(() => {
    try { return localStorage.getItem("kordoc-output-dir") || ""; } catch { return ""; }
  });
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem("kordoc-theme");
      return saved === "dark" ? "dark" : "light";
    } catch { return "light"; }
  });

  // Apply theme to document and persist
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try { localStorage.setItem("kordoc-theme", theme); } catch {}
  }, [theme]);

  // 초기 로드 완료 여부 — 로드 전 sync effect가 기본값을 덮어쓰는 것을 방지
  const settingsLoaded = useRef(false);

  // Load saved settings from sidecar + keychain on startup
  useEffect(() => {
    if (!sidecarReady || settingsLoaded.current) return;

    // keychain에서 API 키 상태 로드 + sidecar에 동기화
    invoke<{ exists: boolean; masked: string }>("load_api_key")
      .then((res) => {
        if (res.exists) {
          setApiKey(SAVED_API_KEY_SENTINEL);
          setApiKeyMasked(res.masked);
          devLogOk("keychain", `API 키 로드 (${res.masked})`);
          // keychain → sidecar 동기화 (Rust에서 직접 전달 — 레이스 방지)
          invoke<boolean>("sync_api_key_to_sidecar")
            .then((synced) => { if (synced) devLogOk("keychain", "API 키 → sidecar 동기화 완료"); })
            .catch((e) => devLogError("keychain", `sidecar 동기화 실패: ${e}`));
        } else {
          devLogInfo("API 키 미설정 — 설정에서 입력 필요");
        }
      })
      .catch(() => {});

    // sidecar에서 모델/모드 설정 로드
    sidecarCall("get_settings", {}).then((resp) => {
      const s = resp as { gemini?: { model?: string; lite_model?: string; mode?: string } };
      const g = s?.gemini;
      if (g?.model) setOcrModel(g.model);
      if (g?.lite_model) setAnalysisModel(g.lite_model);
      if (g?.mode === "offline" || g?.mode === "online") setAiMode(g.mode);
      settingsLoaded.current = true;
    }).catch(() => {
      settingsLoaded.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run when sidecar becomes ready
  }, [sidecarReady]);

  // Sync API key: keychain에 저장 + sidecar에 전달
  useEffect(() => {
    if (!sidecarReady || !apiKey || apiKey === SAVED_API_KEY_SENTINEL || isProcessing) return;
    // keychain에 저장 + sidecar에 전달
    invoke("store_api_key", { apiKey })
      .then(() => devLogOk("keychain", "API 키 저장 완료"))
      .catch((e) => devLogError("keychain", String(e)));
    sidecarCall("update_settings", { settings: { gemini: { api_key: apiKey } } })
      .then(() => devLogOk("update_settings", "API 키 sidecar 전달 완료"))
      .catch((e) => devLogError("update_settings", `API 키 sidecar 전달 실패: ${e}`));
  }, [sidecarReady, apiKey, isProcessing, sidecarCall]);

  // Sync model/mode to sidecar — 초기 로드 완료 후에만
  useEffect(() => {
    if (!sidecarReady || !settingsLoaded.current || isProcessing) return;
    sidecarCall("update_settings", { settings: { gemini: { model: ocrModel, lite_model: analysisModel, mode: aiMode } } })
      .then(() => devLogOk("update_settings", `모델 sync: ${ocrModel}, mode=${aiMode}`))
      .catch((e) => devLogError("update_settings", `모델 sync 실패: ${e}`));
  }, [sidecarReady, ocrModel, analysisModel, aiMode, isProcessing, sidecarCall]);

  const handleSettingsSave = useCallback((values: {
    apiKey: string;
    ocrModel: string;
    analysisModel: string;
    aiMode: "online" | "offline";
    outputDir: string;
    theme: "light" | "dark";
  }) => {
    if (values.apiKey !== apiKey) {
      setApiKey(values.apiKey);
      if (values.apiKey !== SAVED_API_KEY_SENTINEL) setApiKeyMasked("");
    }
    setOcrModel(values.ocrModel);
    setAnalysisModel(values.analysisModel);
    setAiMode(values.aiMode);
    if (values.outputDir !== outputDir) {
      setOutputDir(values.outputDir);
      try { localStorage.setItem("kordoc-output-dir", values.outputDir); } catch {}
    }
    setTheme(values.theme);
  }, [apiKey, outputDir]);

  const toggleAiMode = useCallback(() => {
    setAiMode((prev) => prev === "online" ? "offline" : "online");
  }, []);

  const updateOutputDir = useCallback((dir: string) => {
    setOutputDir(dir);
    try { localStorage.setItem("kordoc-output-dir", dir); } catch {}
  }, []);

  return {
    apiKey, apiKeyMasked, ocrModel, analysisModel, aiMode, outputDir, theme,
    setTheme, setOutputDir: updateOutputDir, toggleAiMode, handleSettingsSave,
  };
}
