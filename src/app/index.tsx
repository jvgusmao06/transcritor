import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  confirmAction,
  deleteFolder,
  deleteLesson,
  formatDuration,
  loadFolders,
  loadLessons,
  updateLessonById,
  upsertFolder,
  upsertLesson,
} from '../storage';
import { SESSION_TAGS, type Folder, type Lesson, type SessionTag } from '../types';

type FolderFilter = 'all' | 'none' | string;
type TagFilter = 'all' | SessionTag;

export default function HomeScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<FolderFilter>('all');
  const [selectedTag, setSelectedTag] = useState<TagFilter>('all');
  const [newLessonTitle, setNewLessonTitle] = useState('');
  const [creating, setCreating] = useState(false);

  // Folder creation & move session modal
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [movingLesson, setMovingLesson] = useState<Lesson | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => router.push('/settings')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Configurações"
          style={({ pressed }) => [styles.headerIcon, pressed && styles.pressed]}
        >
          <Ionicons name="settings-outline" size={22} color="#F8FAFC" />
        </Pressable>
      ),
    });
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      loadLessons().then(setLessons);
      loadFolders().then(setFolders);
    }, [])
  );

  const visibleLessons = useMemo(() => {
    return lessons.filter((l) => {
      const folderMatch =
        selectedFilter === 'all'
          ? true
          : selectedFilter === 'none'
            ? !l.folderId
            : l.folderId === selectedFilter;
      const tagMatch = selectedTag === 'all' ? true : l.tag === selectedTag;
      return folderMatch && tagMatch;
    });
  }, [lessons, selectedFilter, selectedTag]);

  const folderMap = useMemo(() => {
    const map = new Map<string, Folder>();
    for (const f of folders) map.set(f.id, f);
    return map;
  }, [folders]);

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) {
      setShowNewFolder(false);
      return;
    }
    const folder: Folder = {
      id: `folder-${Date.now()}`,
      name: trimmed,
      createdAt: new Date().toISOString(),
    };
    const next = await upsertFolder(folder);
    setFolders(next);
    setNewFolderName('');
    setShowNewFolder(false);
    setSelectedFilter(folder.id);
  };

  const confirmDeleteFolder = (folder: Folder) => {
    confirmAction(
      'Excluir pasta?',
      `A pasta "${folder.name}" será removida. As sessões dentro dela continuarão salvas em "Sem pasta".`,
      'Excluir',
      async () => {
        const res = await deleteFolder(folder.id);
        setFolders(res.folders);
        setLessons(res.lessons);
        if (selectedFilter === folder.id) {
          setSelectedFilter('all');
        }
      }
    );
  };

  const handleMoveLesson = async (lesson: Lesson, folderId?: string) => {
    const updated = await updateLessonById(lesson.id, (cur) => ({
      ...cur,
      folderId,
    }));
    if (updated) {
      setLessons((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    }
    setMovingLesson(null);
  };

  const handleCreateLesson = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const now = new Date();
      const formattedDate = now.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
      });
      const prefix = selectedTag !== 'all' ? selectedTag : 'Sessão';
      const title =
        newLessonTitle.trim() || `${prefix} ${formattedDate} (#${lessons.length + 1})`;
      const folderId =
        selectedFilter !== 'all' && selectedFilter !== 'none'
          ? selectedFilter
          : undefined;

      const lesson: Lesson = {
        id: `${Date.now()}`,
        title,
        createdAt: now.toISOString(),
        folderId,
        tag: selectedTag !== 'all' ? selectedTag : undefined,
        audios: [],
        transcriptions: [],
        bookmarks: [],
      };

      const next = await upsertLesson(lesson);
      setLessons(next);
      setNewLessonTitle('');
      router.push(`/recording/${lesson.id}`);
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = (item: Lesson) => {
    confirmAction(
      'Excluir sessão?',
      `"${item.title}" e todos os seus áudios e transcrições serão removidos.`,
      'Excluir',
      async () => {
        const next = await deleteLesson(item.id);
        setLessons(next);
      }
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Folders & Tags Bar */}
      <View style={styles.foldersSection}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.foldersScroll}
        >
          <Pressable
            style={({ pressed }) => [
              styles.folderChip,
              selectedFilter === 'all' && styles.folderChipActive,
              pressed && styles.pressed,
            ]}
            onPress={() => setSelectedFilter('all')}
          >
            <Text
              style={[
                styles.folderChipText,
                selectedFilter === 'all' && styles.folderChipTextActive,
              ]}
            >
              Todas ({lessons.length})
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.folderChip,
              selectedFilter === 'none' && styles.folderChipActive,
              pressed && styles.pressed,
            ]}
            onPress={() => setSelectedFilter('none')}
          >
            <Text
              style={[
                styles.folderChipText,
                selectedFilter === 'none' && styles.folderChipTextActive,
              ]}
            >
              Sem pasta ({lessons.filter((l) => !l.folderId).length})
            </Text>
          </Pressable>

          {folders.map((folder) => {
            const count = lessons.filter((l) => l.folderId === folder.id).length;
            const active = selectedFilter === folder.id;
            return (
              <Pressable
                key={folder.id}
                style={({ pressed }) => [
                  styles.folderChip,
                  active && styles.folderChipActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => setSelectedFilter(folder.id)}
                onLongPress={() => confirmDeleteFolder(folder)}
              >
                <Ionicons
                  name="folder-outline"
                  size={14}
                  color={active ? '#FFFFFF' : '#94A3B8'}
                />
                <Text
                  style={[
                    styles.folderChipText,
                    active && styles.folderChipTextActive,
                  ]}
                >
                  {folder.name} ({count})
                </Text>
              </Pressable>
            );
          })}

          <Pressable
            style={({ pressed }) => [styles.addFolderChip, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Criar nova pasta"
            onPress={() => setShowNewFolder((prev) => !prev)}
          >
            <Ionicons name="add" size={16} color="#93C5FD" />
            <Text style={styles.addFolderText}>Pasta</Text>
          </Pressable>
        </ScrollView>

        {/* Category / Tag Filter */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.foldersScroll}
        >
          <Pressable
            style={({ pressed }) => [
              styles.tagFilterChip,
              selectedTag === 'all' && styles.tagFilterChipActive,
              pressed && styles.pressed,
            ]}
            onPress={() => setSelectedTag('all')}
          >
            <Text
              style={[
                styles.tagFilterText,
                selectedTag === 'all' && styles.tagFilterTextActive,
              ]}
            >
              Todos os tipos
            </Text>
          </Pressable>
          {SESSION_TAGS.map((tag) => {
            const active = selectedTag === tag;
            return (
              <Pressable
                key={tag}
                style={({ pressed }) => [
                  styles.tagFilterChip,
                  active && styles.tagFilterChipActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => setSelectedTag(active ? 'all' : tag)}
              >
                <Text
                  style={[
                    styles.tagFilterText,
                    active && styles.tagFilterTextActive,
                  ]}
                >
                  {tag}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {showNewFolder && (
          <View style={styles.newFolderRow}>
            <TextInput
              style={styles.newFolderInput}
              value={newFolderName}
              onChangeText={setNewFolderName}
              placeholder="Nome da pasta (ex: Conferência, Projeto)..."
              placeholderTextColor="#64748B"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreateFolder}
            />
            <Pressable style={styles.newFolderSaveBtn} onPress={handleCreateFolder}>
              <Text style={styles.newFolderSaveText}>Criar</Text>
            </Pressable>
          </View>
        )}
      </View>

      <FlatList
        data={visibleLessons}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          visibleLessons.length === 0 && styles.emptyListContent,
        ]}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="mic-circle-outline" size={50} color="#94A3B8" />
            <Text style={styles.emptyTitle}>
              {selectedFilter === 'all' && selectedTag === 'all'
                ? 'Nenhuma sessão criada'
                : 'Nenhuma sessão encontrada'}
            </Text>
            <Text style={styles.emptySubtitle}>
              Crie uma sessão abaixo para gravar ou importar áudios de palestras, aulas,
              reuniões ou entrevistas.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const totalDuration = item.audios.reduce((acc, a) => acc + a.durationSec, 0);
          const doneCount = item.transcriptions.filter((t) => t.status === 'done').length;
          const bookmarkCount = item.bookmarks?.length ?? 0;
          const latestPreview = item.transcriptions.find((t) => t.text)?.text;
          const dateLabel = new Date(item.createdAt).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: 'short',
          });
          const folder = item.folderId ? folderMap.get(item.folderId) : undefined;

          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Pressable
                  style={({ pressed }) => [styles.titleRow, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Abrir sessão ${item.title}`}
                  onPress={() => router.push(`/recording/${item.id}`)}
                  onLongPress={() => confirmDelete(item)}
                >
                  <Ionicons name="albums-outline" size={20} color="#60A5FA" />
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                </Pressable>

                <View style={styles.cardActions}>
                  <Pressable
                    onPress={() => setMovingLesson(item)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Mover sessão ${item.title} para pasta`}
                    style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
                  >
                    <Ionicons name="folder-outline" size={18} color="#94A3B8" />
                  </Pressable>
                  <Pressable
                    onPress={() => confirmDelete(item)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Excluir sessão ${item.title}`}
                    style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
                  >
                    <Ionicons name="trash-outline" size={18} color="#94A3B8" />
                  </Pressable>
                </View>
              </View>

              <Pressable
                style={({ pressed }) => [styles.cardBody, pressed && styles.pressed]}
                onPress={() => router.push(`/recording/${item.id}`)}
                onLongPress={() => confirmDelete(item)}
              >
                <View style={styles.badgesRow}>
                  {item.tag && (
                    <View style={[styles.metaChip, styles.tagBadge]}>
                      <Ionicons name="pricetag-outline" size={12} color="#FDE68A" />
                      <Text style={[styles.metaChipText, { color: '#FDE68A' }]}>
                        {item.tag}
                      </Text>
                    </View>
                  )}

                  {folder && (
                    <View style={[styles.metaChip, styles.folderBadge]}>
                      <Ionicons name="folder" size={12} color="#C4B5FD" />
                      <Text style={[styles.metaChipText, { color: '#C4B5FD' }]}>
                        {folder.name}
                      </Text>
                    </View>
                  )}

                  <View style={styles.metaChip}>
                    <Ionicons name="calendar-outline" size={13} color="#94A3B8" />
                    <Text style={styles.metaChipText}>{dateLabel}</Text>
                  </View>

                  <View style={[styles.metaChip, styles.audioChip]}>
                    <Ionicons name="mic-outline" size={13} color="#93C5FD" />
                    <Text style={[styles.metaChipText, { color: '#93C5FD' }]}>
                      {item.audios.length} {item.audios.length === 1 ? 'áudio' : 'áudios'}
                      {totalDuration > 0 ? ` (${formatDuration(totalDuration)})` : ''}
                    </Text>
                  </View>

                  <View style={[styles.metaChip, styles.transcriptChip]}>
                    <Ionicons name="document-text-outline" size={13} color="#86EFAC" />
                    <Text style={[styles.metaChipText, { color: '#86EFAC' }]}>
                      {doneCount} {doneCount === 1 ? 'transcrição' : 'transcrições'}
                    </Text>
                  </View>

                  {bookmarkCount > 0 && (
                    <View style={[styles.metaChip, styles.bookmarkBadge]}>
                      <Ionicons name="bookmark-outline" size={12} color="#FDA4AF" />
                      <Text style={[styles.metaChipText, { color: '#FDA4AF' }]}>
                        {bookmarkCount}
                      </Text>
                    </View>
                  )}
                </View>

                {latestPreview ? (
                  <Text style={styles.preview} numberOfLines={2}>
                    {latestPreview}
                  </Text>
                ) : null}
              </Pressable>
            </View>
          );
        }}
      />

      <View style={[styles.footer, { paddingBottom: Math.max(16, insets.bottom + 8) }]}>
        <View style={styles.createRow}>
          <TextInput
            style={styles.newLessonInput}
            value={newLessonTitle}
            onChangeText={setNewLessonTitle}
            placeholder="Nome da nova sessão (opcional)..."
            placeholderTextColor="#94A3B8"
            returnKeyType="done"
            onSubmitEditing={handleCreateLesson}
          />
          <Pressable
            style={({ pressed }) => [
              styles.createButton,
              (pressed || creating) && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Criar nova sessão"
            disabled={creating}
            onPress={handleCreateLesson}
          >
            <Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />
            <Text style={styles.createButtonText}>Nova Sessão</Text>
          </Pressable>
        </View>
      </View>

      {/* Move Session to Folder Modal */}
      <Modal
        visible={movingLesson !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setMovingLesson(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setMovingLesson(null)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Mover sessão para pasta</Text>
            <Text style={styles.modalSubtitle} numberOfLines={1}>
              {movingLesson?.title}
            </Text>

            <Pressable
              style={({ pressed }) => [styles.modalOption, pressed && styles.pressed]}
              onPress={() => movingLesson && handleMoveLesson(movingLesson, undefined)}
            >
              <Ionicons name="remove-circle-outline" size={18} color="#94A3B8" />
              <Text style={styles.modalOptionText}>Sem pasta</Text>
            </Pressable>

            {folders.map((f) => (
              <Pressable
                key={f.id}
                style={({ pressed }) => [styles.modalOption, pressed && styles.pressed]}
                onPress={() => movingLesson && handleMoveLesson(movingLesson, f.id)}
              >
                <Ionicons name="folder-outline" size={18} color="#60A5FA" />
                <Text style={styles.modalOptionText}>{f.name}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
  },
  headerIcon: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBtn: {
    minWidth: 40,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.72,
  },
  foldersSection: {
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    gap: 8,
  },
  foldersScroll: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  folderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  folderChipActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  folderChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#CBD5E1',
  },
  folderChipTextActive: {
    color: '#FFFFFF',
  },
  tagFilterChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  tagFilterChipActive: {
    backgroundColor: '#451A03',
    borderColor: '#B45309',
  },
  tagFilterText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  tagFilterTextActive: {
    color: '#FDE68A',
  },
  addFolderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#172554',
    borderWidth: 1,
    borderColor: '#1E40AF',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  addFolderText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#93C5FD',
  },
  newFolderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  newFolderInput: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#F8FAFC',
  },
  newFolderSaveBtn: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  newFolderSaveText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F8FAFC',
    marginTop: 4,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardBody: {
    gap: 10,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tagBadge: {
    backgroundColor: '#451A03',
  },
  folderBadge: {
    backgroundColor: '#2E1065',
  },
  audioChip: {
    backgroundColor: '#1E3A8A',
  },
  transcriptChip: {
    backgroundColor: '#14532D',
  },
  bookmarkBadge: {
    backgroundColor: '#4C0519',
  },
  metaChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#CBD5E1',
  },
  preview: {
    fontSize: 13,
    color: '#94A3B8',
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#0F172A',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  newLessonInput: {
    flex: 1,
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#F8FAFC',
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#3B82F6',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 12,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.78)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 4,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  modalOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F8FAFC',
  },
});
