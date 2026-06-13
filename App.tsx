import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

const DEFAULT_RELAY_URL = 'wss://terminal-connection-production.up.railway.app';
const DEFAULT_RELAY_TOKEN = 'kali-remote-secret-token-123';

const htmlContent = String.raw`
<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.3.0/css/xterm.css" />
    <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.3.0/lib/xterm.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.8.0/lib/addon-fit.js"></script>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        background: #050816;
        overflow: hidden;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        display: flex;
        flex-direction: column;
      }
      #status {
        padding: 10px 14px;
        color: #d7e8f7;
        background: #09111f;
        border-bottom: 1px solid rgba(41, 233, 255, 0.15);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      #terminal {
        flex: 1;
        min-height: 0;
      }
      #keys-row {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 6px;
        padding: 10px;
        background: #07101c;
        border-top: 1px solid rgba(41, 233, 255, 0.12);
      }
      .key-btn {
        border: 1px solid rgba(41, 233, 255, 0.18);
        border-radius: 10px;
        background: #0d1830;
        color: #effcff;
        padding: 10px 6px;
        font-size: 12px;
        font-weight: 700;
      }
      .key-btn:active {
        background: #17305c;
      }
    </style>
  </head>
  <body>
    <div id="status">Disconnected</div>
    <div id="terminal"></div>
    <div id="keys-row">
      <button class="key-btn" onclick="sendKey('\x1b[A')">▲</button>
      <button class="key-btn" onclick="sendKey('\x1b[B')">▼</button>
      <button class="key-btn" onclick="sendKey('\x1b[D')">◀</button>
      <button class="key-btn" onclick="sendKey('\x1b[C')">▶</button>
      <button class="key-btn" onclick="sendKey('\t')">Tab</button>
      <button class="key-btn" onclick="sendKey('\x03')">Ctrl+C</button>
      <button class="key-btn" onclick="pasteClipboard()">Paste</button>
    </div>

    <script src="https://cdn.socket.io/4.7.4/socket.io.min.js"></script>
    <script>
      const term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontSize: 13,
        fontFamily: 'Menlo, Monaco, Consolas, Courier New, monospace',
        theme: {
          background: '#050816',
          foreground: '#e8f7ff',
          cursor: '#29e9ff'
        }
      });
      const fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(document.getElementById('terminal'));
      fitAddon.fit();

      let socket = null;
      const statusEl = document.getElementById('status');

      window.addEventListener('resize', () => fitAddon.fit());

      function notifyRN(type, payload) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type, ...payload }));
        }
      }

      function setStatus(text) {
        statusEl.textContent = text;
      }

      function loadSocketIO(callback) {
        if (typeof io !== 'undefined') {
          callback();
          return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.4/socket.io.min.js';
        script.onload = callback;
        script.onerror = () => {
          term.writeln('\\r\\nError: Socket.IO client failed to load.\\r\\n');
          setStatus('Socket.IO load failed');
          notifyRN('disconnected', {});
        };
        document.head.appendChild(script);
      }

      function connect(url, token) {
        if (socket) {
          socket.off();
          socket.disconnect();
          socket = null;
        }

        const httpUrl = url.replace(/^wss:\\/\\//, 'https://').replace(/^ws:\\/\\//, 'http://');
        setStatus('Connecting to ' + httpUrl);
        term.writeln('\\r\\nConnecting to ' + httpUrl + '...\\r\\n');

        loadSocketIO(() => {
          try {
            const thisSocket = io(httpUrl, { transports: ['websocket', 'polling'] });
            socket = thisSocket;

            thisSocket.on('connect', () => {
              if (socket !== thisSocket) return;
              setStatus('Authenticating');
              term.writeln('Connected. Authenticating...\\r\\n');
              thisSocket.emit('auth', token);
              notifyRN('connected', {});
            });

            thisSocket.on('data', (msg) => {
              if (socket !== thisSocket) return;
              term.write(msg);
            });

            thisSocket.on('disconnect', () => {
              if (socket !== thisSocket) return;
              setStatus('Disconnected');
              term.writeln('\\r\\nDisconnected.\\r\\n');
              notifyRN('disconnected', {});
            });

            thisSocket.on('connect_error', (err) => {
              if (socket !== thisSocket) return;
              setStatus('Connection error');
              term.writeln('\\r\\nConnection error: ' + err.message + '\\r\\n');
              notifyRN('disconnected', {});
            });

            notifyRN('connecting', {});
          } catch (e) {
            setStatus('Failed to connect');
            term.writeln('\\r\\nFailed to connect: ' + e.message + '\\r\\n');
            notifyRN('disconnected', {});
          }
        });
      }

      function sendData(data) {
        if (socket && socket.connected) {
          socket.emit('data', data);
          term.focus();
        }
      }

      function sendKey(sequence) {
        sendData(sequence);
      }

      async function pasteClipboard() {
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            sendData('\\x1b[200~' + text + '\\x1b[201~');
          }
        } catch (e) {
          term.writeln('\\r\\n[Clipboard access denied]\\r\\n');
        }
      }

      window.addEventListener('message', function(event) {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'connect') {
            connect(data.url, data.token);
          } else if (data.type === 'disconnect') {
            if (socket) {
              socket.disconnect();
            }
          } else if (data.type === 'data' && typeof data.data === 'string') {
            sendData(data.data);
          }
        } catch (e) {
          console.error('Error parsing message', e);
        }
      });
    </script>
  </body>
</html>
`;

