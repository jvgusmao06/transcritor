import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { releaseWhisperIfLoaded } from '../transcribe';

export default function RootLayout() {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        releaseWhisperIfLoaded();
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0F172A' },
          headerTintColor: '#F8FAFC',
          headerTitleStyle: { fontWeight: '600' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: '#020617' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Minhas Sessões' }} />
        <Stack.Screen name="recording/[id]" options={{ title: 'Sessão' }} />
        <Stack.Screen
          name="settings"
          options={{ title: 'Configurações', presentation: 'modal' }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
