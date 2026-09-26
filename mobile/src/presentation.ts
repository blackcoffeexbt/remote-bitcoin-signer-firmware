export function formatSats(value: bigint | string) { return BigInt(value).toLocaleString('en-US'); }
export function formatBtc(value: bigint) {
  const whole = value / 100000000n, fraction = (value % 100000000n).toString().padStart(8, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
}
export function shorten(value: string, length = 8) { return value.length > length * 2 + 1 ? `${value.slice(0, length)}…${value.slice(-length)}` : value; }
export function approvalStatus(status: string, pinRequired: boolean) {
  if (pinRequired) return 'Enter your device PIN';
  if (/approve on device|Ready to sign —/.test(status)) return 'Approve on your signing device';
  if (/Automatically approved/.test(status)) return 'Approved by your device';
  if (/Decrypting|unlock/i.test(status)) return 'Unlocking your signing device…';
  if (/Validating|Verifying/.test(status)) return 'Checking your payment…';
  if (/Signing complete|Signed PSBT verified/.test(status)) return 'Finishing your payment…';
  if (/^Signing$/.test(status)) return 'Your device is signing…';
  if (/Stopped|Disconnected|timed out/i.test(status)) return 'Approval interrupted. Check your device before retrying.';
  return 'Waiting for your signing device…';
}
// Show actionable wallet language, never arbitrary backend messages or debug text.
export function walletError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value || '');
  if (!message) return '';
  if (/PIN|cooldown/i.test(message)) return /cooldown/i.test(message) ? 'Please wait before trying your device PIN again.' : 'Check your wallet PIN and try again on your signing device.';
  if (/insufficient|Select at least|Choose between|32 spendable|selected coin/i.test(message)) return 'Choose enough available coins to cover the payment and network fee.';
  if (/dust|positive whole-satoshi|recipient amount/i.test(message)) return 'Enter a valid amount that is large enough to send.';
  if (/recipient|Taproot/i.test(message)) return 'Check the recipient address. Use a Testnet4 legacy or SegWit address.';
  if (/Fee rate|fee estimates.*old/i.test(message)) return 'Choose a current network fee or enter a valid custom rate.';
  if (/mempool.space|fee response|Fee response|fee estimates/i.test(message)) return 'Fee estimates are unavailable. Try again or choose a custom fee.';
  if (/not on Bitcoin Testnet4/i.test(message)) return 'This server is on a different Bitcoin network. Choose a Testnet4 server in Settings.';
  if (/spent|lost confirmations|immature|mature/i.test(message)) return 'Some coins are no longer available. Refresh your wallet and review the payment again.';
  if (/snapshot.*old|Sync.*wallet/i.test(message)) return 'Refresh your balance before creating this payment.';
  if (/20 unused|Address.*limit|discovery|exceeds.*limit|oversized wallet|1,000/i.test(message)) return 'Wallet address limit reached. Use an existing address and refresh, or check your wallet with your server administrator.';
  if (/timed out|timeout|uncertain|Stopped waiting/i.test(message)) return 'The connection was interrupted. Check your device and payment status before trying again.';
  if (/pairing|label/i.test(message)) return 'Check the pairing code and phone name, then try again.';
  if (/account changed|Foreign|verify|verified|Invalid Bitcoin|different transaction|signature|previous transaction|Coin amount|PSBT|recovery|saved payment/i.test(message)) return 'This payment or wallet could not be verified. Nothing new has been sent. Check your device and payment history before continuing.';
  if (/storage|save|preserve|commit payment/i.test(message)) return 'Could not save this payment. Check free space and unlock your phone before trying again.';
  if (/Camera/i.test(message)) return 'Allow camera access in your phone settings, or paste the pairing code.';
  if (/server.*first|Electrs.*address|ssl:\/\/|server port/i.test(message)) return 'Check the wallet server address in Settings, including its port.';
  if (/Electrs|connect|network|TLS/i.test(message)) return 'Could not connect. Check your internet connection and wallet server in Settings.';
  if (/reject|denied|refused/i.test(message)) return 'The request was declined. Check your signing device before trying again.';
  return 'Could not complete this action. Check your connection and try again.';
}