export default function App() {
  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY_URL);
  const [relayToken, setRelayToken] = useState(DEFAULT_RELAY_TOKEN);
  const [isConnected, setIsConnected] = useState(false);
  const [statusLabel, setStatusLabel] = useState('Connecting');
  const [statusTone, setStatusTone] = useState<'neutral' | 'good' | 'warn'>('neutral');
  const [showSettings, setShowSettings] = useState(false);
  const [pickedScreenshot, setPickedScreenshot] = useState<{
    uri: string;
    name: string;
    width?: number;
    height?: number;
  } | null>(null);
  const autoConnectRef = useRef(false);
  const webViewRef = useRef<WebView>(null);

  function sendToWebView(payload: Record<string, unknown>) {
    const json = JSON.stringify(payload);
    webViewRef.current?.injectJavaScript(`
      window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(json)} }));
      true;
    `);
  }

  function connectToRelay() {
    if (!relayUrl.trim() || !relayToken.trim()) {
      setStatusLabel('Missing relay config');
      setStatusTone('warn');
      return;
    }

    setStatusLabel('Connecting');
    setStatusTone('neutral');
    sendToWebView({
      type: 'connect',
      url: relayUrl.trim(),
      token: relayToken.trim(),
    });
  }

  function disconnectRelay() {
    sendToWebView({ type: 'disconnect' });
    setIsConnected(false);
    setStatusLabel('Disconnecting');
    setStatusTone('neutral');
  }

  function toggleRelay() {
    if (isConnected) {
      disconnectRelay();
    } else {
      connectToRelay();
    }
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

    if (isConnected) {
      sendToWebView({ type: 'data', data: `${uploadScript}\r` });
      setStatusLabel('Screenshot sent');
      setStatusTone('good');
      return;
    }

    await Clipboard.setStringAsync(uploadScript);
    setStatusLabel('Command copied');
    setStatusTone('warn');
    Alert.alert(
      'Terminal not connected',
      'The upload command was copied to your clipboard. Connect to the relay, then paste it into the terminal session.',
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>CyberLab Terminal</Text>
          <Text style={styles.title}>Relay-backed session</Text>
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
        <Pressable onPress={toggleRelay} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{isConnected ? 'Disconnect' : 'Connect'}</Text>
        </Pressable>
        <Pressable onPress={pickScreenshot} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Upload Screenshot</Text>
        </Pressable>
        <Pressable onPress={() => setShowSettings((current) => !current)} style={styles.ghostButton}>
          <Text style={styles.ghostButtonText}>Settings</Text>
        </Pressable>
      </View>

      {showSettings ? (
        <View style={styles.settingsCard}>
          <Text style={styles.settingsLabel}>Relay URL</Text>
          <TextInput
            style={styles.input}
            value={relayUrl}
            onChangeText={setRelayUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="wss://relay.example.com"
            placeholderTextColor="#6d8096"
          />
          <Text style={styles.settingsLabel}>Auth token</Text>
          <TextInput
            style={styles.input}
            value={relayToken}
            onChangeText={setRelayToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder="token"
            placeholderTextColor="#6d8096"
          />
        </View>
      ) : null}

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
              Sent through the relay session when connected.
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.terminalShell}>
        <WebView
          ref={webViewRef}
          source={{ html: htmlContent }}
          style={styles.webview}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures={false}
          bounces={false}
          scrollEnabled={false}
          onLoadEnd={() => {
            if (!autoConnectRef.current) {
              autoConnectRef.current = true;
              setTimeout(connectToRelay, 200);
            }
          }}
          onMessage={(event) => {
            try {
              const data = JSON.parse(event.nativeEvent.data);
              if (data.type === 'connected') {
                setIsConnected(true);
                setStatusLabel('Live');
                setStatusTone('good');
              } else if (data.type === 'connecting') {
                setStatusLabel('Connecting');
                setStatusTone('neutral');
              } else if (data.type === 'disconnected') {
                setIsConnected(false);
                setStatusLabel('Disconnected');
                setStatusTone('warn');
              }
            } catch {
              // ignore
            }
          }}
          onError={() => {
            setIsConnected(false);
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
    backgroundColor: '#050816',
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
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    color: '#29e9ff',
    fontSize: 11,
    fontWeight: '800',
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
  ghostButton: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#09111f',
    borderWidth: 1,
    borderColor: '#ffffff14',
  },
  ghostButtonText: {
    color: '#d7e8f7',
    fontSize: 14,
    fontWeight: '700',
  },
  settingsCard: {
    padding: 12,
    borderRadius: 18,
    backgroundColor: '#08111f',
    borderWidth: 1,
    borderColor: '#29e9ff22',
    marginBottom: 12,
    gap: 8,
  },
  settingsLabel: {
    color: '#8ca7bc',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#294262',
    backgroundColor: '#0b1325',
    color: '#f4fbff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
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
  webview: {
    flex: 1,
    backgroundColor: '#050816',
  },
});
