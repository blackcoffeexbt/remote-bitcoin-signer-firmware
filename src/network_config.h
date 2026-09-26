#pragma once
#include "network_validation.h"
#include <ArduinoJson.h>
#include <stdexcept>
#include <vector>

struct NetworkConfig {
    String ssid, password;
    std::vector<String> relays;
};
inline NetworkConfig parseNetworkConfig(const String &text) {
    if (text.length() > 2048)
        throw std::runtime_error("Settings too large");
    DynamicJsonDocument d(2048);
    if (deserializeJson(d, text) || !d["ssid"].is<String>() || !d["password"].is<String>() ||
        !d["relays"].is<JsonArray>())
        throw std::runtime_error("Invalid settings");
    NetworkConfig out{d["ssid"].as<String>(), d["password"].as<String>(), {}};
    std::vector<std::string> relayText;
    for (auto item : d["relays"].as<JsonArray>()) {
        if (!item.is<String>())
            throw std::runtime_error("Relay URLs must be text");
        String url = item.as<String>();
        url.trim();
        out.relays.push_back(url);
        relayText.emplace_back(url.c_str(), url.length());
    }
    validateNetworkFields(std::string(out.ssid.c_str(), out.ssid.length()),
                          std::string(out.password.c_str(), out.password.length()), relayText);
    return out;
}
