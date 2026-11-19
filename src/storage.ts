import { Alert, Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { interpolateWordsForSegment } from './transcribe';
import type { Folder, Lesson, TranscriptSegment } from './types';

const WEB_LESSONS_KEY = 'transcritor_lessons_v1';
const WEB_FOLDERS_KEY = 'transcritor_folders_v1';

function getFoldersFile(): File {
  return new File(Paths.document, 'folders.json');
}

function getLessonsFile(): File {
  return new File(Paths.document, 'lessons.json');
}

function getLegacyRecordingsFile(): File {
  return new File(Paths.document, 'recordings.json');
}

export async function loadLessons(): Promise<Lesson[]> {
  try {
    if (Platform.OS === 'web') {
      const raw = globalThis.localStorage?.getItem(WEB_LESSONS_KEY);
      return raw ? (JSON.parse(raw) as Lesson[]) : [];
    }

    const file = getLessonsFile();
    if (file.exists) {
      const raw = await file.text();
      if (raw.trim()) return JSON.parse(raw) as Lesson[];
    }

    // Migrate legacy single-recording items if present
    const legacyFile = getLegacyRecordingsFile();
    if (legacyFile.exists) {
      const rawLegacy = await legacyFile.text();
      if (rawLegacy.trim()) {
        const legacyItems = JSON.parse(rawLegacy) as {
          id: string;
          title: string;
          createdAt: string;
          durationSec: number;
          audioUri: string;
          status: string;
          transcriptText?: string;
          segments?: { id: number; start: number; end: number; text: string }[];
        }[];
        const migrated: Lesson[] = legacyItems.map((item) => {
          const audioId = `${item.id}-audio`;
          const segments: TranscriptSegment[] = (item.segments ?? []).map((s, idx) => ({
            id: s.id ?? idx,
            start: s.start,
            end: s.end,
            text: s.text,
            words: interpolateWordsForSegment(s.id ?? idx, s.text, s.start, s.end),
          }));
          return {
            id: item.id,
            title: item.title,
            createdAt: item.createdAt,
            audios: [
              {
                id: audioId,
                title: 'Áudio 1',
                createdAt: item.createdAt,
                durationSec: item.durationSec,
                audioUri: item.audioUri,
              },
            ],
            transcriptions:
              item.status === 'done' && item.transcriptText
                ? [
                    {
                      id: `${item.id}-trans`,
                      audioId,
                      title: 'Áudio 1',
                      createdAt: item.createdAt,
                      status: 'done',
                      text: item.transcriptText,
                      segments,
                    },
                  ]
                : [],
          };
        });
        await saveLessons(migrated);
        return migrated;
      }
    }
    return [];
  } catch {
    return [];
  }
}

export async function saveLessons(lessons: Lesson[]): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(WEB_LESSONS_KEY, JSON.stringify(lessons));
    return;
  }
  const file = getLessonsFile();
  if (!file.exists) {
    file.create();
  }
  await file.write(JSON.stringify(lessons));
}

export async function getLessonById(id: string): Promise<Lesson | undefined> {
  const all = await loadLessons();
  return all.find((l) => l.id === id);
}

let writeQueue: Promise<unknown> = Promise.resolve();

function enqueueStorage<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export function upsertLesson(lesson: Lesson): Promise<Lesson[]> {
  return enqueueStorage(async () => {
    const all = await loadLessons();
    const idx = all.findIndex((l) => l.id === lesson.id);
    const next =
      idx >= 0 ? all.map((l) => (l.id === lesson.id ? lesson : l)) : [lesson, ...all];
    await saveLessons(next);
    return next;
  });
}

export function updateLessonById(
  id: string,
  updater: (current: Lesson) => Lesson
): Promise<Lesson | undefined> {
  return enqueueStorage(async () => {
    const all = await loadLessons();
    const target = all.find((l) => l.id === id);
    if (!target) return undefined;
    const updated = updater(target);
    const next = all.map((l) => (l.id === id ? updated : l));
    await saveLessons(next);
    return updated;
  });
}

export function deleteLesson(id: string): Promise<Lesson[]> {
  return enqueueStorage(async () => {
    const all = await loadLessons();
    const target = all.find((l) => l.id === id);
    if (target) {
      for (const audio of target.audios) {
        deleteAudioFile(audio.audioUri);
      }
    }
    const next = all.filter((l) => l.id !== id);
    await saveLessons(next);
    return next;
  });
}

export function deleteAudioFile(uri: string): void {
  if (!uri || Platform.OS === 'web') return;
  try {
    const audioFile = new File(uri);
    if (audioFile.exists) {
      audioFile.delete();
    }
  } catch {
    // Ignore if already deleted
  }
}

export async function loadFolders(): Promise<Folder[]> {
  try {
    if (Platform.OS === 'web') {
      const raw = globalThis.localStorage?.getItem(WEB_FOLDERS_KEY);
      return raw ? (JSON.parse(raw) as Folder[]) : [];
    }
    const file = getFoldersFile();
    if (!file.exists) return [];
    const raw = await file.text();
    return raw.trim() ? (JSON.parse(raw) as Folder[]) : [];
  } catch {
    return [];
  }
}

export async function saveFolders(folders: Folder[]): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(WEB_FOLDERS_KEY, JSON.stringify(folders));
    return;
  }
  const file = getFoldersFile();
  if (!file.exists) {
    file.create();
  }
  await file.write(JSON.stringify(folders));
}

export function upsertFolder(folder: Folder): Promise<Folder[]> {
  return enqueueStorage(async () => {
    const all = await loadFolders();
    const idx = all.findIndex((f) => f.id === folder.id);
    const next =
      idx >= 0 ? all.map((f) => (f.id === folder.id ? folder : f)) : [...all, folder];
    await saveFolders(next);
    return next;
  });
}

export function deleteFolder(id: string): Promise<{ folders: Folder[]; lessons: Lesson[] }> {
  return enqueueStorage(async () => {
    const allFolders = await loadFolders();
    const nextFolders = allFolders.filter((f) => f.id !== id);
    await saveFolders(nextFolders);

    const allLessons = await loadLessons();
    const nextLessons = allLessons.map((l) =>
      l.folderId === id ? { ...l, folderId: undefined } : l
    );
    await saveLessons(nextLessons);
    return { folders: nextFolders, lessons: nextLessons };
  });
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

export function confirmAction(
  title: string,
  message: string,
  confirmText: string,
  onConfirm: () => void
): void {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${title}\n\n${message}`)) {
      onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancelar', style: 'cancel' },
    { text: confirmText, style: 'destructive', onPress: onConfirm },
  ]);
}
