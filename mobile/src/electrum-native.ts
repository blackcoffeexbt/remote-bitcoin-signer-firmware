import TcpSocket from 'react-native-tcp-socket';
import type { Dial } from './electrum';

export const dialElectrum: Dial = (endpoint, ready, data, failed) => {
  const options = { host: endpoint.host, port: endpoint.port, connectTimeout: 15000 };
  // TLS uses OS trust and hostname verification; no accept-any-certificate option.
  // scripts/patch-tcp-tls.cjs supplies missing Android hostname/SNI handling.
  const socket = endpoint.tls ? TcpSocket.connectTLS(options, ready) : TcpSocket.createConnection(options, ready);
  socket.on('data', chunk => data(typeof chunk === 'string' ? chunk : chunk.toString('utf8')));
  socket.on('error', () => failed(new Error('Electrs connection failed. Check the address, network and TLS certificate.')));
  socket.on('close', () => failed(new Error('Electrs closed the connection')));
  return { write: text => { socket.write(text, 'utf8'); }, close: () => { socket.destroy(); } };
};
