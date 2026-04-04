import { describe, it, expect, vi, beforeEach } from 'vitest';

// config mock — gemini 설정 반환
vi.mock('../src/infra/config.js', () => ({
  getConfig: (section: string) => {
    if (section === 'gemini') {
      return {
        model: 'gemini-2.5-flash-preview-05-20',
        lite_model: 'gemini-2.0-flash-lite',
        api_key: 'test-key',
        proxy_url: '',
        max_retries: 2,
        timeout_ms: 5000,
        mode: 'online',
      };
    }
    return {};
  },
}));

// @google/generative-ai mock
const mockGenerateContent = vi.fn();
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({
      generateContent: mockGenerateContent,
    }),
  })),
}));

describe('Gemini client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // resetClient를 위해 매번 새로 import
  });

  it('성공 응답 반환', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => 'Hello from Gemini' },
    });

    const { callGemini, resetClient } = await import('../src/infra/gemini.js');
    resetClient();

    const result = await callGemini({ prompt: 'test' });
    expect(result).toBe('Hello from Gemini');
    expect(mockGenerateContent).toHaveBeenCalledOnce();
  });

  it('재시도 후 성공', async () => {
    mockGenerateContent
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValueOnce({
        response: { text: () => 'Retry success' },
      });

    const { callGemini, resetClient } = await import('../src/infra/gemini.js');
    resetClient();

    const result = await callGemini({ prompt: 'test' });
    expect(result).toBe('Retry success');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  }, 30_000);

  it('AbortSignal로 취소', async () => {
    const ac = new AbortController();
    ac.abort();

    const { callGemini, resetClient } = await import('../src/infra/gemini.js');
    resetClient();

    await expect(callGemini({ prompt: 'test', signal: ac.signal }))
      .rejects.toThrow('Aborted');
  });

  it('Vision API 호출 (멀티모달)', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => 'OCR 결과 텍스트' },
    });

    const { callGeminiVision, resetClient } = await import('../src/infra/gemini.js');
    resetClient();

    const result = await callGeminiVision({
      prompt: 'OCR',
      imageBase64: 'dGVzdA==', // "test" base64
      mimeType: 'image/png',
    });
    expect(result).toBe('OCR 결과 텍스트');
    // generateContent에 이미지 파트가 포함되었는지 확인 (2번째 인자는 requestOptions)
    expect(mockGenerateContent).toHaveBeenCalledWith(
      ['OCR', { inlineData: { data: 'dGVzdA==', mimeType: 'image/png' } }],
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it('오프라인 모드 차단', async () => {
    // 기존 mock의 getConfig를 offline 모드로 임시 변경
    const configModule = await import('../src/infra/config.js');
    const original = configModule.getConfig;
    // @ts-expect-error -- override mock for this test
    configModule.getConfig = () => ({
      model: 'gemini-2.5-flash-preview-05-20',
      lite_model: 'gemini-2.0-flash-lite',
      api_key: 'test-key',
      proxy_url: '',
      max_retries: 2,
      timeout_ms: 5000,
      mode: 'offline',
    });

    const { callGemini, resetClient } = await import('../src/infra/gemini.js');
    resetClient();

    await expect(callGemini({ prompt: 'test' }))
      .rejects.toThrow('offline');

    // 복원
    configModule.getConfig = original;
  });
});
