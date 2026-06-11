import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  Linking,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

const TERMINAL_URL = 'https://terminal.vitallity.org';

const keyCaps = ['Esc', 'Tab', 'Ctrl', 'Alt', 'Up', 'Down', 'Left', 'Right'];

export default function App() {
  const [webKey, setWebKey] = useState(0);
  const [statusLabel, setStatusLabel] = useState('Connecting');
  const [statusTone, setStatusTone] = useState<'neutral' | 'good' | 'warn'>('neutral');

  function reloadTerminal() {
    setStatusLabel('Reconnecting');
    setStatusTone('neutral');
    setWebKey((current) => current + 1);
  }

  async function openInBrowser() {
    await Linking.openURL(TERMINAL_URL);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>CyberLab Terminal</Text>
          <Text style={styles.title}>Live Relay Session</Text>
        </View>

        <View style={styles.statusPill}>
          <View
            style={[
              styles.statusDot,
              statusTone === 'good'
                ? styles.statusDotGood
                : statusTone === 'warn'
                  ? styles.statusDotWarn
                  : styles.statusDotNeutral,
            ]}
          />
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
      </View>

      <View style={styles.toolbar}>
        <Pressable onPress={reloadTerminal} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Reload Terminal</Text>
        </Pressable>
        <Pressable onPress={openInBrowser} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Open in Safari</Text>
        </Pressable>
      </View>

      <View style={styles.terminalShell}>
        <View style={styles.terminalChrome}>
          <Text style={styles.terminalChromeTitle}>terminal.vitallity.org</Text>
          <Text style={styles.terminalChromeMeta}>5 min resume window</Text>
        </View>

        <WebView
          key={webKey}
          source={{ uri: TERMINAL_URL }}
          style={styles.webview}
          containerStyle={styles.webviewContainer}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          allowsBackForwardNavigationGestures={false}
          setSupportMultipleWindows={false}
          bounces={false}
          startInLoadingState
          onLoadStart={() => {
            setStatusLabel('Connecting');
            setStatusTone('neutral');
          }}
          onLoadEnd={() => {
            setStatusLabel('Live');
            setStatusTone('good');
          }}
          onError={() => {
            setStatusLabel('Load Failed');
            setStatusTone('warn');
          }}
        />
      </View>

      <View style={styles.keyRow}>
        {keyCaps.map((keyCap) => (
          <View key={keyCap} style={styles.keyChip}>
            <Text style={styles.keyText}>{keyCap}</Text>
          </View>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#040816',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 12,
  },
  eyebrow: {
    color: '#29e9ff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  title: {
    color: '#f4fbff',
    fontSize: 26,
    fontWeight: '800',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#0b1325',
    borderWidth: 1,
    borderColor: '#1be7ff22',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  statusDotNeutral: {
    backgroundColor: '#29e9ff',
  },
  statusDotGood: {
    backgroundColor: '#75ff8f',
  },
  statusDotWarn: {
    backgroundColor: '#ff8b7c',
  },
  statusText: {
    color: '#d7e8f7',
    fontSize: 12,
    fontWeight: '700',
  },
  toolbar: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  primaryButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#10284f',
    borderWidth: 1,
    borderColor: '#29e9ff33',
  },
  primaryButtonText: {
    color: '#f3fbff',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#0a111f',
    borderWidth: 1,
    borderColor: '#75ff8f33',
  },
  secondaryButtonText: {
    color: '#d9ffe1',
    fontSize: 14,
    fontWeight: '700',
  },
  terminalShell: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#29e9ff33',
    backgroundColor: '#02060f',
    shadowColor: '#29e9ff',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  terminalChrome: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#09111f',
    borderBottomWidth: 1,
    borderBottomColor: '#29e9ff22',
  },
  terminalChromeTitle: {
    color: '#6ffff0',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  terminalChromeMeta: {
    color: '#8ca7bc',
    fontSize: 12,
    fontWeight: '600',
  },
  webviewContainer: {
    flex: 1,
    backgroundColor: '#02060f',
  },
  webview: {
    flex: 1,
    backgroundColor: '#02060f',
  },
  keyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  keyChip: {
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: '#0d1730',
    borderWidth: 1,
    borderColor: '#29e9ff22',
  },
  keyText: {
    color: '#e6f4ff',
    fontSize: 12,
    fontWeight: '700',
  },
});
