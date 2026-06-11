import { StatusBar } from 'expo-status-bar';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const quickActions = [
  'Reconnect relay',
  'Paste key',
  'Open snippets',
  'Resize font',
];

const terminalKeys = ['Esc', 'Tab', 'Ctrl', 'Alt', 'Up', 'Down', 'Left', 'Right'];

const terminalPreview = [
  'operator@cyberlab:~$ connect terminal.vitallity.org',
  '[relay] session restored',
  '[relay] resume window: 05:00',
  'operator@cyberlab:~$ sudo tmux attach -t main',
  '[tmux] attached to session main',
];

export default function App() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>CyberLab Terminal</Text>
          <Text style={styles.heroTitle}>Pocket access to your relay-backed shell.</Text>
          <Text style={styles.heroBody}>
            Built for fast reconnects, command snippets, and a terminal UX that feels
            intentional instead of bolted on.
          </Text>

          <View style={styles.statusRow}>
            <View style={styles.statusPill}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>Relay Ready</Text>
            </View>
            <View style={styles.secondaryPill}>
              <Text style={styles.secondaryPillText}>Session resume target: 5 min</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Quick Actions</Text>
          <View style={styles.grid}>
            {quickActions.map((action) => (
              <View key={action} style={styles.actionCard}>
                <Text style={styles.actionTitle}>{action}</Text>
                <Text style={styles.actionBody}>Terminal-first workflow with OTA-friendly UI.</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Terminal Preview</Text>
          <View style={styles.terminalCard}>
            <View style={styles.terminalHeader}>
              <Text style={styles.terminalHeaderText}>live relay</Text>
              <Text style={styles.terminalHeaderMeta}>ws://resume enabled</Text>
            </View>
            {terminalPreview.map((line) => (
              <Text key={line} style={styles.terminalLine}>
                {line}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Accessory Row</Text>
          <View style={styles.keyRow}>
            {terminalKeys.map((key) => (
              <View key={key} style={styles.keyChip}>
                <Text style={styles.keyText}>{key}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#050816',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 24,
  },
  heroCard: {
    borderRadius: 28,
    padding: 24,
    backgroundColor: '#091222',
    borderWidth: 1,
    borderColor: '#1be7ff33',
    shadowColor: '#1be7ff',
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  eyebrow: {
    color: '#1be7ff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  heroTitle: {
    color: '#f3fbff',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    marginBottom: 12,
  },
  heroBody: {
    color: '#9db6c7',
    fontSize: 15,
    lineHeight: 23,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 18,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0d1a15',
    borderWidth: 1,
    borderColor: '#71ff7a44',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#6eff7d',
  },
  statusText: {
    color: '#d6ffe0',
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#101d35',
  },
  secondaryPillText: {
    color: '#b7cbff',
    fontSize: 13,
    fontWeight: '600',
  },
  section: {
    gap: 12,
  },
  sectionLabel: {
    color: '#c8d7e6',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  grid: {
    gap: 12,
  },
  actionCard: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: '#0a1020',
    borderWidth: 1,
    borderColor: '#2affd522',
  },
  actionTitle: {
    color: '#f0fbff',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  actionBody: {
    color: '#8ea3b8',
    fontSize: 14,
    lineHeight: 20,
  },
  terminalCard: {
    borderRadius: 22,
    padding: 18,
    backgroundColor: '#02060f',
    borderWidth: 1,
    borderColor: '#6eff7d33',
  },
  terminalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  terminalHeaderText: {
    color: '#6eff7d',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  terminalHeaderMeta: {
    color: '#4bf4ff',
    fontSize: 12,
    fontWeight: '600',
  },
  terminalLine: {
    color: '#d6ffe0',
    fontSize: 14,
    lineHeight: 22,
    fontFamily: 'monospace',
  },
  keyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  keyChip: {
    minWidth: 58,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#0e1730',
    borderWidth: 1,
    borderColor: '#1be7ff33',
  },
  keyText: {
    color: '#e7f7ff',
    fontSize: 13,
    fontWeight: '700',
  },
});
