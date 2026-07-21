import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
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

// Accessory-key escape sequences sent into the live terminal.
const KEY_SEQUENCES: Record<string, string> = {
  left: '\x1b[D',
  right: '\x1b[C',
  up: '\x1b[A',
  down: '\x1b[B',
  esc: '\x1b',
  tab: '\t',
  backspace: '\x7f',
  interrupt: '\x03',
};

const DEFAULT_SNIPPETS = ['nmap -sV -T4', 'msfconsole -q', 'tcpdump -i eth0'];

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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [terminalFontSize, setTerminalFontSize] = useState(13);
  const [reconnectOnWake, setReconnectOnWake] = useState(true);
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);
  const [snippets, setSnippets] = useState<string[]>(DEFAULT_SNIPPETS);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatusText, setUpdateStatusText] = useState<string | null>(null);
  const webViewRef = useRef<WebView>(null);

  const activeTerminal =
    terminalTabs.find((terminal) => terminal.active) ?? terminalTabs[0];
  const statusLabel =
    connectionState === 'live'
      ? 'Connected'
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

  // Push the chosen terminal font size into the live terminal client.
  useEffect(() => {
    webViewRef.current?.injectJavaScript(`
      (function() {
        document.documentElement.style.setProperty('--rn-font-size', '${terminalFontSize}px');
        if (typeof window.setTerminalFontSize === 'function') {
          window.setTerminalFontSize(${terminalFontSize});
        }
      })();
      true;
    `);
  }, [terminalFontSize, webKey]);

  // Track the system keyboard so the accessory dock rides just above it.
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) =>
      setKbHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // The dock's marginBottom (above) shrinks the WebView's flex:1 container
  // to make room for the keyboard, but the terminal inside never re-fits to
  // that smaller size on its own — so its bottom rows end up rendered below
  // the visible viewport instead of reflowing into it. Nudge a re-fit once
  // RN's layout pass has settled.
  useEffect(() => {
    const timer = setTimeout(() => {
      webViewRef.current?.injectJavaScript(`
        if (typeof window.sendResize === 'function') { window.sendResize(); }
        true;
      `);
    }, 80);
    return () => clearTimeout(timer);
  }, [kbHeight, webKey]);

  function reloadTerminal() {
    setConnectionState('reconnecting');
    setTabsReady(false);
    setDrawerOpen(false);
    setWebKey((current) => current + 1);
  }

  const currentUpdateLabel = Updates.isEmbeddedLaunch
    ? 'Embedded build (no update applied)'
    : Updates.updateId
      ? `${Updates.updateId.slice(0, 8)} · ${
          Updates.createdAt ? Updates.createdAt.toLocaleString() : 'unknown date'
        }`
      : 'Unknown';

  async function checkForUpdates() {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    setUpdateStatusText(null);
    try {
      if (!Updates.isEnabled) {
        setUpdateStatusText('Updates are disabled in this build.');
        return;
      }
      const result = await Updates.checkForUpdateAsync();
      // A rollback directive reports isAvailable: false too, so it can't be
      // told apart from "nothing new" by that flag alone — check
      // isRollBackToEmbedded separately or a bad OTA can never be rolled
      // back from this screen.
      if (!result.isAvailable && !result.isRollBackToEmbedded) {
        setUpdateStatusText("You're up to date.");
        return;
      }
      setUpdateStatusText(
        result.isRollBackToEmbedded ? 'Rolling back…' : 'Downloading update…',
      );
      const fetchResult = await Updates.fetchUpdateAsync();
      if (!fetchResult.isNew && !fetchResult.isRollBackToEmbedded) {
        setUpdateStatusText("You're up to date.");
        return;
      }
      setUpdateStatusText(
        fetchResult.isRollBackToEmbedded ? 'Rollback ready.' : 'Update downloaded.',
      );
      Alert.alert(
        fetchResult.isRollBackToEmbedded ? 'Rollback ready' : 'Update ready',
        fetchResult.isRollBackToEmbedded
          ? 'The server has rolled back to a previous version. Restart now to apply it?'
          : 'A new version has been downloaded. Restart now to apply it?',
        [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Restart',
            onPress: () => {
              void Updates.reloadAsync();
            },
          },
        ],
      );
    } catch (error) {
      setUpdateStatusText(
        error instanceof Error ? `Check failed: ${error.message}` : 'Check failed.',
      );
    } finally {
      setCheckingUpdate(false);
    }
  }

  function sendKeySequence(seq: string) {
    webViewRef.current?.injectJavaScript(`
      (function() {
        const seq = ${JSON.stringify(seq)};
        if (typeof sendKey === 'function') {
          for (const character of seq) { sendKey(character); }
        }
      })();
      true;
    `);
  }

  function pressAccessoryKey(name: keyof typeof KEY_SEQUENCES) {
    const seq = KEY_SEQUENCES[name];
    if (seq) sendKeySequence(seq);
  }

  async function pasteFromClipboard() {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text) return;
      // Bracketed paste keeps multi-line clipboard content from being
      // interpreted as separate Enter-terminated commands by the shell.
      webViewRef.current?.injectJavaScript(`
        (function() {
          const text = ${JSON.stringify(text)};
          if (typeof sendKey === 'function') {
            sendKey('\\x1b[200~' + text + '\\x1b[201~');
          }
        })();
        true;
      `);
    } catch (error) {
      Alert.alert(
        'Paste failed',
        error instanceof Error ? error.message : 'Could not read the clipboard.',
      );
    }
  }

  function toggleCtrl() {
    setCtrlArmed((current) => !current);
  }

  function runSnippet(command: string) {
    typeCommandIntoTerminal(command);
    setDrawerOpen(false);
  }

  function adjustFontSize(delta: number) {
    setTerminalFontSize((current) =>
      Math.min(20, Math.max(10, current + delta)),
    );
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

    try {
      let uploadUrl = '';

      try {
        const formData = new FormData();
        // catbox.moe's API only recognizes the file under this exact field
        // name — anything else (e.g. "file") is silently ignored, and catbox
        // still hands back a URL, just one pointing at a 0-byte object.
        formData.append('fileToUpload', {
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

      // catbox can return a URL for a request it accepted but attached no
      // bytes to (e.g. a field-name mismatch) — confirm the object actually
      // has content before handing a download command to the terminal,
      // rather than letting that surface later as a silent 0-byte file.
      try {
        const headResponse = await fetch(uploadUrl, { method: 'HEAD' });
        const contentLength = headResponse.headers.get('content-length');
        if (headResponse.ok && contentLength !== null && Number(contentLength) === 0) {
          throw new Error('upload host returned an empty file');
        }
      } catch (verifyError) {
        if (verifyError instanceof Error && verifyError.message === 'upload host returned an empty file') {
          throw verifyError;
        }
        // HEAD itself failing (network hiccup, method not supported) isn't
        // proof of an empty file — don't block the flow on that.
      }

      const downloadCommand = `curl -fsSL ${JSON.stringify(uploadUrl)} -o /tmp/${safeBaseName}-${Date.now()}.${ext}`;
      typeCommandIntoTerminal(downloadCommand, targetTerminalId);
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

  const accessoryKeys: {
    key: keyof typeof KEY_SEQUENCES | 'ctrl' | 'paste';
    label: string;
    accent?: boolean;
  }[] = [
    { key: 'left', label: '←', accent: true },
    { key: 'right', label: '→', accent: true },
    { key: 'up', label: '↑', accent: true },
    { key: 'down', label: '↓', accent: true },
    { key: 'esc', label: 'esc' },
    { key: 'tab', label: 'tab' },
    { key: 'ctrl', label: 'ctrl' },
    { key: 'interrupt', label: '^C' },
    { key: 'paste', label: 'paste' },
    { key: 'backspace', label: '⌫' },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      {/* TOP BAR: tab pills · + · upload · hamburger */}
      <View style={styles.topBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabScrollContent}
          style={styles.tabScroll}
        >
          {terminalTabs.map((terminal) => (
            <Pressable
              key={terminal.id}
              onPress={() => selectTerminalTab(terminal)}
              onLongPress={() => closeTerminalTab(terminal)}
              accessibilityRole="tab"
              accessibilityLabel={`${terminal.title}, ${terminal.command}`}
              accessibilityState={{ selected: terminal.active }}
              style={[styles.tabPill, terminal.active ? styles.tabPillActive : null]}
            >
              <View
                style={[
                  styles.tabDot,
                  terminal.running ? styles.tabDotRunning : styles.tabDotStopped,
                ]}
              />
              <Text
                style={[
                  styles.tabPillText,
                  terminal.active ? styles.tabPillTextActive : null,
                ]}
              >
                {terminal.index}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={createTerminalTab}
            disabled={!tabsReady || terminalTabs.length >= MAX_TERMINAL_TABS}
            accessibilityRole="button"
            accessibilityLabel="Open a new terminal tab"
            style={[
              styles.addPill,
              !tabsReady || terminalTabs.length >= MAX_TERMINAL_TABS
                ? styles.addPillDisabled
                : null,
            ]}
          >
            <Text style={styles.addPillText}>+</Text>
          </Pressable>
        </ScrollView>

        <View style={styles.topBarRight}>
          <Pressable
            onPress={pickScreenshot}
            accessibilityRole="button"
            accessibilityLabel="Upload a file to the terminal"
            style={styles.uploadPill}
          >
            <Text style={styles.uploadPillIcon}>⇪</Text>
            <Text style={styles.uploadPillText}>Upload</Text>
          </Pressable>
          <Pressable
            onPress={() => setDrawerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Open menu"
            hitSlop={8}
            style={styles.hamburger}
          >
            <View style={[styles.hamburgerLine, { width: 17 }]} />
            <View style={[styles.hamburgerLine, { width: 17 }]} />
            <View style={[styles.hamburgerLine, { width: 11 }]} />
          </Pressable>
        </View>
      </View>

      {/* TERMINAL */}
      <View style={styles.terminalShell}>
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

      {/* BOTTOM DOCK: accessory key row (rides above the system keyboard) */}
      <View style={[styles.dock, { marginBottom: kbHeight }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.keyRow}
        >
          {accessoryKeys.map((cap) => {
            const isCtrl = cap.key === 'ctrl';
            const ctrlOn = isCtrl && ctrlArmed;
            return (
              <Pressable
                key={cap.key}
                onPress={() =>
                  isCtrl
                    ? toggleCtrl()
                    : cap.key === 'paste'
                      ? pasteFromClipboard()
                      : pressAccessoryKey(cap.key as keyof typeof KEY_SEQUENCES)
                }
                accessibilityRole="button"
                accessibilityLabel={cap.label}
                style={({ pressed }) => [
                  styles.keyCap,
                  cap.accent ? styles.keyCapAccent : null,
                  ctrlOn ? styles.keyCapArmed : null,
                  pressed ? styles.keyCapPressed : null,
                ]}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                  style={[
                    styles.keyCapText,
                    cap.accent ? styles.keyCapTextAccent : null,
                    ctrlOn ? styles.keyCapTextArmed : null,
                  ]}
                >
                  {cap.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* DRAWER */}
      <Modal
        visible={drawerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setDrawerOpen(false)}
      >
        <Pressable style={styles.drawerBackdrop} onPress={() => setDrawerOpen(false)} />
        <SafeAreaView style={styles.drawerSafe} pointerEvents="box-none">
          <View style={styles.drawer}>
            <View style={styles.drawerHeader}>
              <View style={styles.brandRow}>
                <View style={styles.brandMark}>
                  <Text style={styles.brandMarkText}>{'>_'}</Text>
                </View>
                <View>
                  <Text style={styles.brandName}>CyberLab</Text>
                  <Text style={styles.brandSub}>TERMINAL · v2.0</Text>
                </View>
              </View>
              <Pressable onPress={() => setDrawerOpen(false)} hitSlop={8}>
                <Text style={styles.drawerClose}>×</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.drawerBody} contentContainerStyle={styles.drawerBodyContent}>
              {/* connection */}
              <View
                style={[
                  styles.connCard,
                  statusTone === 'good'
                    ? styles.connCardGood
                    : statusTone === 'warn'
                      ? styles.connCardWarn
                      : styles.connCardNeutral,
                ]}
              >
                <View style={styles.connTop}>
                  <View style={styles.connStatusRow}>
                    <View
                      style={[
                        styles.connDot,
                        statusTone === 'good'
                          ? styles.tabDotRunning
                          : statusTone === 'warn'
                            ? styles.connDotWarn
                            : styles.connDotNeutral,
                      ]}
                    />
                    <Text
                      style={[
                        styles.connStatusText,
                        statusTone === 'good' ? styles.connStatusTextGood : null,
                      ]}
                    >
                      {statusLabel.toUpperCase()}
                    </Text>
                  </View>
                </View>
                <View style={styles.connRelayRow}>
                  <Text style={styles.connRelayText}>Railway relay</Text>
                  <Text style={styles.connArrow}>→</Text>
                  <Text style={styles.connRelayText}>kali-laptop</Text>
                </View>
                <Text style={styles.connMeta}>terminal.vitallity.org · 10.0.0.4</Text>
              </View>

              {/* snippets */}
              <Text style={styles.sectionLabel}>SNIPPETS</Text>
              {snippets.map((cmd) => (
                <Pressable
                  key={cmd}
                  onPress={() => runSnippet(cmd)}
                  style={styles.snippetRow}
                >
                  <Text style={styles.snippetText}>{cmd}</Text>
                  <Text style={styles.snippetRun}>▷</Text>
                </Pressable>
              ))}

              {/* settings */}
              <Text style={styles.sectionLabel}>SETTINGS</Text>
              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>Font size</Text>
                <View style={styles.stepper}>
                  <Pressable onPress={() => adjustFontSize(-1)} style={styles.stepBtn}>
                    <Text style={styles.stepBtnText}>−</Text>
                  </Pressable>
                  <Text style={styles.stepValue}>{terminalFontSize}</Text>
                  <Pressable onPress={() => adjustFontSize(1)} style={styles.stepBtn}>
                    <Text style={styles.stepBtnText}>+</Text>
                  </Pressable>
                </View>
              </View>

              <Pressable
                onPress={() => setReconnectOnWake((v) => !v)}
                style={styles.settingRow}
              >
                <Text style={styles.settingLabel}>Reconnect on wake</Text>
                <View
                  style={[
                    styles.toggleTrack,
                    reconnectOnWake ? styles.toggleTrackOn : styles.toggleTrackOff,
                  ]}
                >
                  <View
                    style={[
                      styles.toggleKnob,
                      reconnectOnWake ? styles.toggleKnobOn : styles.toggleKnobOff,
                    ]}
                  />
                </View>
              </Pressable>

              <View style={styles.settingRow}>
                <Text style={styles.settingLabel}>Live terminals</Text>
                <Text style={styles.settingMeta}>{terminalTabs.length} / {MAX_TERMINAL_TABS}</Text>
              </View>

              {/* updates */}
              <Text style={styles.sectionLabel}>UPDATES</Text>
              <View style={styles.updateCard}>
                <View style={styles.updateRow}>
                  <Text style={styles.updateRowLabel}>Current</Text>
                  <Text style={styles.updateRowValue} numberOfLines={1}>
                    {currentUpdateLabel}
                  </Text>
                </View>
                <View style={styles.updateRow}>
                  <Text style={styles.updateRowLabel}>Channel</Text>
                  <Text style={styles.updateRowValue}>{Updates.channel ?? 'n/a'}</Text>
                </View>
                <Pressable
                  onPress={checkForUpdates}
                  disabled={checkingUpdate}
                  accessibilityRole="button"
                  accessibilityLabel="Check for updates"
                  style={[styles.updateCheckBtn, checkingUpdate ? styles.updateCheckBtnBusy : null]}
                >
                  {checkingUpdate ? (
                    <ActivityIndicator size="small" color={CY} />
                  ) : (
                    <Text style={styles.updateCheckBtnText}>Check for Updates</Text>
                  )}
                </Pressable>
                {updateStatusText ? (
                  <Text style={styles.updateStatusText}>{updateStatusText}</Text>
                ) : null}
              </View>
            </ScrollView>

            <View style={styles.drawerFooter}>
              <Pressable onPress={reloadTerminal} style={styles.reconnectBtn}>
                <Text style={styles.reconnectBtnText}>⟳  Reconnect</Text>
              </Pressable>
              <Pressable onPress={reloadTerminal} style={styles.powerBtn}>
                <Text style={styles.powerBtnText}>⏻</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const CY = '#29e9ff';
const GREEN = '#00ff9c';
const PINK = '#ff6ac1';

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#060910',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    height: 46,
    paddingLeft: 12,
    paddingRight: 12,
  },
  tabScroll: {
    flex: 1,
  },
  tabScrollContent: {
    alignItems: 'center',
    gap: 7,
    paddingRight: 4,
  },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  tabPillActive: {
    backgroundColor: 'rgba(41,233,255,0.1)',
    borderColor: 'rgba(41,233,255,0.4)',
  },
  tabDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
  },
  tabDotRunning: {
    backgroundColor: GREEN,
  },
  tabDotStopped: {
    backgroundColor: '#6f8aa1',
  },
  tabPillText: {
    color: '#6f8aa1',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Menlo',
  },
  tabPillTextActive: {
    color: '#bfeeff',
  },
  addPill: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#2a3a52',
  },
  addPillDisabled: {
    opacity: 0.4,
  },
  addPillText: {
    color: '#6f8aa1',
    fontSize: 17,
    lineHeight: 19,
    fontWeight: '500',
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  uploadPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: 13,
    borderRadius: 9,
    backgroundColor: '#0d1524',
    borderWidth: 1,
    borderColor: '#24334a',
  },
  uploadPillIcon: {
    color: '#8aa3ba',
    fontSize: 15,
  },
  uploadPillText: {
    color: '#8aa3ba',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Menlo',
  },
  hamburger: {
    width: 34,
    height: 34,
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 3.5,
  },
  hamburgerLine: {
    height: 2,
    borderRadius: 2,
    backgroundColor: '#8aa3ba',
  },
  terminalShell: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#060910',
  },
  webviewContainer: {
    flex: 1,
    backgroundColor: '#060910',
  },
  webview: {
    flex: 1,
    backgroundColor: '#060910',
  },
  dock: {
    backgroundColor: '#080d18',
    borderTopWidth: 1,
    borderTopColor: 'rgba(41,233,255,0.16)',
    paddingTop: 10,
    paddingBottom: 10,
  },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  keyCap: {
    width: 54,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#141c2b',
    borderWidth: 1,
    borderColor: '#24334a',
  },
  keyCapAccent: {
    borderColor: 'rgba(41,233,255,0.33)',
  },
  keyCapArmed: {
    backgroundColor: 'rgba(41,233,255,0.16)',
    borderColor: CY,
  },
  keyCapPressed: {
    backgroundColor: '#20304a',
  },
  keyCapText: {
    color: '#b7cbdd',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Menlo',
  },
  keyCapTextAccent: {
    color: CY,
  },
  keyCapTextArmed: {
    color: CY,
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(4,7,14,0.62)',
  },
  drawerSafe: {
    flex: 1,
    alignItems: 'flex-end',
  },
  drawer: {
    width: 322,
    flex: 1,
    backgroundColor: '#0b1424',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(41,233,255,0.22)',
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandMark: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: CY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkText: {
    color: '#04121a',
    fontSize: 16,
    fontWeight: '800',
    fontFamily: 'Menlo',
  },
  brandName: {
    color: '#f4fbff',
    fontSize: 15,
    fontWeight: '800',
  },
  brandSub: {
    color: '#5f7590',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.5,
    fontFamily: 'Menlo',
  },
  drawerClose: {
    color: '#6f8aa1',
    fontSize: 24,
    lineHeight: 26,
  },
  drawerBody: {
    flex: 1,
  },
  drawerBodyContent: {
    padding: 16,
  },
  connCard: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
  },
  connCardGood: {
    backgroundColor: 'rgba(0,255,156,0.05)',
    borderColor: 'rgba(0,255,156,0.28)',
  },
  connCardWarn: {
    backgroundColor: 'rgba(255,106,193,0.06)',
    borderColor: 'rgba(255,106,193,0.3)',
  },
  connCardNeutral: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderColor: 'rgba(255,255,255,0.08)',
  },
  connTop: {
    marginBottom: 10,
  },
  connStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  connDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  connDotWarn: {
    backgroundColor: PINK,
  },
  connDotNeutral: {
    backgroundColor: '#ffb020',
  },
  connStatusText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: '#8aa3ba',
    fontFamily: 'Menlo',
  },
  connStatusTextGood: {
    color: GREEN,
  },
  connRelayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  connRelayText: {
    color: '#cfe3ee',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Menlo',
  },
  connArrow: {
    color: CY,
    fontSize: 12,
  },
  connMeta: {
    color: '#5f7590',
    fontSize: 11,
    marginTop: 5,
    fontFamily: 'Menlo',
  },
  sectionLabel: {
    color: '#5f7590',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
    fontFamily: 'Menlo',
    marginTop: 20,
    marginBottom: 9,
    marginLeft: 4,
  },
  snippetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 6,
  },
  snippetText: {
    color: '#bfeeff',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Menlo',
  },
  snippetRun: {
    color: CY,
    fontSize: 14,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 42,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginBottom: 6,
  },
  settingLabel: {
    color: '#cfe3ee',
    fontSize: 13,
    fontWeight: '500',
  },
  settingMeta: {
    color: '#5f7590',
    fontSize: 11,
    fontFamily: 'Menlo',
  },
  updateCard: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderColor: 'rgba(255,255,255,0.08)',
  },
  updateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  updateRowLabel: {
    color: '#5f7590',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    fontFamily: 'Menlo',
  },
  updateRowValue: {
    color: '#cfe3ee',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Menlo',
    flexShrink: 1,
    marginLeft: 12,
    textAlign: 'right',
  },
  updateCheckBtn: {
    height: 40,
    marginTop: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(41,233,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(41,233,255,0.35)',
  },
  updateCheckBtnBusy: {
    opacity: 0.7,
  },
  updateCheckBtnText: {
    color: CY,
    fontSize: 13,
    fontWeight: '700',
  },
  updateStatusText: {
    color: '#5f7590',
    fontSize: 11,
    fontFamily: 'Menlo',
    marginTop: 8,
    textAlign: 'center',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepBtn: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: '#141c2b',
    borderWidth: 1,
    borderColor: '#24334a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    color: '#8aa3ba',
    fontSize: 14,
  },
  stepValue: {
    color: '#cfe3ee',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Menlo',
    minWidth: 16,
    textAlign: 'center',
  },
  toggleTrack: {
    width: 42,
    height: 25,
    borderRadius: 13,
    justifyContent: 'center',
  },
  toggleTrackOn: {
    backgroundColor: GREEN,
  },
  toggleTrackOff: {
    backgroundColor: '#2a3a52',
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: '#04121a',
    position: 'absolute',
  },
  toggleKnobOn: {
    right: 2.5,
  },
  toggleKnobOff: {
    left: 2.5,
  },
  drawerFooter: {
    flexDirection: 'row',
    gap: 9,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  reconnectBtn: {
    flex: 1,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: 'rgba(41,233,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(41,233,255,0.4)',
  },
  reconnectBtnText: {
    color: CY,
    fontSize: 13,
    fontWeight: '700',
  },
  powerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: 'rgba(255,106,193,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,106,193,0.32)',
  },
  powerBtnText: {
    color: PINK,
    fontSize: 16,
  },
});
