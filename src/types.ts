export type TranscriptWord = {
  id: string;
  word: string;
  start: number; // seconds
  end: number;   // seconds
};

export type TranscriptSegment = {
  id: number;
  start: number; // seconds
  end: number;   // seconds
  text: string;
  words: TranscriptWord[];
};

export type TranscriptionStatus = 'transcribing' | 'done' | 'error';

export type SessionTag = 'Aula' | 'Palestra' | 'Reunião' | 'Entrevista' | 'Outro';

export const SESSION_TAGS: SessionTag[] = [
  'Palestra',
  'Aula',
  'Reunião',
  'Entrevista',
  'Outro',
];

export type AudioBookmark = {
  id: string;
  audioId: string;
  timeSec: number;
  label: string;
  createdAt: string; // ISO string
};

export type LessonAudio = {
  id: string;
  title: string;
  createdAt: string; // ISO string
  durationSec: number;
  audioUri: string;
};

export type LessonTranscription = {
  id: string;
  audioId: string;
  title: string;
  createdAt: string; // ISO string
  status: TranscriptionStatus;
  errorMessage?: string;
  text: string;
  segments: TranscriptSegment[];
};

export type Folder = {
  id: string;
  name: string;
  createdAt: string; // ISO string
};

export type Lesson = {
  id: string;
  title: string;
  createdAt: string; // ISO string
  folderId?: string;
  tag?: SessionTag;
  audios: LessonAudio[];
  transcriptions: LessonTranscription[];
  bookmarks?: AudioBookmark[];
};
