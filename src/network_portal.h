#pragma once
#include "network_config.h"
#include "network_portal_page.h"
#include "wallet.h"
#include <WebServer.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <memory>

// Available only after a local touchscreen action. Bound to the AP interface.
class NetworkPortal {
    std::unique_ptr<WebServer> server;
    String token, submission;
    uint32_t started = 0, submitted = 0;
    bool scanStarted = false;
    static constexpr uint32_t lifetime = 10 * 60 * 1000;

    void headers() {
        server->sendHeader("Cache-Control", "no-store");
        server->sendHeader("X-Content-Type-Options", "nosniff");
        server->sendHeader("Content-Security-Policy",
                           "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; "
                           "connect-src 'self'; form-action 'self'; "
                           "frame-ancestors 'none'");
    }
    void respond(int code, const String &text) {
        headers();
        server->send(code, "text/plain; charset=utf-8", text);
    }
    void scan(bool begin) {
        if (server->header("X-Setup-Token") != token || expired()) {
            respond(403, "Setup expired. Open Network settings on the device again.");
            return;
        }
        if (submission.length()) {
            respond(409, "Settings already submitted. Check the device.");
            return;
        }
        int count = WiFi.scanComplete();
        if (begin && count != WIFI_SCAN_RUNNING) {
            WiFi.scanDelete();
            count = WiFi.scanNetworks(true, false);
            scanStarted = true;
        }
        if (!scanStarted || count == WIFI_SCAN_FAILED) {
            respond(503, "Wi-Fi scan failed. Try again or enter the network name manually.");
            return;
        }
        DynamicJsonDocument result(8192);
        result["status"] = count == WIFI_SCAN_RUNNING ? "scanning" : "complete";
        auto networks = result.createNestedArray("networks");
        std::vector<String> seen;
        for (int i = 0; i < count && seen.size() < 32; i++) {
            String ssid = WiFi.SSID(i);
            if (!ssid.length())
                continue;
            bool duplicate = false;
            for (const auto &name : seen)
                duplicate |= name == ssid;
            if (duplicate)
                continue;
            seen.push_back(ssid);
            auto network = networks.createNestedObject();
            network["ssid"] = ssid;
            network["open"] = WiFi.encryptionType(i) == WIFI_AUTH_OPEN;
        }
        String body;
        serializeJson(result, body);
        headers();
        server->send(count == WIFI_SCAN_RUNNING ? 202 : 200, "application/json", body);
    }
    void save() {
        if (server->arg("token") != token || uint32_t(millis() - started) >= lifetime) {
            respond(403, "Setup expired. Open Network settings on the device again.");
            return;
        }
        if (submission.length()) {
            respond(409, "Settings already submitted. Check the device.");
            return;
        }
        try {
            const String lines = server->arg("relays");
            if (lines.length() > 610)
                throw std::runtime_error("Relay list too large");
            DynamicJsonDocument doc(2048);
            doc["ssid"] = server->arg("ssid");
            doc["password"] = server->arg("password");
            auto relays = doc.createNestedArray("relays");
            int start = 0;
            while (start < int(lines.length())) {
                int end = lines.indexOf('\n', start);
                if (end < 0)
                    end = lines.length();
                String relay = lines.substring(start, end);
                relay.trim();
                if (relay.length())
                    relays.add(relay);
                start = end + 1;
            }
            String text;
            serializeJson(doc, text);
            try {
                parseNetworkConfig(text);
            } catch (...) {
                Wallet::wipe(text);
                throw;
            }
            submission = text;
            Wallet::wipe(text);
            submitted = millis();
            respond(200, "Settings received. The setup Wi-Fi will close. Check the device for "
                         "connection status, then reconnect this browser to your normal Wi-Fi.");
        } catch (const std::exception &e) {
            respond(400, e.what());
        }
    }

  public:
    bool active() const {
        return bool(server);
    }
    bool expired() const {
        return active() && uint32_t(millis() - started) >= lifetime;
    }
    void stop() {
        if (server) {
            if (WiFi.scanComplete() == WIFI_SCAN_RUNNING)
                esp_wifi_scan_stop();
            WiFi.scanDelete();
            scanStarted = false;
            server->stop();
            server.reset();
            WiFi.softAPdisconnect(true);
            WiFi.mode(WIFI_STA);
        }
        Wallet::wipe(token);
        Wallet::wipe(submission);
    }
    String start() {
        stop();
        uint8_t random[16];
        esp_fill_random(random, sizeof(random));
        token = toHex(random, sizeof(random));
        String ssid = "Argus-" + token.substring(0, 6);
        String password = token.substring(8, 24);
        WiFi.mode(WIFI_AP_STA);
        const IPAddress address(192, 168, 4, 1);
        if (!WiFi.softAPConfig(address, address, IPAddress(255, 255, 255, 0)) ||
            !WiFi.softAP(ssid.c_str(), password.c_str(), 1, false, 1)) {
            WiFi.softAPdisconnect(true);
            WiFi.mode(WIFI_STA);
            Wallet::wipe(token);
            throw std::runtime_error("Unable to start setup Wi-Fi");
        }
        server.reset(new WebServer(address, 80));
        started = millis();
        server->on("/", HTTP_GET, [this]() {
            String page = networkPortalPage;
            page.replace("{{TOKEN}}", token);
            headers();
            server->send(200, "text/html; charset=utf-8", page);
        });
        server->on("/setup.js", HTTP_GET, [this]() {
            headers();
            server->send(200, "application/javascript; charset=utf-8", networkPortalScript);
        });
        const char *requestHeaders[] = {"X-Setup-Token"};
        server->collectHeaders(requestHeaders, 1);
        server->on("/scan", HTTP_POST, [this]() { scan(true); });
        server->on("/scan", HTTP_GET, [this]() { scan(false); });
        server->on("/save", HTTP_POST, [this]() { save(); });
        server->onNotFound(
            [this]() { respond(404, "Open http://192.168.4.1/ to configure Argus."); });
        server->begin();
        DynamicJsonDocument details(512);
        details["ssid"] = ssid;
        details["password"] = password;
        String result;
        serializeJson(details, result);
        Wallet::wipe(password);
        return result;
    }
    void poll() {
        if (server)
            server->handleClient();
    }
    String takeSubmission() {
        if (!submission.length() || uint32_t(millis() - submitted) < 750)
            return "";
        String result = submission;
        Wallet::wipe(submission);
        return result;
    }
};
