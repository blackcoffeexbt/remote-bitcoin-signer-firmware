#pragma once
static const char networkPortalPage[] = R"HTML(<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bitcoin signer setup</title>
<style>
[hidden]{display:none!important}
body{font:17px system-ui;background:#16181b;color:#f5f5f5;max-width:460px;margin:32px auto;padding:20px}
label{display:block;margin:22px 0 8px}input,textarea,button,select{box-sizing:border-box;width:100%;padding:13px;font:inherit;border-radius:8px;border:1px solid #777}
button{margin-top:16px;background:#ff9900;color:#111;font-weight:600}button:disabled{opacity:.6}p{line-height:1.5}small{color:#ccc}
.toggle{display:flex;align-items:center;gap:10px;margin:12px 0}.toggle input{width:auto}#scan-status{font-size:15px}
</style>
<h1>Wi-Fi &amp; Nostr relays</h1><p>Connect your signer to a 2.4 GHz Wi-Fi network and add up to three relays.</p>
<form method="post" action="/save">
<input id="token" type="hidden" name="token" value="{{TOKEN}}">
<button id="scan" type="button">Scan for Wi-Fi</button>
<p id="scan-status" role="status" aria-live="polite"></p>
<label id="networks-label" for="networks" hidden>Nearby Wi-Fi networks</label><select id="networks" hidden></select>
<label for="ssid">Wi-Fi network name</label><input id="ssid" name="ssid" maxlength="32" required autocomplete="off">
<small>Select a scanned network or enter its name manually.</small>
<label for="password">Wi-Fi password</label><input id="password" name="password" type="password" maxlength="63" autocomplete="new-password">
<label class="toggle"><input id="show-password" type="checkbox">Show password</label>
<small>Leave blank only for an open network.</small>
<label for="relays">Nostr relay URLs</label><textarea id="relays" name="relays" rows="4" maxlength="610" required>wss://relay.nostrconnect.com</textarea>
<small>One wss:// URL per line. Maximum three.</small><button>Save and connect</button>
</form><p>Setup closes after 10 minutes. You can also close it on the device.</p>
<script src="/setup.js" defer></script></html>)HTML";

static const char networkPortalScript[] = R"JS('use strict';
const byId = id => document.getElementById(id);
byId('show-password').addEventListener('change', event => {
  byId('password').type = event.target.checked ? 'text' : 'password';
});
byId('networks').addEventListener('change', event => {
  if (event.target.value) byId('ssid').value = event.target.value;
});
byId('scan').addEventListener('click', async () => {
  const button = byId('scan'), status = byId('scan-status'), list = byId('networks');
  button.disabled = true;
  status.textContent = 'Scanning for nearby Wi-Fi networks…';
  list.hidden = true;
  byId('networks-label').hidden = true;
  list.replaceChildren();
  const headers = {'X-Setup-Token': byId('token').value};
  try {
    let response = await fetch('/scan', {method: 'POST', headers});
    if (!response.ok) throw new Error(await response.text());
    let result;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 750));
      response = await fetch('/scan', {headers});
      if (!response.ok) throw new Error(await response.text());
      result = await response.json();
      if (result.status !== 'scanning') break;
    }
    if (!result || result.status === 'scanning') throw new Error('Scan timed out. Please try again.');
    const networks = result.networks || [];
    if (!networks.length) {
      status.textContent = 'No networks found. Try again or enter the network name manually.';
      return;
    }
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a network';
    list.appendChild(placeholder);
    for (const network of networks) {
      const option = document.createElement('option');
      option.value = network.ssid;
      option.textContent = network.ssid + (network.open ? ' (open)' : '');
      list.appendChild(option);
    }
    list.hidden = false;
    byId('networks-label').hidden = false;
    status.textContent = 'Select your network below.';
  } catch (error) {
    status.textContent = error.message || 'Scan failed. Try again or enter the network name manually.';
  } finally {
    button.disabled = false;
  }
});
)JS";
