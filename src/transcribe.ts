import { Platform } from 'react-native';
import type { TranscriptSegment, TranscriptWord } from './types';

export type TranscriptionResult = {
  text: string;
  segments: TranscriptSegment[];
  cancelled?: boolean;
};

type NativeWhisperContext = {
  transcribe: (
    filePath: string,
    options?: { language?: string; onProgress?: (progress: number) => void }
  ) => {
    stop: () => Promise<void>;
    promise: Promise<{
      isAborted?: boolean;
      result?: string;
      segments?: { t0: number; t1: number; text: string }[];
    }>;
  };
  release: () => Promise<void>;
};

let activeContext: NativeWhisperContext | null = null;
let activeStopFn: (() => Promise<void>) | null = null;
let cancelRequested = false;
let isTranscribing = false;

export async function cancelActiveTranscription(): Promise<void> {
  cancelRequested = true;
  if (activeStopFn) {
    try {
      await activeStopFn();
    } catch {
      // Ignore abort errors if already finished
    }
  }
}

export async function releaseWhisperIfLoaded(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (activeStopFn) {
    try {
      await activeStopFn();
    } catch {
      // Ignore abort errors
    }
    activeStopFn = null;
  }
  if (activeContext) {
    const ctx = activeContext;
    activeContext = null;
    try {
      await ctx.release();
    } catch {
      // Ignore release errors on shutdown
    }
  }
}

export function interpolateWordsForSegment(
  segmentId: number,
  text: string,
  start: number,
  end: number
): TranscriptWord[] {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return [];
  const span = Math.max(0.2, end - start);
  const step = span / tokens.length;
  return tokens.map((word, idx) => ({
    id: `${segmentId}-w-${idx}`,
    word,
    start: Number((start + idx * step).toFixed(2)),
    end: Number((start + (idx + 1) * step).toFixed(2)),
  }));
}

export async function transcribeOffline(
  audioUri: string,
  onProgress?: (progress: number) => void
): Promise<TranscriptionResult> {
  if (Platform.OS === 'web') {
    throw new Error(
      'A transcrição 100% offline funciona apenas no app nativo (Android/iOS).'
    );
  }
  if (isTranscribing) {
    throw new Error('Já existe uma transcrição em andamento.');
  }

  isTranscribing = true;
  cancelRequested = false;
  onProgress?.(0);

  try {
    const g = globalThis as { Buffer?: unknown };
    if (typeof g.Buffer === 'undefined') {
      const { Buffer } = await import('buffer');
      g.Buffer = Buffer;
    }

    // @ts-expect-error whisper.rn ships types under lib/typescript without package.json types field
    const { initWhisper } = await import('whisper.rn');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bundledModel = require('../assets/models/ggml-base.bin') as number;

    activeContext = (await initWhisper({ filePath: bundledModel })) as NativeWhisperContext;

    if (cancelRequested) {
      return { text: '', segments: [], cancelled: true };
    }

    const task = activeContext.transcribe(audioUri, {
      language: 'pt',
      onProgress: (p: number) => {
        const clamped = Math.max(0, Math.min(100, Math.round(p)));
        onProgress?.(clamped);
      },
    });
    activeStopFn = task.stop;

    const res = await task.promise;
    if (cancelRequested || res.isAborted) {
      return { text: '', segments: [], cancelled: true };
    }

    const segments: TranscriptSegment[] = (res.segments ?? [])
      .map((seg, idx) => {
        const start = Number((seg.t0 / 100).toFixed(2));
        const end = Number((seg.t1 / 100).toFixed(2));
        const text = seg.text.trim();
        return {
          id: idx,
          start,
          end: Math.max(start + 0.2, end),
          text,
          words: interpolateWordsForSegment(idx, text, start, Math.max(start + 0.2, end)),
        };
      })
      .filter((s: TranscriptSegment) => s.text.length > 0);

    onProgress?.(100);
    return {
      text: (res.result ?? '').trim(),
      segments,
    };
  } finally {
    activeStopFn = null;
    await releaseWhisperIfLoaded();
    isTranscribing = false;
  }
}
