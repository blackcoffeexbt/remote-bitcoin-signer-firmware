#include "engine.h"
#ifdef BITCOIN_SELF_TEST
#include "selftest.h"
#endif
#include "network_portal.h"
#include "nip44/nip44.h"
#include "nostr.h"
#include "protocol_state.h"
#include "wallet.h"
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <deque>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <memory>
#include <time.h>
extern const uint8_t relayRoots[] asm("_binary_data_cert_roots_bin_start");
namespace Engine {
using namespace Wallet;
constexpr int KIND = 24134; // Experimental Bitcoin signer protocol, not NIP-46.
static QueueHandle_t commands, events;
static Account account;
static String secret, pubkey, session, pairToken;
static time_t pairExpiry = 0;
static std::vector<String> urls;
static std::vector<std::unique_ptr<WebSocketsClient>> sockets;
static std::map<String, String> clients;
static unsigned long unlockAfter = 0;
static unsigned failures = 0;
struct Pending {
    String id, peer, method, hash, label;
    Bytes psbt;
    time_t expiry = 0;
};
static Pending pending;
static NetworkPortal portal;
static bool connectingNetwork = false;
static uint32_t networkStarted = 0;
static BitcoinProtocol::ReplayWindow seen;
struct CachedReply {
    String key, wire;
    time_t expiry;
};
static std::deque<CachedReply> replies;
static void post(String type, String text = "", String data = "", String id = "") {
    auto m = new Message{type, text, data, id};
    if (xQueueSend(events, &m, 0) != pdTRUE)
        delete m;
}
static String json(const JsonDocument &doc) {
    require(!doc.overflowed(), "Message exceeds available memory");
    String s;
    serializeJson(doc, s);
    return s;
}
static String randomHex() {
    uint8_t b[16];
    esp_fill_random(b, 16);
    return toHex(b, 16);
}
static bool hexString(const String &s, size_t n) {
    if (s.length() != n)
        return false;
    for (char c : s)
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
            return false;
    return true;
}
static void saveClients() {
    DynamicJsonDocument d(2048);
    for (auto &c : clients)
        d[c.first] = c.second;
    Preferences p;
    p.begin("btc-signer", false);
    auto s = json(d);
    require(p.putString("clients", s) == s.length(), "Cannot save pairing");
    p.end();
}
static void publish(const String &wire) {
    for (auto &s : sockets)
        if (s->isConnected())
            s->sendTXT(wire.c_str(), wire.length());
}
static void reply(const String &peer, const String &id, const String &method, const String &hash,
                  const String &result, const String &error, time_t expiry) {
    DynamicJsonDocument d(70000);
    d["protocol"] = "bitcoin-signer";
    d["version"] = 1;
    d["id"] = id;
    d["method"] = method;
    d["network"] = "Testnet4";
    d["psbt_hash"] = hash;
    if (error.length())
        d["error"] = error;
    else {
        DynamicJsonDocument r(66000);
        require(!deserializeJson(r, result), "Response encoding failed");
        d["result"].set(r.as<JsonVariant>());
    }
    auto clear = json(d);
    auto wire = nostr::getEncryptedDm(secret.c_str(), pubkey.c_str(), peer.c_str(), KIND,
                                      time(nullptr), clear, "nip44");
    require(wire.length(), "Response encryption failed");
    while (!replies.empty() && replies.front().expiry <= time(nullptr))
        replies.pop_front();
    if (replies.size() >= 8)
        replies.pop_front();
    replies.push_back({peer + ":" + id, wire, expiry});
    publish(wire);
}
static String publicAccount() {
    DynamicJsonDocument d(2048);
    d["descriptor"] = account.descriptor();
    d["xpub"] = account.xpub();
    d["fingerprint"] = account.fingerprint();
    d["path"] = "m/84'/1'/0'";
    d["session"] = session;
    return json(d);
}
static void rejectPending(const char *reason) {
    if (!pending.id.length())
        return;
    auto p = pending;
    pending = Pending{};
    reply(p.peer, p.id, p.method, p.hash, "{}", reason, p.expiry);
    post("home", reason);
}
static String outputAddress(const Bytes &b) {
    Script script(b.data(), b.size());
    String address = script.address(&Testnet);
    require(address.length(), "Cannot display recipient address");
    return address;
}
static void receive(const uint8_t *payload, size_t length) {
    if (!account.ready() || length > 100000 || time(nullptr) < 1700000000)
        return;
    DynamicJsonDocument d(190000);
    if (deserializeJson(d, payload, length, DeserializationOption::NestingLimit(12)))
        return;
    if (!d.is<JsonArray>() || d.size() != 3 || d[0] != "EVENT")
        return;
    auto e = d[2].as<JsonObject>();
    String peer = e["pubkey"] | "", idHash = e["id"] | "", sig = e["sig"] | "",
           content = e["content"] | "";
    auto now = time(nullptr);
    if (!hexString(peer, 64) || !hexString(idHash, 64) || !hexString(sig, 128) ||
        e["kind"] != KIND || !e["created_at"].is<unsigned long>())
        return;
    auto created = e["created_at"].as<unsigned long>();
    if (created > now + 30 || created + 180 < now || content.length() > 90000)
        return;
    auto tags = e["tags"].as<JsonArray>();
    if (tags.size() != 1 || tags[0].size() != 2 || tags[0][0] != "p" || tags[0][1] != pubkey)
        return;
    DynamicJsonDocument canonical(100000);
    auto a = canonical.to<JsonArray>();
    a.add(0);
    a.add(peer);
    a.add(created);
    a.add(KIND);
    a.add(tags);
    a.add(content);
    auto canonicalString = json(canonical);
    Bytes h(32);
    sha256((uint8_t *)canonicalString.c_str(), canonicalString.length(), h.data());
    if (hex(h) != idHash)
        return;
    PublicKey pk(("02" + peer).c_str());
    SchnorrSignature signature(sig.c_str());
    if (!pk || !pk.schnorr_verify(signature, h.data()))
        return;
    // Unknown peers can only attempt pairing while a local pairing window is open.
    if (!clients.count(peer) && (!pairToken.length() || now >= pairExpiry))
        return;
    String clear = executeDecryptMessageNip44(content, secret, peer);
    if (clear.isEmpty() || clear.length() > 46000)
        return;
    DynamicJsonDocument request(65000);
    if (deserializeJson(request, clear, DeserializationOption::NestingLimit(5)))
        return;
    String id = request["id"] | "", method = request["method"] | "",
           psbtHash = request["psbt_hash"] | "";
    if (request["protocol"] != "bitcoin-signer" || request["version"] != 1 ||
        request["network"] != "Testnet4" || !hexString(id, 32) ||
        !request["expires"].is<unsigned long>())
        return;
    time_t expires = request["expires"].as<unsigned long>();
    if (!BitcoinProtocol::fresh(created, expires, now))
        return;
    String key = peer + ":" + id;
    auto replay = seen.accept(peer.c_str(), id.c_str(), now);
    if (replay == BitcoinProtocol::ReplayWindow::Duplicate) {
        for (auto &cached : replies)
            if (cached.key == key && cached.expiry > now)
                publish(cached.wire);
        return;
    }
    if (replay == BitcoinProtocol::ReplayWindow::Full)
        return;
    try {
        if (pending.id.length()) {
            reply(peer, id, method, psbtHash, "{}", "busy", expires);
            return;
        }
        if (method == "pair") {
            require(pairToken.length() && now < pairExpiry &&
                        request["params"]["token"] == pairToken,
                    "Pairing code expired or incorrect");
            require(clients.size() < 8 || clients.count(peer), "Maximum 8 clients");
            String label = request["params"]["label"] | "Browser";
            require(label.length() > 0 && label.length() <= 40, "Invalid client name");
            for (char c : label)
                require(c >= 32 && c <= 126, "Use a plain text client name");
            pending = {id, peer, method, "", label, {}, expires};
            post("pair", label + "\n" + peer, "", id);
            return;
        }
        require(clients.count(peer), "unauthorized");
        if (method == "get_account") {
            reply(peer, id, method, "", publicAccount(), "", expires);
            return;
        }
        require(method == "sign_psbt", "Unsupported method");
        require(BitcoinProtocol::signingSession(request["params"]["session"] | "", session.c_str()),
                "Device restarted; reconnect first");
        String b64 = request["params"]["psbt"] | "";
        auto bytes = decode(b64);
        require(hexString(psbtHash, 64) && hex(hash(bytes)) == psbtHash, "PSBT hash mismatch");
        auto review = account.validate(bytes);
        String text = "Client: " + clients[peer] + "\nTESTNET4\n";
        for (size_t i = 0; i < review.tx.outputs.size(); i++) {
            auto &out = review.tx.outputs[i];
            text += "\n" + String(out.change ? "CHANGE" : "RECIPIENT") + "\n" +
                    outputAddress(out.script) + "\n" + String((unsigned long long)out.amount) +
                    " sat\n";
        }
        text += "\nFEE: " + String((unsigned long long)review.fee) + " sat";
        pending = {id, peer, method, psbtHash, clients[peer], std::move(bytes), expires};
        post("review", text, "", id);
    } catch (const std::exception &ex) {
        reply(peer, id, method, psbtHash, "{}", ex.what(), expires);
    }
}
static void connectRelays() {
    sockets.clear();
    if (!account.ready())
        return;
    for (const auto &url : urls) {
        int slash = url.indexOf('/', 6);
        String host = slash < 0 ? url.substring(6) : url.substring(6, slash);
        String path = slash < 0 ? "/" : url.substring(slash);
        auto socket = std::unique_ptr<WebSocketsClient>(new WebSocketsClient);
        auto ptr = socket.get();
        socket->onEvent([ptr](WStype_t type, uint8_t *payload, size_t length) {
            if (type == WStype_CONNECTED) {
                DynamicJsonDocument d(512);
                auto a = d.to<JsonArray>();
                a.add("REQ");
                a.add("bitcoin-v1");
                auto f = a.createNestedObject();
                f.createNestedArray("kinds").add(KIND);
                f.createNestedArray("#p").add(pubkey);
                f["since"] = time(nullptr) - 180;
                String req = json(d);
                ptr->sendTXT(req);
                for (auto &cached : replies)
                    if (cached.expiry > time(nullptr))
                        ptr->sendTXT(cached.wire);
            }
            if (type == WStype_TEXT)
                try {
                    receive(payload, length);
                } catch (const std::exception &) {
                    post("status", "Request rejected");
                }
        });
        // Signed events and NIP-44 authenticate peers; relay transport does not authenticate
        // signing requests.
        socket->beginSslWithBundle(host.c_str(), 443, path.c_str(), relayRoots);
        socket->setReconnectInterval(5000);
        socket->enableHeartbeat(30000, 5000, 2);
        sockets.push_back(std::move(socket));
    }
}
static void unlocked(const String &phrase) {
    post("progress", "Preparing wallet keys and relay connections...");
    account.open(phrase);
    uint8_t b[32];
    fromHex(secret, b, 32);
    PrivateKey sk(b);
    nostr::crypto::wipe(b, 32);
    String full = sk.publicKey().toString();
    pubkey = full.substring(2);
    session = randomHex();
    seen.clear();
    replies.clear();
    connectRelays();
    post("home", "Unlocked — Testnet4");
}
static void command(Message &m) {
    if (m.type == "generate") {
        require(!exists(), "Wallet already configured");
        post("seed", generate());
    } else if (m.type == "create") {
        require(!exists(), "Wallet already configured");
        post("progress", "Deriving your Bitcoin account...");
        account.open(m.text);
        secret = identity();
        try {
            post("progress",
                 "Encrypting and saving wallet with your PIN... This takes about 20 seconds.");
            store(m.text, m.data, secret);
        } catch (...) {
            account.close();
            wipe(secret);
            throw;
        }
        unlocked(m.text);
    } else if (m.type == "unlock") {
        require((int32_t)(millis() - unlockAfter) >= 0, "Wait before retrying PIN");
        String phrase;
        try {
            post("progress", "Checking PIN and decrypting wallet... This takes about 20 seconds.");
            unlock(m.text, phrase, secret);
            unlocked(phrase);
            failures = 0;
            wipe(phrase);
        } catch (...) {
            wipe(phrase);
            wipe(secret);
            account.close();
            failures = std::min(failures + 1, 10U);
            unlockAfter = millis() + 1000 * (1U << failures);
            throw;
        }
    } else if (m.type == "lock") {
        portal.stop();
        if (pending.id.length())
            rejectPending("Device locked");
        sockets.clear();
        account.close();
        wipe(secret);
        pairToken = "";
        replies.clear();
        post("locked", "Enter PIN");
    } else if (m.type == "pair_code") {
        require(account.ready(), "Unlock first");
        require(urls.size() > 0, "Configure a relay first");
        require(time(nullptr) >= 1700000000, "Waiting for network time; check Wi-Fi");
        pairToken = randomHex();
        pairExpiry = time(nullptr) + 180;
        DynamicJsonDocument d(2048);
        d["protocol"] = "bitcoin-signer";
        d["version"] = 1;
        d["pubkey"] = pubkey;
        d["token"] = pairToken;
        auto r = d.createNestedArray("relays");
        for (auto &u : urls)
            r.add(u);
        post("code", json(d));
    } else if (m.type == "approve") {
        require(pending.id.length() && m.id == pending.id, "Request no longer active");
        require(time(nullptr) < pending.expiry, "Request expired");
        auto p = pending;
        pending = Pending{};
        try {
            if (p.method == "pair") {
                post("progress", "Saving browser pairing...");
                clients[p.peer] = p.label;
                try {
                    saveClients();
                } catch (...) {
                    clients.erase(p.peer);
                    throw;
                }
                pairToken = "";
                post("progress", "Sending public account to paired browser...");
                reply(p.peer, p.id, p.method, "", publicAccount(), "", p.expiry);
            } else {
                post("progress", "Validating and signing transaction...");
                auto signedPsbt = account.sign(p.psbt);
                require(time(nullptr) < p.expiry, "Request expired while signing");
                DynamicJsonDocument d(66000);
                d["psbt"] = signedPsbt;
                post("progress", "Encrypting and sending signed transaction...");
                reply(p.peer, p.id, p.method, p.hash, json(d), "", p.expiry);
            }
            post("home", "Approved");
        } catch (const std::exception &ex) {
            reply(p.peer, p.id, p.method, p.hash, "{}", ex.what(), p.expiry);
            post("home", ex.what());
        }
    } else if (m.type == "reject") {
        if (m.id == pending.id)
            rejectPending("User rejected");
    } else if (m.type == "clients") {
        String s;
        for (auto &c : clients)
            s += c.first + " " + c.second + "\n";
        post("clients", s);
    } else if (m.type == "revoke") {
        require(account.ready(), "Unlock first");
        if (pending.peer == m.text)
            rejectPending("Pairing revoked");
        clients.erase(m.text);
        saveClients();
        post("home", "Pairing revoked");
    } else if (m.type == "network_setup") {
        require(!exists() || account.ready(), "Unlock first");
        require(!pending.id.length(), "Finish the active request first");
        connectingNetwork = false;
        sockets.clear();
        post("network_setup", portal.start());
    } else if (m.type == "network_cancel") {
        portal.stop();
        connectRelays();
        post("home", "Network setup closed");
    } else if (m.type == "network") {
        require(!exists() || account.ready(), "Unlock first");
        const auto config = parseNetworkConfig(m.text);
        Preferences p;
        p.begin("btc-signer", false);
        require(p.putString("network", m.text) == m.text.length(), "Cannot save network settings");
        p.end();
        portal.stop();
        urls = config.relays;
        WiFi.begin(config.ssid.c_str(), config.password.c_str());
        configTime(0, 0, "pool.ntp.org", "time.google.com");
        connectRelays();
        connectingNetwork = true;
        networkStarted = millis();
        post("home", "Settings saved. Connecting to Wi-Fi...");
    }
}
static void run(void *) {
#ifdef BITCOIN_SELF_TEST
    try {
        firmwareSelfTest();
    } catch (const std::exception &ex) {
        Serial.println(String("BITCOIN SELFTEST FAIL: ") + ex.what());
        post("error", ex.what());
        vTaskDelete(nullptr);
        return;
    }
#endif
    Serial.println("Bitcoin signer worker ready");
    Preferences p;
    p.begin("btc-signer", true);
    String net = p.getString("network", ""), saved = p.getString("clients", "{}");
    p.end();
    DynamicJsonDocument d(2048);
    if (!deserializeJson(d, saved))
        for (auto kv : d.as<JsonObject>())
            clients[kv.key().c_str()] = kv.value().as<String>();
    if (!deserializeJson(d, net)) {
        String ssid = d["ssid"] | "", pass = d["password"] | "";
        WiFi.begin(ssid.c_str(), pass.c_str());
        for (auto u : d["relays"].as<JsonArray>())
            urls.push_back(u.as<String>());
        configTime(0, 0, "pool.ntp.org", "time.google.com");
    }
    post(exists() ? "locked" : "welcome",
         exists() ? "Enter PIN" : "Create or restore a Testnet4 wallet");
    for (;;) {
        Message *m = nullptr;
        if (xQueueReceive(commands, &m, 0) == pdTRUE) {
            try {
                command(*m);
            } catch (const std::exception &ex) {
                post("error", ex.what());
            }
            wipe(m->text);
            wipe(m->data);
            delete m;
        }
        if (portal.active()) {
            portal.poll();
            String settings = portal.takeSubmission();
            if (settings.length()) {
                Message apply{"network", settings, "", ""};
                wipe(settings);
                try {
                    command(apply);
                } catch (const std::exception &ex) {
                    portal.stop();
                    connectRelays();
                    post("home", String("Network setup failed: ") + ex.what());
                }
                wipe(apply.text);
            } else if (portal.expired()) {
                portal.stop();
                connectRelays();
                post("home", "Network setup expired. Open Network settings to try again.");
            }
        }
        if (connectingNetwork) {
            if (WiFi.status() == WL_CONNECTED) {
                connectingNetwork = false;
                post("home", "Wi-Fi connected. Relays connect after wallet unlock and time "
                             "synchronization.");
            } else if (uint32_t(millis() - networkStarted) > 30000) {
                connectingNetwork = false;
                post("home",
                     "Could not connect to Wi-Fi. Open Network settings to check the password.");
            }
        }
        if (pending.id.length() && time(nullptr) >= pending.expiry)
            try {
                rejectPending("Request expired");
            } catch (...) {
                pending = Pending{};
                post("home", "Request expired");
            }
        if (pairToken.length() && time(nullptr) >= pairExpiry)
            pairToken = "";
        if (!portal.active() && WiFi.status() == WL_CONNECTED && time(nullptr) > 1700000000)
            for (auto &s : sockets)
                s->loop();
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}
bool start() {
    commands = xQueueCreate(4, sizeof(Message *));
    events = xQueueCreate(8, sizeof(Message *));
    return commands && events &&
           xTaskCreatePinnedToCore(run, "bitcoin-worker", 24576, nullptr, 1, nullptr, 0) == pdPASS;
}
bool send(const String &type, const String &text, const String &data, const String &id) {
    auto m = new Message{type, text, data, id};
    if (xQueueSend(commands, &m, 0) == pdTRUE)
        return true;
    wipe(m->text);
    wipe(m->data);
    delete m;
    return false;
}
Message *take() {
    Message *m = nullptr;
    xQueueReceive(events, &m, 0);
    return m;
}
} // namespace Engine
