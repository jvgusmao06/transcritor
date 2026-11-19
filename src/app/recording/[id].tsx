import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
  useAudioStream,
} from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  confirmAction,
  deleteAudioFile,
  formatDuration,
  getLessonById,
  updateLessonById,
} from '../../storage';
import {
  cancelActiveTranscription,
  interpolateWordsForSegment,
  transcribeOffline,
} from '../../transcribe';
import {
  SESSION_TAGS,
  type AudioBookmark,
  type Lesson,
  type LessonAudio,
  type LessonTranscription,
  type SessionTag,
  type TranscriptSegment,
  type TranscriptWord,
} from '../../types';

const SPEEDS = [1, 1.25, 1.5, 2] as const;

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const [titleDraft, setTitleDraft] = useState('');
  const [audioTitleDraft, setAudioTitleDraft] = useState('');
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  const [selectedTranscriptionId, setSelectedTranscriptionId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [speedIdx, setSpeedIdx] = useState(0);
  const [transcribingAudioId, setTranscribingAudioId] = useState<string | null>(null);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [isRecordingNative, setIsRecordingNative] = useState(false);
  const [nativeRecSec, setNativeRecSec] = useState(0);
  const [pendingRecBookmarkCount, setPendingRecBookmarkCount] = useState(0);

  // Word / Segment / Bookmark editing state
  const [editMode, setEditMode] = useState(false);
  const [editingWord, setEditingWord] = useState<{
    segmentId: number;
    wordId: string;
    value: string;
  } | null>(null);
  const [editingSegment, setEditingSegment] = useState<{
    segmentId: number;
    value: string;
  } | null>(null);
  const [editingBookmark, setEditingBookmark] = useState<{
    id: string;
    value: string;
  } | null>(null);

  const pendingSeekRef = useRef<number | null>(null);
  const pendingRecBookmarksRef = useRef<{ timeSec: number; label: string }[]>([]);
  const { stream } = useAudioStream({
    sampleRate: 16000,
    channels: 1,
    encoding: 'int16',
  });
  const webRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const webRecorderState = useAudioRecorderState(webRecorder, 250);

  const isRecording = Platform.OS === 'web' ? webRecorderState.isRecording : isRecordingNative;
  const recordingSec =
    Platform.OS === 'web'
      ? Math.floor((webRecorderState.durationMillis ?? 0) / 1000)
      : nativeRecSec;

  const selectedAudio = useMemo(
    () => lesson?.audios.find((a) => a.id === selectedAudioId) ?? lesson?.audios[0] ?? null,
    [lesson?.audios, selectedAudioId]
  );

  const selectedTranscription = useMemo(() => {
    if (!lesson) return null;
    if (selectedTranscriptionId) {
      const found = lesson.transcriptions.find((t) => t.id === selectedTranscriptionId);
      if (found) return found;
    }
    if (selectedAudio) {
      const forAudio = lesson.transcriptions.find((t) => t.audioId === selectedAudio.id);
      if (forAudio) return forAudio;
    }
    return lesson.transcriptions[0] ?? null;
  }, [lesson, selectedTranscriptionId, selectedAudio]);

  const audioBookmarks = useMemo(() => {
    if (!lesson?.bookmarks || !selectedAudio) return [];
    return lesson.bookmarks
      .filter((b) => b.audioId === selectedAudio.id)
      .sort((a, b) => a.timeSec - b.timeSec);
  }, [lesson, selectedAudio]);

  const player = useAudioPlayer(selectedAudio?.audioUri ?? null, { updateInterval: 150 });
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      allowsRecording: false,
      interruptionMode: 'doNotMix',
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isRecordingNative) return;
    const timer = setInterval(() => {
      setNativeRecSec((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isRecordingNative]);

  useEffect(() => {
    return () => {
      if (Platform.OS !== 'web' && stream.isStreaming) {
        stream.stop();
      }
    };
  }, [stream]);

  useEffect(() => {
    if (!id) return;
    getLessonById(id).then((found) => {
      if (found) {
        setLesson(found);
        setTitleDraft(found.title);
        if (found.audios[0]) setSelectedAudioId(found.audios[0].id);
        if (found.transcriptions[0]) setSelectedTranscriptionId(found.transcriptions[0].id);
      } else {
        setNotFound(true);
      }
    });
  }, [id]);

  useLayoutEffect(() => {
    if (lesson?.title) {
      navigation.setOptions({ title: lesson.title });
    }
  }, [lesson?.title, navigation]);

  useEffect(() => {
    if (!status.isLoaded) return;
    player.setPlaybackRate(SPEEDS[speedIdx]);
    if (pendingSeekRef.current !== null) {
      const target = pendingSeekRef.current;
      pendingSeekRef.current = null;
      player.seekTo(target);
      player.setActiveForLockScreen(true, {
        title: `${lesson?.title ?? 'Sessão'} - ${selectedAudio?.title ?? ''}`,
      });
      player.play();
    }
  }, [status.isLoaded, selectedAudio?.id, selectedAudio?.title, lesson?.title, player, speedIdx]);

  const applyLessonUpdate = async (updater: (current: Lesson) => Lesson) => {
    if (!lesson) return;
    const updated = await updateLessonById(lesson.id, updater);
    if (updated) setLesson(updated);
  };

  const handleSaveTitle = async () => {
    if (!lesson) return;
    const trimmed = titleDraft.trim() || lesson.title;
    setTitleDraft(trimmed);
    if (trimmed === lesson.title) return;
    await applyLessonUpdate((cur) => ({ ...cur, title: trimmed }));
  };

  const handleSelectTag = async (tag: SessionTag) => {
    if (!lesson) return;
    const nextTag = lesson.tag === tag ? undefined : tag;
    await applyLessonUpdate((cur) => ({ ...cur, tag: nextTag }));
  };

  const handleSaveAudioTitle = async () => {
    if (!lesson || !selectedAudio) return;
    const trimmed = audioTitleDraft.trim() || selectedAudio.title;
    setAudioTitleDraft(trimmed);
    if (trimmed === selectedAudio.title) return;
    const targetAudioId = selectedAudio.id;
    await applyLessonUpdate((cur) => ({
      ...cur,
      audios: cur.audios.map((a) =>
        a.id === targetAudioId ? { ...a, title: trimmed } : a
      ),
      transcriptions: cur.transcriptions.map((t) =>
        t.audioId === targetAudioId ? { ...t, title: trimmed } : t
      ),
    }));
  };

  const handleSelectAudio = (audio: LessonAudio) => {
    setSelectedAudioId(audio.id);
    setAudioTitleDraft(audio.title);
    const matchingTrans = lesson?.transcriptions.find((t) => t.audioId === audio.id);
    setSelectedTranscriptionId(matchingTrans?.id ?? null);
    setEditingWord(null);
    setEditingSegment(null);
    setEditingBookmark(null);
  };

  const handleAddRecordingBookmark = () => {
    const idx = pendingRecBookmarksRef.current.length + 1;
    pendingRecBookmarksRef.current.push({
      timeSec: recordingSec,
      label: `Momento ${idx}`,
    });
    setPendingRecBookmarkCount(pendingRecBookmarksRef.current.length);
  };

  const handleAddPlaybackBookmark = async () => {
    if (!lesson || !selectedAudio) return;
    const timeSec = Math.max(0, Math.floor(status.currentTime));
    const count = audioBookmarks.length + 1;
    const newBookmark: AudioBookmark = {
      id: `bm-${Date.now()}`,
      audioId: selectedAudio.id,
      timeSec,
      label: `Momento ${count}`,
      createdAt: new Date().toISOString(),
    };
    await applyLessonUpdate((cur) => ({
      ...cur,
      bookmarks: [...(cur.bookmarks ?? []), newBookmark],
    }));
  };

  const saveBookmarkEdit = async () => {
    if (!lesson || !editingBookmark) return;
    const trimmed = editingBookmark.value.trim();
    const targetId = editingBookmark.id;
    await applyLessonUpdate((cur) => ({
      ...cur,
      bookmarks: trimmed
        ? (cur.bookmarks ?? []).map((b) =>
            b.id === targetId ? { ...b, label: trimmed } : b
          )
        : (cur.bookmarks ?? []).filter((b) => b.id !== targetId),
    }));
    setEditingBookmark(null);
  };

  const handleDeleteBookmark = (bm: AudioBookmark) => {
    confirmAction('Remover marcador?', `Remover "${bm.label}" (${formatDuration(bm.timeSec)})?`, 'Remover', async () => {
      await applyLessonUpdate((cur) => ({
        ...cur,
        bookmarks: (cur.bookmarks ?? []).filter((b) => b.id !== bm.id),
      }));
      if (editingBookmark?.id === bm.id) setEditingBookmark(null);
    });
  };

  const startRecordingAudio = async () => {
    if (!lesson || isRecording) return;
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Permissão necessária',
          'Permita o acesso ao microfone para gravar o áudio.'
        );
        return;
      }

      if (status.playing) {
        player.pause();
      }

      pendingRecBookmarksRef.current = [];
      setPendingRecBookmarkCount(0);

      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        allowsBackgroundRecording: true,
      });

      if (Platform.OS === 'web') {
        await webRecorder.prepareToRecordAsync();
        webRecorder.record();
      } else {
        setNativeRecSec(0);
        await stream.start();
        await stream.startFileRecordingAsync({ format: 'wav', directory: 'document' });
        setIsRecordingNative(true);
      }
    } catch (err) {
      setIsRecordingNative(false);
      if (Platform.OS !== 'web' && stream.isStreaming) {
        stream.stop();
      }
      Alert.alert(
        'Erro ao gravar',
        err instanceof Error ? err.message : 'Não foi possível iniciar a gravação.'
      );
    }
  };

  const stopRecordingAudio = async () => {
    if (!lesson || !isRecording) return;
    try {
      let uri: string | null = null;
      let durationSec = recordingSec;

      if (Platform.OS === 'web') {
        durationSec = Math.round((webRecorderState.durationMillis ?? 0) / 1000);
        await webRecorder.stop();
        uri = webRecorder.uri;
      } else {
        const result = await stream.stopFileRecordingAsync();
        stream.stop();
        setIsRecordingNative(false);
        uri = result.uri;
        durationSec = Math.max(nativeRecSec, Math.round(result.duration));
      }

      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
      });

      if (!uri) {
        Alert.alert('Erro', 'Não foi possível salvar o áudio gravado.');
        return;
      }

      const audioId = `audio-${Date.now()}`;
      const nowIso = new Date().toISOString();
      const recordedBookmarks: AudioBookmark[] = pendingRecBookmarksRef.current.map(
        (b, idx) => ({
          id: `bm-${Date.now()}-${idx}`,
          audioId,
          timeSec: b.timeSec,
          label: b.label,
          createdAt: nowIso,
        })
      );
      pendingRecBookmarksRef.current = [];
      setPendingRecBookmarkCount(0);

      let createdAudio: LessonAudio | null = null;

      await applyLessonUpdate((cur) => {
        const nextNum = cur.audios.length + 1;
        createdAudio = {
          id: audioId,
          title: `Áudio ${nextNum}`,
          createdAt: nowIso,
          durationSec,
          audioUri: uri,
        };
        return {
          ...cur,
          audios: [...cur.audios, createdAudio],
          bookmarks: [...(cur.bookmarks ?? []), ...recordedBookmarks],
        };
      });

      if (createdAudio) {
        setSelectedAudioId(audioId);
        setAudioTitleDraft((createdAudio as LessonAudio).title);
        setSelectedTranscriptionId(null);
      }
    } catch (err) {
      setIsRecordingNative(false);
      Alert.alert(
        'Erro ao parar gravação',
        err instanceof Error ? err.message : 'Falha ao finalizar áudio.'
      );
    }
  };

  const handleImportAudio = async () => {
    if (!lesson || isRecording) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/wav', 'audio/x-wav', 'audio/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const fileName = asset.name || `importado-${Date.now()}.wav`;
      const isWav =
        fileName.toLowerCase().endsWith('.wav') ||
        (asset.mimeType ?? '').toLowerCase().includes('wav');

      if (!isWav) {
        Alert.alert(
          'Formato incompatível com IA offline',
          'A transcrição offline aceita apenas arquivos .wav (PCM 16-bit). Selecione um arquivo .wav.'
        );
        return;
      }

      let finalUri = asset.uri;
      if (Platform.OS !== 'web') {
        const safeName = `imported-${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const dest = new File(Paths.document, safeName);
        new File(asset.uri).copy(dest);
        finalUri = dest.uri;
      }

      const audioId = `audio-${Date.now()}`;
      const cleanTitle = fileName.replace(/\.[^.]+$/, '') || 'Áudio importado';
      const newAudio: LessonAudio = {
        id: audioId,
        title: cleanTitle,
        createdAt: new Date().toISOString(),
        durationSec: 0,
        audioUri: finalUri,
      };

      await applyLessonUpdate((cur) => ({
        ...cur,
        audios: [...cur.audios, newAudio],
      }));
      setSelectedAudioId(audioId);
      setAudioTitleDraft(cleanTitle);
      setSelectedTranscriptionId(null);
    } catch (err) {
      Alert.alert(
        'Erro ao importar',
        err instanceof Error ? err.message : 'Não foi possível importar o arquivo.'
      );
    }
  };

  const handleDeleteAudio = (audio: LessonAudio) => {
    if (!lesson) return;
    confirmAction(
      'Remover áudio?',
      `Deseja remover "${audio.title}", suas transcrições e marcadores?`,
      'Remover',
      async () => {
        deleteAudioFile(audio.audioUri);
        await applyLessonUpdate((cur) => ({
          ...cur,
          audios: cur.audios.filter((a) => a.id !== audio.id),
          transcriptions: cur.transcriptions.filter((t) => t.audioId !== audio.id),
          bookmarks: (cur.bookmarks ?? []).filter((b) => b.audioId !== audio.id),
        }));
        if (selectedAudioId === audio.id) {
          const remaining = lesson.audios.filter((a) => a.id !== audio.id);
          setSelectedAudioId(remaining[0]?.id ?? null);
        }
      }
    );
  };

  const handleTranscribeAudio = async (audio: LessonAudio) => {
    if (!lesson || transcribingAudioId !== null) return;

    setTranscribingAudioId(audio.id);
    setTranscribeProgress(0);
    const newTransId = `trans-${Date.now()}`;
    const placeholder: LessonTranscription = {
      id: newTransId,
      audioId: audio.id,
      title: audio.title,
      createdAt: new Date().toISOString(),
      status: 'transcribing',
      text: '',
      segments: [],
    };

    await applyLessonUpdate((cur) => ({
      ...cur,
      transcriptions: [placeholder, ...cur.transcriptions],
    }));
    setSelectedTranscriptionId(newTransId);
    setSelectedAudioId(audio.id);

    try {
      const result = await transcribeOffline(audio.audioUri, setTranscribeProgress);
      if (result.cancelled) {
        await applyLessonUpdate((cur) => ({
          ...cur,
          transcriptions: cur.transcriptions.filter((t) => t.id !== newTransId),
        }));
        setSelectedTranscriptionId(null);
        return;
      }

      await applyLessonUpdate((cur) => ({
        ...cur,
        transcriptions: cur.transcriptions.map((t) =>
          t.id === newTransId
            ? { ...t, status: 'done', text: result.text, segments: result.segments }
            : t
        ),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      await applyLessonUpdate((cur) => ({
        ...cur,
        transcriptions: cur.transcriptions.map((t) =>
          t.id === newTransId ? { ...t, status: 'error', errorMessage: msg } : t
        ),
      }));
      Alert.alert('Erro na transcrição', msg);
    } finally {
      setTranscribingAudioId(null);
      setTranscribeProgress(0);
    }
  };

  const handleSelectTranscription = (trans: LessonTranscription) => {
    setSelectedTranscriptionId(trans.id);
    if (trans.audioId && trans.audioId !== selectedAudio?.id) {
      setSelectedAudioId(trans.audioId);
    }
    setEditingWord(null);
    setEditingSegment(null);
  };

  const handleDeleteTranscription = (trans: LessonTranscription) => {
    if (!lesson) return;
    confirmAction('Excluir transcrição?', `Remover "${trans.title}"?`, 'Excluir', async () => {
      setEditingWord(null);
      setEditingSegment(null);
      setSearch('');
      await applyLessonUpdate((cur) => ({
        ...cur,
        transcriptions: cur.transcriptions.filter((t) => t.id !== trans.id),
      }));
      if (selectedTranscriptionId === trans.id) {
        const remaining = lesson.transcriptions.filter((t) => t.id !== trans.id);
        setSelectedTranscriptionId(remaining[0]?.id ?? null);
      }
    });
  };

  const seekAndPlayTime = (seconds: number, targetAudioId?: string) => {
    const safeTime = Math.max(0, seconds);
    if (targetAudioId && targetAudioId !== selectedAudio?.id) {
      pendingSeekRef.current = safeTime;
      setSelectedAudioId(targetAudioId);
      return;
    }
    player.seekTo(safeTime);
    if (!status.playing) {
      player.setActiveForLockScreen(true, {
        title: `${lesson?.title ?? 'Sessão'} - ${selectedAudio?.title ?? ''}`,
      });
      player.play();
    }
  };

  const handlePressWord = (seg: TranscriptSegment, word: TranscriptWord) => {
    if (editMode) {
      setEditingSegment(null);
      setEditingWord({
        segmentId: seg.id,
        wordId: word.id,
        value: word.word,
      });
      return;
    }
    seekAndPlayTime(word.start, selectedTranscription?.audioId);
  };

  const handleLongPressWord = (seg: TranscriptSegment, word: TranscriptWord) => {
    setEditingSegment(null);
    setEditingWord({
      segmentId: seg.id,
      wordId: word.id,
      value: word.word,
    });
  };

  const saveWordEdit = async () => {
    if (!lesson || !selectedTranscription || !editingWord) return;
    const tokens = editingWord.value.trim().split(/\s+/).filter(Boolean);
    const targetTransId = selectedTranscription.id;
    const { segmentId, wordId } = editingWord;

    await applyLessonUpdate((cur) => ({
      ...cur,
      transcriptions: cur.transcriptions.map((t) => {
        if (t.id !== targetTransId) return t;
        const updatedSegments = t.segments
          .map((seg) => {
            if (seg.id !== segmentId) return seg;
            const updatedWords: TranscriptWord[] = [];
            for (const w of seg.words) {
              if (w.id !== wordId) {
                updatedWords.push(w);
              } else if (tokens.length === 1) {
                updatedWords.push({ ...w, word: tokens[0] });
              } else if (tokens.length > 1) {
                const span = Math.max(0.1, w.end - w.start);
                const step = span / tokens.length;
                tokens.forEach((tok, idx) => {
                  updatedWords.push({
                    id: `${wordId}-${idx}`,
                    word: tok,
                    start: Number((w.start + idx * step).toFixed(2)),
                    end: Number((w.start + (idx + 1) * step).toFixed(2)),
                  });
                });
              }
            }
            return {
              ...seg,
              text: updatedWords.map((w) => w.word).join(' '),
              words: updatedWords,
            };
          })
          .filter((seg) => seg.words.length > 0);
        return {
          ...t,
          text: updatedSegments.map((s) => s.text).join(' '),
          segments: updatedSegments,
        };
      }),
    }));
    setEditingWord(null);
  };

  const saveSegmentEdit = async () => {
    if (!lesson || !selectedTranscription || !editingSegment) return;
    const trimmed = editingSegment.value.trim();
    const targetTransId = selectedTranscription.id;
    const { segmentId } = editingSegment;

    await applyLessonUpdate((cur) => ({
      ...cur,
      transcriptions: cur.transcriptions.map((t) => {
        if (t.id !== targetTransId) return t;
        const updatedSegments = t.segments
          .map((seg) => {
            if (seg.id !== segmentId) return seg;
            return {
              ...seg,
              text: trimmed,
              words: interpolateWordsForSegment(seg.id, trimmed, seg.start, seg.end),
            };
          })
          .filter((seg) => seg.text.length > 0);
        return {
          ...t,
          text: updatedSegments.map((s) => s.text).join(' '),
          segments: updatedSegments,
        };
      }),
    }));
    setEditingSegment(null);
  };

  const togglePlay = () => {
    if (!selectedAudio) return;
    if (status.playing) {
      player.pause();
    } else {
      player.setActiveForLockScreen(true, {
        title: `${lesson?.title ?? 'Sessão'} - ${selectedAudio.title}`,
      });
      player.play();
    }
  };

  const seekBy = (deltaSec: number) => {
    const target = Math.max(0, Math.min(status.duration || 0, status.currentTime + deltaSec));
    player.seekTo(target);
  };

  const cycleSpeed = () => {
    const nextIdx = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(nextIdx);
    player.setPlaybackRate(SPEEDS[nextIdx]);
  };

  const handleShareText = async () => {
    if (!selectedTranscription?.text) return;
    try {
      await Share.share({
        title: `${lesson?.title} - ${selectedTranscription.title}`,
        message: `${lesson?.title} (${selectedTranscription.title})\n\n${selectedTranscription.text}`,
      });
    } catch {
      // Ignore share cancellation/error
    }
  };

  const filteredSegments = useMemo(() => {
    const segments = selectedTranscription?.segments ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return segments;
    return segments.filter((s) => s.text.toLowerCase().includes(q));
  }, [selectedTranscription?.segments, search]);

  if (notFound) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={40} color="#94A3B8" />
        <Text style={styles.emptyTranscriptTitle}>Sessão não encontrada</Text>
        <Pressable
          style={({ pressed }) => [styles.editSaveBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          onPress={() => router.back()}
        >
          <Text style={styles.editSaveBtnText}>Voltar</Text>
        </Pressable>
      </View>
    );
  }

  if (!lesson) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  const totalDur =
    status.duration > 0 ? status.duration : (selectedAudio?.durationSec ?? 0);
  const progressPct = totalDur > 0 ? Math.min(100, (status.currentTime / totalDur) * 100) : 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Top: Session Title + Tags + Audios list + Player */}
      <View style={styles.topSection}>
        <TextInput
          style={styles.titleInput}
          value={titleDraft}
          onChangeText={setTitleDraft}
          onBlur={handleSaveTitle}
          onSubmitEditing={handleSaveTitle}
          placeholder="Título da sessão"
          placeholderTextColor="#64748B"
          returnKeyType="done"
        />

        {/* Category Tags */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsScroll}
        >
          {SESSION_TAGS.map((tag) => {
            const active = lesson.tag === tag;
            return (
              <Pressable
                key={tag}
                style={({ pressed }) => [
                  styles.tagChip,
                  active && styles.tagChipActive,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                onPress={() => handleSelectTag(tag)}
              >
                <Text style={[styles.tagChipText, active && styles.tagChipTextActive]}>
                  {tag}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Section 1: Audios of this Session */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>
            ÁUDIOS DA SESSÃO ({lesson.audios.length})
          </Text>
          <View style={styles.audioHeaderActions}>
            {isRecording ? (
              <>
                <Pressable
                  style={({ pressed }) => [styles.bookmarkRecBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Marcar momento importante durante gravação"
                  onPress={handleAddRecordingBookmark}
                >
                  <Ionicons name="bookmark" size={14} color="#FDE68A" />
                  <Text style={styles.bookmarkRecText}>
                    Marcar{pendingRecBookmarkCount > 0 ? ` (${pendingRecBookmarkCount})` : ''}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.stopRecSmallBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  onPress={stopRecordingAudio}
                >
                  <View style={styles.whiteDot} />
                  <Text style={styles.stopRecSmallText}>
                    Parar ({formatDuration(recordingSec)})
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  style={({ pressed }) => [styles.importAudioBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Importar arquivo de áudio WAV"
                  onPress={handleImportAudio}
                >
                  <Ionicons name="cloud-upload-outline" size={15} color="#93C5FD" />
                  <Text style={styles.importAudioBtnText}>Importar .wav</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.addAudioBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  onPress={startRecordingAudio}
                >
                  <Ionicons name="mic" size={15} color="#FFFFFF" />
                  <Text style={styles.addAudioBtnText}>Gravar</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>

        {lesson.audios.length === 0 ? (
          <View style={styles.emptyAudiosBox}>
            <Text style={styles.emptyAudiosText}>
              Nenhum áudio nesta sessão. Grave ou importe um arquivo .wav acima.
            </Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsScroll}
          >
            {lesson.audios.map((audio) => {
              const isSelected = selectedAudio?.id === audio.id;
              const isTranscribingThis = transcribingAudioId === audio.id;
              return (
                <View
                  key={audio.id}
                  style={[styles.audioPill, isSelected && styles.audioPillSelected]}
                >
                  <Pressable
                    style={({ pressed }) => [styles.audioPillMain, pressed && styles.pressed]}
                    onPress={() => handleSelectAudio(audio)}
                    onLongPress={() => handleDeleteAudio(audio)}
                  >
                    <Ionicons
                      name={isSelected && status.playing ? 'volume-high' : 'musical-notes-outline'}
                      size={16}
                      color={isSelected ? '#60A5FA' : '#94A3B8'}
                    />
                    <View>
                      <Text
                        style={[
                          styles.audioPillTitle,
                          isSelected && styles.audioPillTitleSelected,
                        ]}
                      >
                        {audio.title}
                      </Text>
                      <Text style={styles.audioPillMeta}>
                        {formatDuration(audio.durationSec)}
                      </Text>
                    </View>
                  </Pressable>

                  <Pressable
                    style={({ pressed }) => [
                      styles.transcribeMiniBtn,
                      (pressed || transcribingAudioId !== null) && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Transcrever ${audio.title}`}
                    onPress={() => handleTranscribeAudio(audio)}
                    disabled={transcribingAudioId !== null}
                  >
                    {isTranscribingThis ? (
                      <ActivityIndicator size="small" color="#93C5FD" />
                    ) : (
                      <>
                        <Ionicons name="sparkles-outline" size={12} color="#93C5FD" />
                        <Text style={styles.transcribeMiniText}>Transcrever</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* Audio Player Card for the selected audio */}
        {selectedAudio && (
          <View style={styles.playerCard}>
            <View style={styles.playerTopRow}>
              <View style={styles.audioTitleEditWrap}>
                <Ionicons name="pencil-outline" size={13} color="#64748B" />
                <TextInput
                  key={selectedAudio.id}
                  style={styles.playingAudioTitleInput}
                  defaultValue={selectedAudio.title}
                  onChangeText={setAudioTitleDraft}
                  onBlur={handleSaveAudioTitle}
                  onSubmitEditing={handleSaveAudioTitle}
                  placeholder="Nome do áudio"
                  placeholderTextColor="#64748B"
                  returnKeyType="done"
                />
              </View>
              <Text style={styles.timeText}>
                {formatDuration(status.currentTime)} / {formatDuration(totalDur)}
              </Text>
            </View>

            <Pressable
              style={styles.progressTouchArea}
              accessibilityRole="adjustable"
              accessibilityLabel="Barra de progresso do áudio"
              onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
              onPress={(e) => {
                if (trackWidth <= 0 || totalDur <= 0) return;
                const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / trackWidth));
                player.seekTo(ratio * totalDur);
              }}
            >
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
              </View>
            </Pressable>

            <View style={styles.controlsRow}>
              <Pressable
                style={({ pressed }) => [styles.speedButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Velocidade ${SPEEDS[speedIdx]}x`}
                onPress={cycleSpeed}
              >
                <Text style={styles.speedText}>{SPEEDS[speedIdx]}x</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.seekButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Voltar 10 segundos"
                onPress={() => seekBy(-10)}
              >
                <Ionicons name="play-back" size={20} color="#F8FAFC" />
                <Text style={styles.seekLabel}>10s</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={status.playing ? 'Pausar áudio' : 'Reproduzir áudio'}
                onPress={togglePlay}
              >
                <Ionicons
                  name={status.playing ? 'pause' : 'play'}
                  size={22}
                  color="#FFFFFF"
                />
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.seekButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Avançar 10 segundos"
                onPress={() => seekBy(10)}
              >
                <Ionicons name="play-forward" size={20} color="#F8FAFC" />
                <Text style={styles.seekLabel}>10s</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Marcar momento atual"
                onPress={handleAddPlaybackBookmark}
              >
                <Ionicons name="bookmark-outline" size={20} color="#FDE68A" />
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Compartilhar transcrição"
                onPress={handleShareText}
                disabled={!selectedTranscription?.text}
              >
                <Ionicons
                  name="share-outline"
                  size={20}
                  color={selectedTranscription?.text ? '#F8FAFC' : '#475569'}
                />
              </Pressable>
            </View>

            {/* Bookmarks strip for this audio */}
            {audioBookmarks.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.bookmarksScroll}
              >
                {audioBookmarks.map((bm) => (
                  <View key={bm.id} style={styles.bookmarkChip}>
                    <Pressable
                      style={({ pressed }) => [styles.bookmarkMain, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Ir para ${bm.label} em ${formatDuration(bm.timeSec)}`}
                      onPress={() => seekAndPlayTime(bm.timeSec, bm.audioId)}
                      onLongPress={() => setEditingBookmark({ id: bm.id, value: bm.label })}
                    >
                      <Ionicons name="bookmark" size={12} color="#FDE68A" />
                      <Text style={styles.bookmarkTime}>{formatDuration(bm.timeSec)}</Text>
                      <Text style={styles.bookmarkLabel}>{bm.label}</Text>
                    </Pressable>
                    <Pressable
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Remover marcador ${bm.label}`}
                      onPress={() => handleDeleteBookmark(bm)}
                    >
                      <Ionicons name="close-circle" size={14} color="#94A3B8" />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {editingBookmark && (
          <View style={styles.editBanner}>
            <Text style={styles.editBannerLabel}>Marcador:</Text>
            <TextInput
              style={styles.editBannerInput}
              value={editingBookmark.value}
              onChangeText={(v) => setEditingBookmark({ ...editingBookmark, value: v })}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveBookmarkEdit}
            />
            <Pressable style={styles.editSaveBtn} onPress={saveBookmarkEdit}>
              <Text style={styles.editSaveBtnText}>Salvar</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.editCancelBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Cancelar edição do marcador"
              hitSlop={10}
              onPress={() => setEditingBookmark(null)}
            >
              <Ionicons name="close" size={18} color="#94A3B8" />
            </Pressable>
          </View>
        )}
      </View>

      {/* Section 2: Transcriptions of this Session */}
      <View style={styles.transcriptArea}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>
            TRANSCRIÇÕES ({lesson.transcriptions.length})
          </Text>
          {selectedTranscription?.status === 'done' && (
            <Pressable
              style={({ pressed }) => [
                styles.modeToggleBtn,
                editMode && styles.modeToggleBtnActive,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              onPress={() => {
                setEditMode((prev) => !prev);
                setEditingWord(null);
                setEditingSegment(null);
              }}
            >
              <Ionicons
                name={editMode ? 'checkmark-circle' : 'create-outline'}
                size={15}
                color={editMode ? '#FFFFFF' : '#93C5FD'}
              />
              <Text style={[styles.modeToggleText, editMode && styles.modeToggleTextActive]}>
                {editMode ? 'Concluir Edição' : 'Editar Palavras'}
              </Text>
            </Pressable>
          )}
        </View>

        {lesson.transcriptions.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsScroll}
          >
            {lesson.transcriptions.map((trans) => {
              const isSelected = selectedTranscription?.id === trans.id;
              return (
                <Pressable
                  key={trans.id}
                  style={({ pressed }) => [
                    styles.transChip,
                    isSelected && styles.transChipSelected,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => handleSelectTranscription(trans)}
                  onLongPress={() => handleDeleteTranscription(trans)}
                >
                  <Ionicons
                    name="document-text-outline"
                    size={14}
                    color={isSelected ? '#FFFFFF' : '#94A3B8'}
                  />
                  <Text
                    style={[
                      styles.transChipText,
                      isSelected && styles.transChipTextSelected,
                    ]}
                  >
                    {trans.title}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* Word or Segment Inline Editor Modal/Banner */}
        {editingWord && (
          <View style={styles.editBanner}>
            <Text style={styles.editBannerLabel}>Corrigir palavra:</Text>
            <TextInput
              style={styles.editBannerInput}
              value={editingWord.value}
              onChangeText={(v) => setEditingWord({ ...editingWord, value: v })}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveWordEdit}
            />
            <Pressable style={styles.editSaveBtn} onPress={saveWordEdit}>
              <Text style={styles.editSaveBtnText}>Salvar</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.editCancelBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Cancelar edição da palavra"
              hitSlop={10}
              onPress={() => setEditingWord(null)}
            >
              <Ionicons name="close" size={18} color="#94A3B8" />
            </Pressable>
          </View>
        )}

        {editingSegment && (
          <View style={styles.editSegmentBox}>
            <Text style={styles.editBannerLabel}>Editar trecho completo:</Text>
            <TextInput
              style={styles.editSegmentInput}
              value={editingSegment.value}
              onChangeText={(v) => setEditingSegment({ ...editingSegment, value: v })}
              multiline
              autoFocus
            />
            <View style={styles.editSegmentActions}>
              <Pressable
                style={styles.editCancelBtn}
                onPress={() => setEditingSegment(null)}
              >
                <Text style={styles.editCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable style={styles.editSaveBtn} onPress={saveSegmentEdit}>
                <Text style={styles.editSaveBtnText}>Salvar trecho</Text>
              </Pressable>
            </View>
          </View>
        )}

        {!selectedTranscription ? (
          <View style={styles.emptyTranscriptBox}>
            <Ionicons name="document-text-outline" size={36} color="#94A3B8" />
            <Text style={styles.emptyTranscriptTitle}>Nenhuma transcrição ainda</Text>
            <Text style={styles.emptyTranscriptSubtitle}>
              Toque em Transcrever em qualquer áudio acima para gerar o texto sincronizado
              palavra por palavra.
            </Text>
          </View>
        ) : selectedTranscription.status === 'transcribing' ? (
          <View style={styles.emptyTranscriptBox}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={styles.emptyTranscriptTitle}>
              Transcrevendo áudio... {transcribeProgress}%
            </Text>
            <View style={styles.transcribeProgressTrack}>
              <View
                style={[styles.progressFill, { width: `${transcribeProgress}%` }]}
              />
            </View>
            <Text style={styles.emptyTranscriptSubtitle}>
              Processamento 100% offline no aparelho.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.cancelTranscribeBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              onPress={cancelActiveTranscription}
            >
              <Ionicons name="close-circle-outline" size={16} color="#FCA5A5" />
              <Text style={styles.cancelTranscribeText}>Cancelar transcrição</Text>
            </Pressable>
          </View>
        ) : selectedTranscription.status === 'error' ? (
          <View style={styles.emptyTranscriptBox}>
            <Ionicons name="alert-circle-outline" size={36} color="#FCA5A5" />
            <Text style={styles.errorText}>
              {selectedTranscription.errorMessage ?? 'Erro ao transcrever.'}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color="#94A3B8" />
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder="Buscar palavra ou trecho..."
                placeholderTextColor="#94A3B8"
              />
            </View>
            <Text style={styles.hintLabel}>
              {editMode
                ? 'Toque numa palavra para corrigir'
                : 'Toque numa palavra para ouvir • Segure para editar'}
            </Text>

            <ScrollView
              contentContainerStyle={[
                styles.segmentsList,
                { paddingBottom: Math.max(24, insets.bottom + 12) },
              ]}
              keyboardShouldPersistTaps="handled"
            >
              {filteredSegments.map((seg) => {
                const isSegActive =
                  selectedTranscription.audioId === selectedAudio?.id &&
                  status.currentTime >= seg.start &&
                  status.currentTime < seg.end;

                const words =
                  seg.words && seg.words.length > 0
                    ? seg.words
                    : interpolateWordsForSegment(seg.id, seg.text, seg.start, seg.end);

                return (
                  <View
                    key={`${seg.id}-${seg.start}`}
                    style={[styles.segmentRow, isSegActive && styles.segmentRowActive]}
                  >
                    <View style={styles.segmentLeftCol}>
                      <Pressable
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Ouvir a partir de ${formatDuration(seg.start)}`}
                        onPress={() =>
                          seekAndPlayTime(seg.start, selectedTranscription.audioId)
                        }
                      >
                        <Text
                          style={[styles.timestamp, isSegActive && styles.timestampActive]}
                        >
                          {formatDuration(seg.start)}
                        </Text>
                      </Pressable>

                      <Pressable
                        style={({ pressed }) => [styles.editSegIconBtn, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel="Editar trecho completo"
                        hitSlop={10}
                        onPress={() => {
                          setEditingWord(null);
                          setEditingSegment({ segmentId: seg.id, value: seg.text });
                        }}
                      >
                        <Ionicons name="create-outline" size={17} color="#94A3B8" />
                      </Pressable>
                    </View>

                    <View style={styles.wordsWrap}>
                      {words.map((w) => {
                        const isWordPlaying =
                          isSegActive &&
                          status.currentTime >= w.start &&
                          status.currentTime < w.end;
                        const isWordEditing = editingWord?.wordId === w.id;

                        return (
                          <Pressable
                            key={w.id}
                            onPress={() => handlePressWord(seg, w)}
                            onLongPress={() => handleLongPressWord(seg, w)}
                            style={({ pressed }) => [
                              styles.wordChip,
                              editMode && styles.wordChipEditMode,
                              isWordPlaying && styles.wordChipPlaying,
                              isWordEditing && styles.wordChipEditing,
                              pressed && styles.pressed,
                            ]}
                          >
                            <Text
                              style={[
                                styles.wordText,
                                isWordPlaying && styles.wordTextPlaying,
                                editMode && styles.wordTextEditMode,
                              ]}
                            >
                              {w.word}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#020617',
    gap: 12,
  },
  topSection: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  titleInput: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F8FAFC',
    paddingVertical: 2,
  },
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  tagChipActive: {
    backgroundColor: '#451A03',
    borderColor: '#B45309',
  },
  tagChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  tagChipTextActive: {
    color: '#FDE68A',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  audioHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  importAudioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#172554',
    borderWidth: 1,
    borderColor: '#1E40AF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  importAudioBtnText: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '700',
  },
  addAudioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#DC2626',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  addAudioBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  bookmarkRecBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#451A03',
    borderWidth: 1,
    borderColor: '#B45309',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  bookmarkRecText: {
    color: '#FDE68A',
    fontSize: 12,
    fontWeight: '700',
  },
  stopRecSmallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#991B1B',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  whiteDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FCA5A5',
  },
  stopRecSmallText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  emptyAudiosBox: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  emptyAudiosText: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
  },
  chipsScroll: {
    gap: 8,
    paddingVertical: 2,
  },
  audioPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  audioPillSelected: {
    borderColor: '#3B82F6',
    backgroundColor: '#172554',
  },
  audioPillMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  audioPillTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F8FAFC',
  },
  audioPillTitleSelected: {
    color: '#93C5FD',
  },
  audioPillMeta: {
    fontSize: 11,
    color: '#94A3B8',
    fontVariant: ['tabular-nums'],
  },
  transcribeMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1E3A8A',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
  },
  transcribeMiniText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#93C5FD',
  },
  playerCard: {
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  playerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  audioTitleEditWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playingAudioTitleInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#F8FAFC',
    paddingVertical: 2,
  },
  progressTouchArea: {
    paddingVertical: 8,
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#1E293B',
    borderRadius: 999,
    overflow: 'hidden',
  },
  transcribeProgressTrack: {
    width: '80%',
    height: 8,
    backgroundColor: '#1E293B',
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 4,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
  },
  timeText: {
    fontSize: 12,
    color: '#94A3B8',
    fontVariant: ['tabular-nums'],
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  speedButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    minWidth: 46,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  speedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  seekButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
    minHeight: 44,
    padding: 4,
  },
  seekLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
  },
  playButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shareButton: {
    minWidth: 40,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bookmarksScroll: {
    gap: 8,
    paddingTop: 4,
  },
  bookmarkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  bookmarkMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bookmarkTime: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FDE68A',
    fontVariant: ['tabular-nums'],
  },
  bookmarkLabel: {
    fontSize: 12,
    color: '#F8FAFC',
    fontWeight: '500',
  },
  transcriptArea: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
  },
  modeToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#172554',
    borderWidth: 1,
    borderColor: '#1E40AF',
  },
  modeToggleBtnActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  modeToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#93C5FD',
  },
  modeToggleTextActive: {
    color: '#FFFFFF',
  },
  transChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  transChipSelected: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  transChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#CBD5E1',
  },
  transChipTextSelected: {
    color: '#FFFFFF',
  },
  editBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#172554',
    borderWidth: 1,
    borderColor: '#1D4ED8',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  editBannerLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#93C5FD',
  },
  editBannerInput: {
    flex: 1,
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    color: '#F8FAFC',
  },
  editSaveBtn: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  editSaveBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  editCancelBtn: {
    padding: 4,
  },
  editCancelText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  editSegmentBox: {
    backgroundColor: '#172554',
    borderWidth: 1,
    borderColor: '#1D4ED8',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  editSegmentInput: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: '#F8FAFC',
    minHeight: 60,
  },
  editSegmentActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
  },
  emptyTranscriptBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    gap: 10,
  },
  emptyTranscriptTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  emptyTranscriptSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 19,
  },
  cancelTranscribeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    backgroundColor: '#450A0A',
    borderWidth: 1,
    borderColor: '#7F1D1D',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  cancelTranscribeText: {
    color: '#FCA5A5',
    fontSize: 13,
    fontWeight: '700',
  },
  errorText: {
    fontSize: 13,
    color: '#FCA5A5',
    textAlign: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#F8FAFC',
  },
  hintLabel: {
    fontSize: 12,
    color: '#94A3B8',
  },
  segmentsList: {
    gap: 8,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  segmentRowActive: {
    backgroundColor: '#0F172A',
    borderColor: '#3B82F6',
  },
  segmentLeftCol: {
    alignItems: 'center',
    gap: 6,
    paddingTop: 2,
  },
  timestamp: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    fontVariant: ['tabular-nums'],
  },
  timestampActive: {
    color: '#60A5FA',
  },
  editSegIconBtn: {
    minWidth: 36,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wordsWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  wordChip: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
  },
  wordChipEditMode: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  wordChipPlaying: {
    backgroundColor: '#3B82F6',
  },
  wordChipEditing: {
    backgroundColor: '#451A03',
    borderColor: '#F59E0B',
    borderWidth: 1,
  },
  wordText: {
    fontSize: 15,
    lineHeight: 21,
    color: '#E2E8F0',
  },
  wordTextPlaying: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  wordTextEditMode: {
    color: '#F8FAFC',
  },
  pressed: {
    opacity: 0.72,
  },
});
