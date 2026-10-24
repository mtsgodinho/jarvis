import { GoogleGenAI } from '@google/genai';
import { JARVIS_SYSTEM_INSTRUCTIONS } from './system-instructions.mjs';
import { DEFAULT_PROVIDER_TIMEOUTS_MS } from './timeouts.mjs';

export async function generateGeminiResponse({ messages, systemPrompt = JARVIS_SYSTEM_INSTRUCTIONS, apiKey, model,
  signal, timeoutMs = DEFAULT_PROVIDER_TIMEOUTS_MS.gemini }) {
  const ai = new GoogleGenAI({ apiKey });
  const contents = messages.map(({ role, content }) => ({
    role: role === 'assistant' ? 'model' : role,
    parts: [{ text: content }],
  }));
  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: 'application/json',
      maxOutputTokens: 512,
      abortSignal: signal,
      httpOptions: { timeout: timeoutMs, retryOptions: { attempts: 1 } },
    },
  });
  if (typeof response.text !== 'string' || !response.text.trim()) {
    throw Object.assign(new Error('EMPTY_RESPONSE'), { code: 'EMPTY_RESPONSE' });
  }
  return response.text.trim();
}
