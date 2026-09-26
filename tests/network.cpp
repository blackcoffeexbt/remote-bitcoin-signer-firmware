#include "../src/network_validation.h"
#include <cassert>
#include <iostream>
static bool valid(const std::string &ssid, const std::string &password,
                  const std::vector<std::string> &relays) {
    try {
        validateNetworkFields(ssid, password, relays);
        return true;
    } catch (const std::exception &) {
        return false;
    }
}
int main() {
    assert(valid("Home WiFi", "password", {"wss://relay.example"}));
    assert(valid("Open WiFi", "",
                 {"wss://one.example", "wss://two.example/path", "wss://three.example"}));
    assert(!valid("", "password", {"wss://relay.example"}));
    assert(!valid(std::string(33, 'a'), "password", {"wss://relay.example"}));
    assert(!valid("Home", "short", {"wss://relay.example"}));
    assert(!valid("Home", std::string(64, 'a'), {"wss://relay.example"}));
    assert(!valid("Home", "password", {}));
    assert(!valid("Home", "password", std::vector<std::string>(4, "wss://relay.example")));
    for (const auto &relay :
         {"ws://relay.example", "wss://", "wss:///path", "wss://name@host",
          "wss://relay.example:8080", "wss://relay.example/#fragment", "wss://relay.example/ space",
          "wss://relay.example\\evil", "wss://host\n"})
        assert(!valid("Home", "password", {relay}));
    assert(!valid(std::string("x\0y", 3), "password", {"wss://relay.example"}));
    assert(!valid("Home", "password", {"wss://relay.example/" + std::string(200, 'a')}));
    std::cout << "PASS: Wi-Fi and relay settings validation\n";
}
