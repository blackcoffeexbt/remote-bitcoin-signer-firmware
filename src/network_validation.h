#pragma once
#include <stdexcept>
#include <string>
#include <vector>
inline void validateNetworkFields(const std::string &ssid, const std::string &password,
                                  const std::vector<std::string> &relays) {
    if (ssid.empty() || ssid.size() > 32 || ssid.find('\0') != std::string::npos ||
        password.size() > 63 || password.find('\0') != std::string::npos ||
        (!password.empty() && password.size() < 8))
        throw std::runtime_error(
            "Use a Wi-Fi name and an 8-63 character password (or leave blank for open Wi-Fi)");
    if (relays.empty() || relays.size() > 3)
        throw std::runtime_error("Enter 1 to 3 relay URLs");
    for (const auto &url : relays) {
        const auto slash = url.find('/', 6);
        const auto host =
            url.size() >= 6 ? url.substr(6, slash == std::string::npos ? slash : slash - 6) : "";
        if (url.compare(0, 6, "wss://") || url.size() > 200 || host.empty() ||
            url.find_first_of("@#?\\") != std::string::npos)
            throw std::runtime_error("Use wss:// relay URLs on the default port 443");
        for (char c : host)
            if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
                  c == '.' || c == '-'))
                throw std::runtime_error("Invalid relay hostname; use the default port 443");
        for (unsigned char c : url)
            if (c <= 32 || c >= 127)
                throw std::runtime_error(
                    "Relay URLs cannot contain spaces or non-ASCII characters");
    }
}
