import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

const TERMINAL_URL = 'https://terminal.vitallity.org';
const TEMP_FILE_HOST = 'https://catbox.moe/user/api.php';
const MAX_TERMINAL_TABS = 6;

type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'error';

type TerminalTab = {
  id: string;
  index: number;
  title: string;
  command: string;
  active: boolean;
  running: boolean;
};

const INITIAL_TERMINAL_TAB: TerminalTab = {
  id: 'loading',
  index: 1,
  title: 'Terminal 1',
  command: 'Connecting',
  active: true,
  running: false,
};

export default function App() {
  const [webKey, setWebKey] = useState(0);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('connecting');
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([
    INITIAL_TERMINAL_TAB,
  ]);
  const [tabsReady, setTabsReady] = useState(false);
  const [pickedScreenshot, setPickedScreenshot] = useState<{
    uri: string;
    name: string;
    terminalTitle: string;
  } | null>(null);
  const webViewRef = useRef<WebView>(null);
  const connectionPulse = useRef(new Animated.Value(0)).current;
  const activeTerminal =
    terminalTabs.find((terminal) => terminal.active) ?? terminalTabs[0];
  const statusLabel =
    connectionState === 'live'
      ? 'Live'
      : connectionState === 'reconnecting'
        ? 'Reconnecting'
        : connectionState === 'error'
          ? 'Offline'
          : 'Connecting';
  const statusTone =
    connectionState === 'live'
      ? 'good'
      : connectionState === 'error'
        ? 'warn'
        : 'neutral';

  useEffect(() => {
    connectionPulse.stopAnimation();
    connectionPulse.setValue(0);
    if (connectionState !== 'live') return;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(connectionPulse, {
          toValue: 1,
          duration: 850,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(connectionPulse, {
          toValue: 0,
          duration: 850,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [connectionPulse, connectionState]);

  const pulseScale = connectionPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.14],
  });
  const pulseOpacity = connectionPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.58, 0],
  });
  const dotOpacity = connectionPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.42],
  });

  function reloadTerminal() {
    setConnectionState('reconnecting');
    setTabsReady(false);
    setWebKey((current) => current + 1);
  }

  function openCopyMode() {
    webViewRef.current?.injectJavaScript(`
      if (typeof toggleSelectMode === 'function') {
        toggleSelectMode();
      }
      true;
    `);
  }

  function sendTerminalTabAction(
    action: 'list' | 'create' | 'select' | 'close',
    terminalId?: string,
  ) {
    if (!webViewRef.current) {
      Alert.alert(
        'Terminal unavailable',
        'The terminal is still connecting. Try again in a moment.',
      );
      return;
    }

    webViewRef.current.injectJavaScript(`
      (function() {
        if (typeof window.terminalTabAction === 'function') {
          window.terminalTabAction(${JSON.stringify(action)}, ${JSON.stringify(terminalId ?? null)});
        } else if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'terminalTabError',
            message: 'Terminal tabs are still connecting.'
          }));
        }
      })();
      true;
    `);
  }

  function createTerminalTab() {
    if (!tabsReady) return;
    if (terminalTabs.length >= MAX_TERMINAL_TABS) {
      Alert.alert(
        'Tab limit reached',
        `CyberLab keeps up to ${MAX_TERMINAL_TABS} live terminals open to protect device and laptop memory.`,
      );
      return;
    }
    sendTerminalTabAction('create');
  }

  function selectTerminalTab(terminal: TerminalTab) {
    if (!tabsReady || terminal.active) return;
    setTerminalTabs((current) =>
      current.map((item) => ({ ...item, active: item.id === terminal.id })),
    );
    sendTerminalTabAction('select', terminal.id);
  }

  function closeTerminalTab(terminal: TerminalTab) {
    if (!tabsReady || terminalTabs.length <= 1) return;
    Alert.alert(
      `Close ${terminal.title}?`,
      'Any command running in this terminal will stop. Other terminal tabs will keep running.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close Terminal',
          style: 'destructive',
          onPress: () => {
            sendTerminalTabAction('close', terminal.id);
          },
        },
      ],
    );
  }

  function typeCommandIntoTerminal(command: string, terminalId?: string) {
    webViewRef.current?.injectJavaScript(`
      (function() {
        const command = ${JSON.stringify(command)};
        const terminalId = ${JSON.stringify(terminalId ?? activeTerminal?.id ?? null)};
        if (terminalId && typeof window.terminalTabCommand === 'function') {
          window.terminalTabCommand(terminalId, command);
        } else if (typeof sendKey === 'function') {
          for (const character of command) {
            sendKey(character);
          }
          sendKey('\\r');
        }
      })();
      true;
    `);
  }

  async function handleWebViewMessage(event: WebViewMessageEvent) {
    let payload: unknown;
    try {
      payload = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (typeof payload !== 'object' || payload === null) return;
    const type = (payload as { type?: unknown }).type;

    if (type === 'terminalConnection') {
      const connected = (payload as { connected?: unknown }).connected === true;
      setConnectionState(connected ? 'live' : 'reconnecting');
      if (!connected) setTabsReady(false);
      return;
    }

    if (type === 'terminalTabs') {
      const rawTabs = (payload as { tabs?: unknown }).tabs;
      if (!Array.isArray(rawTabs)) return;
      const nextTabs = rawTabs
        .filter((tab): tab is Record<string, unknown> => typeof tab === 'object' && tab !== null)
        .map((tab) => ({
          id: typeof tab.id === 'string' ? tab.id : '',
          index: typeof tab.index === 'number' ? tab.index : 0,
          title: typeof tab.title === 'string' ? tab.title : 'Terminal',
          command: typeof tab.command === 'string' ? tab.command : 'shell',
          active: tab.active === true,
          running: tab.running !== false,
        }))
        .filter((tab) => tab.id && tab.index > 0)
        .slice(0, MAX_TERMINAL_TABS);
      if (!nextTabs.length) return;
      setTerminalTabs(nextTabs);
      setTabsReady(true);
      const active = nextTabs.find((tab) => tab.active) ?? nextTabs[0];
      setConnectionState(active.running ? 'live' : 'error');
      return;
    }

    if (type === 'terminalTabError') {
      const message = (payload as { message?: unknown }).message;
      const detail = typeof message === 'string' ? message : 'Terminal tab action failed.';
      Alert.alert('Terminal tabs', detail);
      return;
    }

    if (type !== 'copy') return;
    const text = (payload as { text?: unknown }).text;
    if (typeof text !== 'string' || !text) return;

    try {
      await Clipboard.setStringAsync(text);
      webViewRef.current?.injectJavaScript(
        'if (window.__onCopyAck) { window.__onCopyAck(true); } true;'
      );
    } catch (error) {
      webViewRef.current?.injectJavaScript(
        'if (window.__onCopyAck) { window.__onCopyAck(false); } true;'
      );
    }
  }

  function failUpload(stage: string, error?: unknown) {
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'unknown error';
    Alert.alert('Upload failed', `${stage} failed: ${detail}`);
  }

  async function pickScreenshot() {
    const targetTerminalId = tabsReady ? activeTerminal?.id : undefined;
    const targetTerminalTitle = targetTerminalId
      ? activeTerminal?.title ?? 'active terminal'
      : 'the active terminal';
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
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

    if (result.canceled || !result.assets.length) return;

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
      terminalTitle: targetTerminalTitle,
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
      typeCommandIntoTerminal(downloadCommand, targetTerminalId);
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

      <View style={styles.topBar}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>CYBERLAB</Text>
          <Text style={styles.title}>Terminal Shell</Text>
        </View>

        <Animated.View
          accessible
          accessibilityLabel={`Terminal status: ${statusLabel}`}
          accessibilityLiveRegion="polite"
          style={[
            styles.statusPill,
            connectionState === 'live' ? styles.statusPillLive : null,
          ]}
        >
          {connectionState === 'live' ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.statusPulseRing,
                {
                  opacity: pulseOpacity,
                  transform: [{ scale: pulseScale }],
                },
              ]}
            />
          ) : null}
          <Animated.View
            style={[
              styles.statusDot,
              statusTone === 'good'
                ? styles.statusDotGood
                : statusTone === 'warn'
                  ? styles.statusDotWarn
                  : styles.statusDotNeutral,
              connectionState === 'live' ? { opacity: dotOpacity } : null,
            ]}
          />
          <Text
            style={[
              styles.statusText,
              connectionState === 'live' ? styles.statusTextLive : null,
            ]}
          >
            {statusLabel}
          </Text>
        </Animated.View>
      </View>

      <View style={styles.actionRow}>
        <Pressable onPress={reloadTerminal} style={[styles.actionButton, styles.actionPrimary]}>
          <Text style={[styles.actionText, styles.actionTextPrimary]}>⟳  Reload</Text>
        </Pressable>
        <Pressable onPress={pickScreenshot} style={styles.actionButton}>
          <Text style={styles.actionText}>⇪  Upload</Text>
        </Pressable>
        <Pressable onPress={openCopyMode} style={[styles.actionButton, styles.actionAccent]}>
          <Text style={[styles.actionText, styles.actionTextAccent]}>✂  Copy</Text>
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
              Sent the upload command to {pickedScreenshot.terminalTitle}.
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.terminalShell}>
        <View style={styles.tabBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabScrollContent}
            style={styles.tabScroll}
          >
            {terminalTabs.map((terminal) => (
              <View
                key={terminal.id}
                style={[
                  styles.terminalTab,
                  terminal.active ? styles.terminalTabActive : null,
                ]}
              >
                <Pressable
                  onPress={() => selectTerminalTab(terminal)}
                  accessibilityRole="tab"
                  accessibilityLabel={`${terminal.title}, ${terminal.command}`}
                  accessibilityState={{ selected: terminal.active }}
                  style={styles.terminalTabMain}
                >
                  <View
                    style={[
                      styles.terminalTabDot,
                      terminal.running
                        ? styles.terminalTabDotRunning
                        : styles.terminalTabDotStopped,
                    ]}
                  />
                  <View style={styles.terminalTabCopy}>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.terminalTabTitle,
                        terminal.active ? styles.terminalTabTitleActive : null,
                      ]}
                    >
                      {terminal.title}
                    </Text>
                    <Text numberOfLines={1} style={styles.terminalTabCommand}>
                      {terminal.command}
                    </Text>
                  </View>
                </Pressable>
                {tabsReady && terminalTabs.length > 1 ? (
                  <Pressable
                    onPress={() => closeTerminalTab(terminal)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`Close ${terminal.title}`}
                    style={styles.terminalTabClose}
                  >
                    <Text style={styles.terminalTabCloseText}>×</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </ScrollView>
          <Pressable
            onPress={createTerminalTab}
            disabled={!tabsReady || terminalTabs.length >= MAX_TERMINAL_TABS}
            accessibilityRole="button"
            accessibilityLabel="Open a new terminal tab"
            style={[
              styles.addTerminalButton,
              !tabsReady || terminalTabs.length >= MAX_TERMINAL_TABS
                ? styles.addTerminalButtonDisabled
                : null,
            ]}
          >
            <Text style={styles.addTerminalButtonText}>+</Text>
          </Pressable>
        </View>

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
          scrollEnabled
          nestedScrollEnabled
          bounces={false}
          startInLoadingState
          onLoadStart={() => {
            setConnectionState('connecting');
            setTabsReady(false);
          }}
          onError={() => {
            setConnectionState('error');
            setTabsReady(false);
          }}
          onMessage={handleWebViewMessage}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#05070f',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    color: '#29e9ff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 3,
    marginBottom: 2,
  },
  title: {
    color: '#f4fbff',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 24,
  },
  statusPill: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#0a0f1e',
    borderWidth: 1,
    borderColor: '#1b2b45',
  },
  statusPillLive: {
    backgroundColor: '#07160f',
    borderColor: '#00ff9c99',
    shadowColor: '#00ff9c',
    shadowOpacity: 0.62,
    shadowRadius: 11,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  statusPulseRing: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#00ff9c',
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },
  statusDotNeutral: {
    backgroundColor: '#ffb020',
    shadowColor: '#ffb020',
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  statusDotGood: {
    backgroundColor: '#00ff9c',
    shadowColor: '#00ff9c',
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  statusDotWarn: {
    backgroundColor: '#ff2e9a',
    shadowColor: '#ff2e9a',
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  statusText: {
    color: '#d7e8f7',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  statusTextLive: {
    color: '#8dffc9',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 7,
    marginBottom: 10,
  },
  actionButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    backgroundColor: '#0a0f1e',
    borderWidth: 1,
    borderColor: '#1b2b45',
  },
  actionPrimary: {
    borderColor: '#00ff9c66',
    backgroundColor: '#07160f',
  },
  actionAccent: {
    borderColor: '#ff2e9a66',
    backgroundColor: '#170611',
  },
  actionText: {
    color: '#29e9ff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  actionTextPrimary: {
    color: '#00ff9c',
  },
  actionTextAccent: {
    color: '#ff2e9a',
  },
  previewCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    padding: 12,
    marginBottom: 10,
    borderRadius: 14,
    backgroundColor: '#0a0f1e',
    borderWidth: 1,
    borderColor: '#29e9ff33',
  },
  previewThumb: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: '#10284f',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#29e9ff55',
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
    color: '#5f7597',
    fontSize: 12,
    lineHeight: 16,
  },
  terminalShell: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#29e9ff44',
    backgroundColor: '#05070f',
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 7,
    paddingVertical: 7,
    backgroundColor: '#070d1a',
    borderBottomWidth: 1,
    borderBottomColor: '#29e9ff2e',
  },
  tabScroll: {
    flex: 1,
  },
  tabScrollContent: {
    alignItems: 'center',
    gap: 6,
    paddingRight: 2,
  },
  terminalTab: {
    width: 132,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ffffff12',
    backgroundColor: '#0a1221',
    overflow: 'hidden',
  },
  terminalTabActive: {
    borderColor: '#29e9ff99',
    backgroundColor: '#10284f',
  },
  terminalTabMain: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingLeft: 10,
    paddingVertical: 6,
  },
  terminalTabDot: {
    width: 7,
    height: 7,
    flexShrink: 0,
    borderRadius: 999,
  },
  terminalTabDotRunning: {
    backgroundColor: '#75ff8f',
  },
  terminalTabDotStopped: {
    backgroundColor: '#ff8b7c',
  },
  terminalTabCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  terminalTabTitle: {
    color: '#a9bed0',
    fontSize: 12,
    fontWeight: '700',
  },
  terminalTabTitleActive: {
    color: '#f4fbff',
  },
  terminalTabCommand: {
    color: '#6f8aa1',
    fontSize: 9,
    fontWeight: '600',
  },
  terminalTabClose: {
    width: 28,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  terminalTabCloseText: {
    color: '#8ca7bc',
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '500',
  },
  addTerminalButton: {
    width: 44,
    height: 44,
    flexShrink: 0,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#123456',
    borderWidth: 1,
    borderColor: '#29e9ffaa',
  },
  addTerminalButtonDisabled: {
    opacity: 0.38,
  },
  addTerminalButtonText: {
    color: '#6ffff0',
    fontSize: 25,
    lineHeight: 27,
    fontWeight: '500',
  },
  webviewContainer: {
    flex: 1,
    backgroundColor: '#05070f',
  },
  webview: {
    flex: 1,
    backgroundColor: '#05070f',
  },
});
