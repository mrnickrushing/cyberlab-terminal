import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

const TERMINAL_URL = 'https://terminal.vitallity.org';

export default function App() {
  const [webKey, setWebKey] = useState(0);
  const [statusLabel, setStatusLabel] = useState('Connecting');
  const [statusTone, setStatusTone] = useState<'neutral' | 'good' | 'warn'>('neutral');
  const [pickedScreenshot, setPickedScreenshot] = useState<{
    uri: string;
    name: string;
    width?: number;
    height?: number;
  } | null>(null);
  const webViewRef = useRef<WebView>(null);

  function reloadTerminal() {
    setStatusLabel('Reconnecting');
    setStatusTone('neutral');
    setWebKey((current) => current + 1);
  }

  async function openInBrowser() {
    await Linking.openURL(TERMINAL_URL);
  }

  function openCopyMode() {
    setStatusLabel('Copy Mode');
    setStatusTone('neutral');
    webViewRef.current?.injectJavaScript(`
      if (typeof openSelectionOverlay === 'function') {
        openSelectionOverlay();
      }
      true;
    `);
  }

  async function pickScreenshot() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setStatusLabel('Photos blocked');
      setStatusTone('warn');
      Alert.alert(
        'Photos access needed',
        'Allow photo library access so you can pick a screenshot from your phone.',
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets.length) {
      setStatusLabel('Picker canceled');
      setStatusTone('neutral');
      return;
    }

    const asset = result.assets[0];
    const name = asset.fileName ?? `screenshot-${Date.now()}.jpg`;
    const mimeType = asset.mimeType ?? 'image/jpeg';
    const ext =
      mimeType === 'image/png'
        ? 'png'
        : mimeType === 'image/webp'
          ? 'webp'
          : 'jpg';
    const safeBaseName = name
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9-_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'screenshot';
    const remotePath = `/tmp/${safeBaseName}-${Date.now()}.${ext}`;
    const base64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const uploadScript = [
      `cat > "${remotePath}.b64" <<'EOF'`,
      base64,
      'EOF',
      `base64 -d "${remotePath}.b64" > "${remotePath}"`,
      `rm -f "${remotePath}.b64"`,
      `printf '\\n[Saved screenshot to %s]\\n' "${remotePath}"`,
      '',
    ].join('\n');

    setPickedScreenshot({
      uri: asset.uri,
      name,
      width: asset.width,
      height: asset.height,
    });
    setStatusLabel('Screenshot ready');
    setStatusTone('good');

    await Clipboard.setStringAsync(uploadScript);
    webViewRef.current?.injectJavaScript(`
      if (typeof pasteClipboard === 'function') {
        pasteClipboard();
      }
      true;
    `);
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
        <Pressable onPress={pickScreenshot} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Upload Screenshot</Text>
        </Pressable>
      </View>

      <View style={styles.toolbarSecondary}>
        <Pressable onPress={openInBrowser} style={styles.tertiaryButton}>
          <Text style={styles.tertiaryButtonText}>Open in Safari</Text>
        </Pressable>
      </View>

      {pickedScreenshot ? (
        <View style={styles.previewCard}>
          <Image source={{ uri: pickedScreenshot.uri }} style={styles.previewImage} />
          <View style={styles.previewMeta}>
            <Text style={styles.previewLabel}>Selected screenshot</Text>
            <Text style={styles.previewName} numberOfLines={1}>
              {pickedScreenshot.name}
            </Text>
            <Text style={styles.previewNote}>
              Pasted into the shell as a base64 decode command.
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.terminalShell}>
        <Pressable onLongPress={openCopyMode} delayLongPress={280} style={styles.terminalChrome}>
          <Text style={styles.terminalChromeTitle}>terminal.vitallity.org</Text>
          <Text style={styles.terminalChromeMeta}>Long-press here to copy</Text>
        </Pressable>

        <WebView
          ref={webViewRef}
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
  toolbarSecondary: {
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
  tertiaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 12,
    backgroundColor: '#0a111f',
    borderWidth: 1,
    borderColor: '#ffffff14',
  },
  tertiaryButtonText: {
    color: '#d7e8f7',
    fontSize: 14,
    fontWeight: '700',
  },
  previewCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    padding: 12,
    marginBottom: 12,
    borderRadius: 18,
    backgroundColor: '#08111f',
    borderWidth: 1,
    borderColor: '#29e9ff22',
  },
  previewImage: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: '#07101c',
  },
  previewMeta: {
    flex: 1,
    gap: 4,
  },
  previewLabel: {
    color: '#29e9ff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  previewName: {
    color: '#f4fbff',
    fontSize: 14,
    fontWeight: '700',
  },
  previewNote: {
    color: '#8ca7bc',
    fontSize: 12,
    lineHeight: 16,
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
});
