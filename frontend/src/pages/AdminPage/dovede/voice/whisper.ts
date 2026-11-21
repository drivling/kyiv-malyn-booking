/**
 * «Доведе» · голос: Whisper у самому браузері через transformers.js (Docs/dovede-voice-roadmap.md, Ф1·1).
 *
 * Бібліотека підключається лише динамічним `import()` у `loadWhisper` — окремий чанк, який не завантажується, поки
 * адмін не натисне «Завантажити модель» (тест `noStaticTransformersImport.test.ts` стежить, щоб статичного імпорту
 * ніде не було). Модель лягає в Cache Storage браузера: друге відкриття вже без завантаження. Аудіо нікуди не йде.
 */

export type WhisperSize = 'base' | 'small';
export type WhisperMode = 'webgpu-fp16' | 'wasm-q8';

export const WHISPER_MODELS: Record<WhisperSize, { id: string; label: string }> = {
  base: { id: 'onnx-community/whisper-base', label: 'base' },
  small: { id: 'onnx-community/whisper-small', label: 'small' },
};

/** Розміри файлів моделі в МБ (з Hugging Face): enc + dec merged — fp16 для WebGPU, int8 для WASM */
export const WHISPER_MODES: Record<WhisperMode, { device: 'webgpu' | 'wasm'; dtype: 'fp16' | 'q8'; label: string; approxMb: Record<WhisperSize, number> }> = {
  'webgpu-fp16': { device: 'webgpu', dtype: 'fp16', label: 'WebGPU · fp16', approxMb: { base: 146, small: 485 } },
  'wasm-q8': { device: 'wasm', dtype: 'q8', label: 'WASM · q8 (менше, повільніше)', approxMb: { base: 77, small: 249 } },
};

export function defaultWhisperMode(): WhisperMode {
  return typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu-fp16' : 'wasm-q8';
}

export interface LoadProgress {
  loadedMb: number;
  totalMb: number;
}

type Asr = (audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text: string }>;

const loaded = new Map<string, Promise<Asr>>();
const cacheKey = (size: WhisperSize, mode: WhisperMode): string => `${size}:${mode}`;

export function isWhisperLoaded(size: WhisperSize, mode: WhisperMode): boolean {
  return loaded.has(cacheKey(size, mode));
}

/** Завантажує (чи бере з кешу браузера) модель; `onProgress` — сумарно по всіх файлах */
export function loadWhisper(size: WhisperSize, mode: WhisperMode, onProgress?: (p: LoadProgress) => void): Promise<void> {
  const key = cacheKey(size, mode);
  let promise = loaded.get(key);
  if (!promise) {
    promise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.allowLocalModels = false;
      const files = new Map<string, { loaded: number; total: number }>();
      const m = WHISPER_MODES[mode];
      const asr = await pipeline('automatic-speech-recognition', WHISPER_MODELS[size].id, {
        device: m.device,
        dtype: m.dtype,
        progress_callback: (e: { status?: string; file?: string; loaded?: number; total?: number }) => {
          if (e.status !== 'progress' || !e.file || !e.total) return;
          files.set(e.file, { loaded: e.loaded ?? 0, total: e.total });
          let l = 0;
          let t = 0;
          files.forEach((f) => {
            l += f.loaded;
            t += f.total;
          });
          onProgress?.({ loadedMb: l / 1e6, totalMb: t / 1e6 });
        },
      });
      return asr as unknown as Asr;
    })();
    loaded.set(key, promise);
    promise.catch(() => loaded.delete(key));
  }
  return promise.then(() => undefined);
}

/** Звук → 16 кГц моно, як чекає Whisper */
export async function decodeAudio16kMono(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const target = 16000;
    const frames = Math.max(1, Math.ceil(decoded.duration * target));
    const offline = new OfflineAudioContext(1, frames, target);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    void ctx.close();
  }
}

export async function transcribeWhisper(size: WhisperSize, mode: WhisperMode, blob: Blob): Promise<{ text: string; ms: number }> {
  await loadWhisper(size, mode);
  const asr = await loaded.get(cacheKey(size, mode))!;
  const audio = await decodeAudio16kMono(blob);
  const t0 = performance.now();
  const out = await asr(audio, { language: 'ukrainian', task: 'transcribe' });
  return { text: (out.text ?? '').trim(), ms: Math.round(performance.now() - t0) };
}
