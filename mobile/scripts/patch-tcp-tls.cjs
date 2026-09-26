// react-native-tcp-socket 6.4.3 validates CA trust on Android but does not check
// the requested hostname. Keep SNI and HTTPS-style endpoint verification bound
// to that hostname. Fail closed if an upstream update changes these anchors.
const fs = require('node:fs');
const path = require('node:path');
const root = path.dirname(require.resolve('react-native-tcp-socket/package.json'));
if (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version !== '6.4.3') throw new Error('Review TCP TLS patch for this dependency version');
const file = path.join(root, 'android/src/main/java/com/asterinet/react/tcpsocket/TcpSocketClient.java');
let source = fs.readFileSync(file, 'utf8');
if (!source.includes('// RemoteSigner: bind TLS to the requested hostname.')) {
  const replace = (a, b) => { if (!source.includes(a)) throw new Error('TCP TLS patch anchor changed'); source = source.replace(a, b); };
  replace('private Socket socket;', 'private Socket socket;\n    private String requestedHost;');
  replace(`        if (tlsOptions != null) {
            SSLSocketFactory ssf = getSSLSocketFactory(context, tlsOptions);
            socket = ssf.createSocket();
            ((SSLSocket) socket).setUseClientMode(true);
        } else {
            socket = new Socket();
        }`, `        requestedHost = address;
        socket = new Socket();`);
  replace('        if (socket instanceof SSLSocket) ((SSLSocket) socket).startHandshake();', '        if (tlsOptions != null) startTLS(context, tlsOptions);');
  replace('ssf.createSocket(socket, socket.getInetAddress().getHostAddress(), socket.getPort(), true)', 'ssf.createSocket(socket, requestedHost, socket.getPort(), true)');
  replace('        sslSocket.startHandshake();', `        // RemoteSigner: bind TLS to the requested hostname.
        javax.net.ssl.SSLParameters parameters = sslSocket.getSSLParameters();
        parameters.setEndpointIdentificationAlgorithm("HTTPS");
        sslSocket.setSSLParameters(parameters);
        sslSocket.startHandshake();`);
  fs.writeFileSync(file, source);
}
