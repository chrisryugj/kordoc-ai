import { useState, useCallback, useEffect } from "react";
import { SAVED_API_KEY_SENTINEL } from "../components/settings/SettingsModal";

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

  // Load saved settings from sidecar on startup
  useEffect(() => {
    if (sidecarReady && !apiKey) {
      sidecarCall("get_settings", {}).then((resp) => {
        const s = resp as { gemini?: { api_key?: string; model?: string; lite_model?: string; mode?: string } };
        const g = s?.gemini;
        if (g?.api_key) {
          setApiKey(SAVED_API_KEY_SENTINEL);
          setApiKeyMasked(g.api_key.length > 4 ? g.api_key.slice(0, 4) + "****" : "****");
        }
        if (g?.model) setOcrModel(g.model);
        if (g?.lite_model) setAnalysisModel(g.lite_model);
        if (g?.mode === "offline" || g?.mode === "online") setAiMode(g.mode);
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run when sidecar becomes ready
  }, [sidecarReady]);

  // Sync API key to sidecar when changed
  useEffect(() => {
    if (sidecarReady && apiKey && apiKey !== SAVED_API_KEY_SENTINEL && !isProcessing) {
      sidecarCall("update_settings", { settings: { gemini: { api_key: apiKey } } }).catch(() => {});
    }
  }, [sidecarReady, apiKey, isProcessing, sidecarCall]);

  // Sync model selections and mode to sidecar when changed
  useEffect(() => {
    if (sidecarReady && !isProcessing) {
      sidecarCall("update_settings", { settings: { gemini: { model: ocrModel, lite_model: analysisModel, mode: aiMode } } }).catch(() => {});
    }
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

  return {
    apiKey, apiKeyMasked, ocrModel, analysisModel, aiMode, outputDir, theme,
    setTheme, toggleAiMode, handleSettingsSave,
  };
}
