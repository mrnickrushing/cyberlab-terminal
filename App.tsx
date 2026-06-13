import { StatusBar } from 'expo-status-bar';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

const TERMINAL_URL = 'https://terminal.vitallity.org';
const TEMP_FILE_HOST = 'https://catbox.moe/user/api.php';

export default function App() {
  const [webKey, setWebKey] = useState(0);
  const [statusLabel, setStatusLabel] = useState('Connecting');
  const [statusTone, setStatusTone] = useState<'neutral' | 'good' | 'warn'>('neutral');
  const [pickedScreenshot, setPickedScreenshot] = useState<{
    uri: string;
    name: string;
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
      if (typeof toggleSelectMode === 'function') {
        toggleSelectMode();
      }
      true;
    `);
  }

  function typeCommandIntoTerminal(command: string) {
    webViewRef.current?.injectJavaScript(`
      (function() {
        const command = ${JSON.stringify(command)};
        if (typeof sendKey === 'function') {
          for (const character of command) {
            sendKey(character);
          }
          sendKey('\\r');
        }
      })();
      true;
    `);
  }

  function failUpload(stage: string, error?: unknown) {
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'unknown error';
    setStatusLabel(`${stage} failed`);
    setStatusTone('warn');
    Alert.alert('Upload failed', `${stage} failed: ${detail}`);
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
      base64: true,
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
    const tempFileUri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}${safeBaseName}-${Date.now()}.${ext}`;
    setStatusLabel('Preparing screenshot');
    setStatusTone('neutral');
    if (!asset.base64) {
      failUpload('Read photo library', 'no base64 payload from picker');
      return;
    }

    try {
      await FileSystem.writeAsStringAsync(tempFileUri, asset.base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } catch (error) {
      failUpload('Stage local file', error);
      return;
    }

    setPickedScreenshot({
      uri: asset.uri,
      name,
    });

    try {
      let uploadUrl = '';

      try {
        const formData = new FormData();
        formData.append('file', {
          uri: tempFileUri,
          name: `${safeBaseName}.${ext}`,
          type: mimeType,
        } as never);
        formData.append('reqtype', 'fileupload');

        const uploadResponse = await fetch(TEMP_FILE_HOST, {
          method: 'POST',
          body: formData,
        });
        const uploadBody = await uploadResponse.text();
        if (!uploadResponse.ok) {
          throw new Error(`upload host returned ${uploadResponse.status}: ${uploadBody}`);
        }

        uploadUrl = uploadBody.trim();
        try {
          const parsed = JSON.parse(uploadUrl);
          uploadUrl = parsed?.data?.url ?? parsed?.url ?? uploadUrl;
        } catch {
          // Body is already a plain URL.
        }
      } catch (primaryError) {
        const uploadResult = await FileSystem.uploadAsync(TEMP_FILE_HOST, tempFileUri, {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'fileToUpload',
          mimeType,
          parameters: {
            reqtype: 'fileupload',
          },
        });
        uploadUrl = uploadResult.body.trim();
      }
      if (!uploadUrl.startsWith('http')) {
        throw new Error('upload host returned no URL');
      }

      const downloadCommand = `curl -fsSL ${JSON.stringify(uploadUrl)} -o /tmp/${safeBaseName}-${Date.now()}.${ext}`;
      setStatusLabel('Sending command');
      setStatusTone('good');
      typeCommandIntoTerminal(downloadCommand);
      setPickedScreenshot(null);
      return;
    } catch (error) {
      failUpload('Send to temporary host', error);
    } finally {
      try {
        await FileSystem.deleteAsync(tempFileUri, { idempotent: true });
      } catch {
        // Ignore cleanup failures.
      }
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>CyberLab Terminal</Text>
            <Text style={styles.title}>Live Terminal Shell</Text>
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
          <View style={styles.previewThumb}>
            <Text style={styles.previewThumbText}>IMG</Text>
          </View>
          <View style={styles.previewMeta}>
            <Text style={styles.previewLabel}>Selected screenshot</Text>
            <Text style={styles.previewName} numberOfLines={1}>
              {pickedScreenshot.name}
            </Text>
            <Text style={styles.previewNote}>
              Typed the upload command into the live terminal session.
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.terminalShell}>
        <Pressable onLongPress={openCopyMode} delayLongPress={280} style={styles.terminalChrome}>
          <Text style={styles.terminalChromeTitle}>terminal.vitallity.org</Text>
          <Text style={styles.terminalChromeMeta}>Long-press here to select text</Text>
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
            setStatusLabel('Load failed');
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
    flexDirection: 'column',
    marginBottom: 12,
    gap: 10,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    color: '#29e9ff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  title: {
    color: '#f4fbff',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 26,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
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
    flex: 1.2,
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
  toolbarSecondary: {
    marginBottom: 12,
  },
  tertiaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 12,
    backgroundColor: '#09111f',
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
  previewThumb: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#10284f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewThumbText: {
    color: '#effcff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
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
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#29e9ff33',
    backgroundColor: '#050816',
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
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  terminalChromeMeta: {
    color: '#8ca7bc',
    fontSize: 12,
    fontWeight: '600',
  },
  webviewContainer: {
    flex: 1,
    backgroundColor: '#050816',
  },
  webview: {
    flex: 1,
    backgroundColor: '#050816',
  },
});
