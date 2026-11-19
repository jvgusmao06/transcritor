import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function SettingsScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <View style={styles.titleRow}>
          <Ionicons name="hardware-chip-outline" size={22} color="#60A5FA" />
          <Text style={styles.title}>IA Offline Embutida</Text>
        </View>
        <Text style={styles.description}>
          O modelo Whisper Base (~141 MB) já vem embutido no aplicativo. Você não precisa
          de internet, conta ou chave de API, e não há limite de minutos.
        </Text>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Modelo:</Text>
          <Text style={styles.statusValue}>Embutido no app (Pronto)</Text>
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Consumo de IA:</Text>
          <Text style={styles.statusValue}>Ativa só durante a transcrição</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 16,
    backgroundColor: '#020617',
    flexGrow: 1,
  },
  card: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    color: '#94A3B8',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#020617',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  statusLabel: {
    fontSize: 13,
    color: '#94A3B8',
  },
  statusValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4ADE80',
  },
});
