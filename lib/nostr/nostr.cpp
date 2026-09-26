#include "nostr.h"
#include "json_writer.h"
#include "bounded_json.h"
#include "nip44/nip44.h"
#include "crypto_cache.h"
#include <mbedtls/aes.h>
#include <mbedtls/base64.h>
#include <vector>

namespace nostr
{
    static const bool ENABLE_LOGGING = false;
    static const bool ENABLE_TIMER_LOGGING = false;
    // Do not construct or emit payload/key trace strings on the crypto path.
    #define NOSTR_TRACE(...) ((void)0)

    DynamicJsonDocument nostrEventDoc(0);
    size_t maxEnvelopeCapacity = json::MAX_ENVELOPE_CAPACITY;
    size_t maxCiphertextBytes = 65536;

    unsigned long timer = 0;
    void _startTimer(const char *timedEvent)
    {
        if(!ENABLE_TIMER_LOGGING) {
            return;
        }
        timer = millis();
        Serial.print("Starting timer for ");
        Serial.println(timedEvent);
    }

    void _stopTimer(const char *timedEvent)
    {
        if(!ENABLE_TIMER_LOGGING) {
            return;
        }
        unsigned long elapsedTime = millis() - timer;
        Serial.print(elapsedTime);
        Serial.print(" ms - ");
        Serial.println(timedEvent);
        timer = millis();
    }

    void initMemorySpace(size_t nostrEventDocCapacity, size_t encryptedMessageBinSize)
    {
        nostrEventDoc = DynamicJsonDocument(0);
        maxEnvelopeCapacity = nostrEventDocCapacity < json::MAX_ENVELOPE_CAPACITY
            ? nostrEventDocCapacity : json::MAX_ENVELOPE_CAPACITY;
        maxCiphertextBytes = encryptedMessageBinSize;
    }

    void _logToSerialWithTitle(String title, String message)
    {
        if(!ENABLE_LOGGING) {
            return;
        }
        Serial.println(title + ": " + message);
    }

    void _logOkWithHeapSize(const char *message)
    {
        if(!ENABLE_LOGGING) {
            return;
        }
        Serial.print(" OK.");
        Serial.print(" Free heap size: ");
        Serial.println(esp_get_free_heap_size());
    }

    namespace {
    bool aesCbc(bool decrypt, const byte* key, const byte* iv, byte* data, size_t size) {
        if (!data || !size || size % 16) return false;
        byte workingIV[16];
        memcpy(workingIV, iv, sizeof(workingIV));
        mbedtls_aes_context ctx;
        mbedtls_aes_init(&ctx);
        int rc = decrypt ? mbedtls_aes_setkey_dec(&ctx, key, 256)
                         : mbedtls_aes_setkey_enc(&ctx, key, 256);
        if (!rc) rc = mbedtls_aes_crypt_cbc(&ctx, decrypt ? MBEDTLS_AES_DECRYPT : MBEDTLS_AES_ENCRYPT,
                                          size, workingIV, data, data);
        mbedtls_aes_free(&ctx);
        crypto::wipe(workingIV, sizeof(workingIV));
        return rc == 0;
    }
    bool decodeBase64(const String& encoded, std::vector<byte>& decoded, size_t limit) {
        if (!encoded.length() || encoded.length() % 4 || encoded.length() / 4 > (limit + 2) / 3) return false;
        size_t actual = 0;
        decoded.resize(encoded.length() / 4 * 3);
        int rc = mbedtls_base64_decode(decoded.data(), decoded.size(), &actual,
                                      reinterpret_cast<const byte*>(encoded.c_str()), encoded.length());
        if (rc || !actual || actual > limit) return false;
        decoded.resize(actual);
        return true;
    }
    std::vector<byte> paddedCiphertext(const byte* key, const byte* iv, const String& msg) {
        size_t padding = 16 - msg.length() % 16;
        std::vector<byte> data(msg.length() + padding, padding);
        memcpy(data.data(), msg.c_str(), msg.length());
        if (!aesCbc(false, key, iv, data.data(), data.size())) {
            crypto::wipe(data.data(), data.size());
            data.clear();
        }
        return data;
    }
    }

    String decryptData(byte key[32], byte iv[16], byte* ciphertext, int size)
    {
        if (size <= 0 || !aesCbc(true, key, iv, ciphertext, size)) return "";
        const byte padding = ciphertext[size - 1];
        bool valid = padding >= 1 && padding <= 16 && padding <= size;
        for (int i = 0; i < 16; ++i) {
            if (i < padding && ciphertext[size - 1 - i] != padding) valid = false;
        }
        String result = valid ? String(reinterpret_cast<char*>(ciphertext), size - padding) : String();
        crypto::wipe(ciphertext, size);
        return result;
    }

    String decryptNip04Ciphertext(String &cipherText, String privateKeyHex, String senderPubKeyHex)
    {
        const int separator = cipherText.indexOf("?iv=");
        if (separator <= 0) return "";
        std::vector<byte> encrypted, iv;
        if (!decodeBase64(cipherText.substring(0, separator), encrypted, maxCiphertextBytes) ||
            encrypted.size() % 16 ||
            !decodeBase64(cipherText.substring(separator + 4), iv, 16) || iv.size() != 16) return "";
        byte secret[32];
        if (!crypto::sharedSecret(privateKeyHex, senderPubKeyHex, secret)) return "";
        String result = decryptData(secret, iv.data(), encrypted.data(), encrypted.size());
        crypto::wipe(secret, sizeof(secret));
        return result;
    }

    bool parseSigningEnvelope(const char* data, size_t length, String& sender, String& ciphertext)
    {
        sender = "";
        ciphertext = "";
        if (json::parse(nostrEventDoc, data, length, json::MAX_ENVELOPE_BYTES, maxEnvelopeCapacity) ||
            !json::isSigningEnvelope(nostrEventDoc)) return false;
        sender = nostrEventDoc[2]["pubkey"].as<String>();
        ciphertext = nostrEventDoc[2]["content"].as<String>();
        return true;
    }

    String getContent(const String &serialisedJson)
    {
        if (json::parse(nostrEventDoc, serialisedJson.c_str(), serialisedJson.length(),
                        json::MAX_ENVELOPE_BYTES, maxEnvelopeCapacity)) return "";
        return nostrEventDoc[2]["content"].as<String>();
    }

    String getSenderPubKeyHex(const String &serialisedJson)
    {
        if (json::parse(nostrEventDoc, serialisedJson.c_str(), serialisedJson.length(),
                        json::MAX_ENVELOPE_BYTES, maxEnvelopeCapacity)) return "";
        return nostrEventDoc[2]["pubkey"].as<String>();
    }

    std::pair<String, String> getPubKeyAndContent(const String &serialisedJson)
    {
        if (json::parse(nostrEventDoc, serialisedJson.c_str(), serialisedJson.length(),
                        json::MAX_ENVELOPE_BYTES, maxEnvelopeCapacity)) return {"", ""};
        return {nostrEventDoc[2]["pubkey"].as<String>(), nostrEventDoc[2]["content"].as<String>()};
    }

    String nip04Decrypt(const char *privateKeyHex, String serialisedJson)
    {
        auto event = getPubKeyAndContent(serialisedJson);
        return decryptNip04Ciphertext(event.second, privateKeyHex, event.first);
    }

    String nip44Decrypt(const char *privateKeyHex, String serialisedJson)
    {
        _startTimer("nip44Decrypt: nip44Decrypt");
        auto result = getPubKeyAndContent(serialisedJson);
        String senderPubKeyHex = result.first;
        NOSTR_TRACE("nip44Decrypt: senderPubKeyHex is", senderPubKeyHex);
        String content = result.second;
        NOSTR_TRACE("nip44Decrypt: content is", content);
        _stopTimer("nip44Decrypt: Got result from getPubKeyAndContent");

        return executeDecryptMessageNip44(content, privateKeyHex, senderPubKeyHex);
    }

    String nip44Encrypt(const char *privateKeyHex, String serialisedJson)
    {
        _startTimer("nip44Encrypt: nip44Encrypt");
        auto result = getPubKeyAndContent(serialisedJson);
        String senderPubKeyHex = result.first;
        String content = result.second;
        _stopTimer("nip44Encrypt: Got result from getPubKeyAndContent");
        return executeEncryptMessageNip44(content, privateKeyHex, senderPubKeyHex);
    }

    /**
     * @brief Get a Note object
     *
     * @param privateKeyHex
     * @param pubKeyHex
     * @param timestamp
     * @param content
     * @param kind
     * @param tags
     * @return String
     */
    String getNote(char const *privateKeyHex, char const *pubKeyHex, unsigned long timestamp, String &content, uint16_t kind, String tags)
    {
        _startTimer("getNote");
        StaticJsonDocument<512> doc;
        canonicalEvent(doc, pubKeyHex, timestamp, kind, tags.c_str(), JsonString(content.c_str(), content.length()));
        String message = writeJson(doc);
        if (message.isEmpty()) return "";

        // sha256 of message converted to hex, assign to msghash
        byte hash[64] = {0}; // hash
        int hashLen = 0;

        // Get the sha256 hash of the message
        hashLen = sha256(message, hash);
        _stopTimer("get sha256 hash of message");
        String msgHash = toHex(hash, hashLen);
        _stopTimer("get msgHash as hex");
        NOSTR_TRACE("SHA-256: ", msgHash);

        // Create the private key object
        PrivateKey* privateKey = crypto::signingKey(String(privateKeyHex));
        if (!privateKey) return "";

        SchnorrSignature signature = privateKey->schnorr_sign(hash);
        String signatureHex = String(signature);
        NOSTR_TRACE("Schnorr sig is: ", signatureHex);

        doc.clear();
        doc["id"] = msgHash.c_str();
        doc["pubkey"] = pubKeyHex;
        doc["created_at"] = timestamp;
        doc["kind"] = kind;
        doc["tags"] = serialized(tags.c_str());
        doc["content"] = JsonString(content.c_str(), content.length());
        doc["sig"] = signatureHex.c_str();
        String serialisedDataString = writeJson(doc);
        return serialisedDataString;
    }

    /**
     * @brief Convert a string to a byte array
     *
     * @param input
     * @param padding_diff
     * @param output
     */
    void stringToByteArray(const char *input, int padding_diff, byte *output)
    {
        int i = 0;
        // remove end-of-string char
        while (input[i] != '\0')
        {
            output[i] = input[i];
            i++;
        }

        // pad between 1 and 16 bytes
        for (int j = 0; j < padding_diff; j++)
        {
            output[i + j] = padding_diff;
        }
    }

    /**
     * @brief encrypt data using AES-256-CBC
     *
     * @param key
     * @param iv
     * @param msg
     * @return String
     */
    String encryptData(byte key[32], byte iv[16], String &msg)
    {
        auto encrypted = paddedCiphertext(key, iv, msg);
        return encrypted.empty() ? String() : toHex(encrypted.data(), encrypted.size());
    }

    /**
     * @brief Get the cipher text for a nip4 message
     *
     * @param privateKeyHex
     * @param recipientPubKeyHex
     * @param content
     * @return String
     */
    String getCipherText(const char *privateKeyHex, const char *recipientPubKeyHex, const String &content)
    {
        byte secret[32], iv[16];
        if (!crypto::sharedSecret(String(privateKeyHex), String(recipientPubKeyHex), secret)) return "";
        esp_fill_random(iv, sizeof(iv));
        auto encrypted = paddedCiphertext(secret, iv, content);
        crypto::wipe(secret, sizeof(secret));
        if (encrypted.empty()) return "";
        return base64_encode(encrypted.data(), encrypted.size()) + "?iv=" + base64_encode(iv, sizeof(iv));
    }



    /**
     * @brief Get the Serialised Encrypted Dm Object
     *
     * @param pubKeyHex
     * @param recipientPubKeyHex
     * @param kind
     * @param msgHash
     * @param timestamp
     * @param encryptedMessageWithIv
     * @param schnorrSig
     * @return String
     */
    String getSerialisedEncryptedDmObject(const char *pubKeyHex, const char *recipientPubKeyHex, uint16_t kind, String &msgHash, int timestamp, String &encryptedMessageWithIv, String &schnorrSig)
    {
        // parse a JSON array
        String serialisedTagsArray = "[[\"p\",\"" + String(recipientPubKeyHex) + "\"]]";
        // NOSTR_TRACE("serialisedTagsArray is: ", serialisedTagsArray);

        // create the serialised fullEvent string using sprintf instead of the Arduino JSON library
        return "[\"EVENT\",{\"id\":\"" + msgHash + "\",\"pubkey\":\"" + pubKeyHex + "\",\"created_at\":" + String(timestamp) + ",\"kind\":" + String(kind) + ",\"tags\":" + serialisedTagsArray + ",\"content\":\"" + encryptedMessageWithIv + "\",\"sig\":\"" + schnorrSig + "\"}]";
    }

    String getSerialisedEncryptedDmArray(char const *pubKeyHex, char const *recipientPubKeyHex, uint16_t kind, int timestamp, String &encryptedMessageWithIv)
    {
        String serialisedTagsArray = "[[\"p\",\"" + String(recipientPubKeyHex) + "\"]]";
        String message = "[0,\"" + String(pubKeyHex) + "\"," + String(timestamp) + "," + String(kind) + "," + serialisedTagsArray + ",\"" + encryptedMessageWithIv + "\"]";

        // NOSTR_TRACE("message is: ", message);

        return message;
    }

    /**
     * @brief Get the Encrypted Dm object
     *
     * @param privateKeyHex
     * @param pubKeyHex
     * @param recipientPubKeyHex
     * @param kind
     * @param timestamp
     * @param content
     * @param type "nip44" or "nip04"
     * @return String
     */
    String getEncryptedDm(char const *privateKeyHex, char const *pubKeyHex, char const *recipientPubKeyHex, uint16_t kind, unsigned long timestamp, const String& content, const String& type)
    {
        String encryptedMessageBase64 = "";
        if (type == "nip44") {
            _startTimer("getEncrypted NIP44 Dm");
            encryptedMessageBase64 = executeEncryptMessageNip44(content, privateKeyHex, recipientPubKeyHex);
            NOSTR_TRACE("NIP44 encrypted message is: ", encryptedMessageBase64);
            _stopTimer("executeEncryptMessageNip44");
        } else {
            _startTimer("getEncrypted NIP44 Dm");
            encryptedMessageBase64 = getCipherText(privateKeyHex, recipientPubKeyHex, content);
            _stopTimer("getCipherText");
        }

        if (encryptedMessageBase64.isEmpty()) return "";

        String message = nostr::getSerialisedEncryptedDmArray(pubKeyHex, recipientPubKeyHex, kind, timestamp, encryptedMessageBase64);
        _stopTimer("get serialised encrypted dm array");

        byte hash[64] = {0}; // hash
        int hashLen = 0;

        // Get the sha256 hash of the message
        hashLen = sha256(message, hash);
        String msgHash = toHex(hash, hashLen);
        NOSTR_TRACE("SHA-256:", msgHash);
        _stopTimer("get sha256 hash of message");

        PrivateKey* privateKey = crypto::signingKey(String(privateKeyHex));
        if (!privateKey) return "";

        // Generate the schnorr sig of the messageHash
        SchnorrSignature signature = privateKey->schnorr_sign(hash);
        _stopTimer("generate schnorr sig");
        String signatureHex = String(signature);
        NOSTR_TRACE("Schnorr sig is: ", signatureHex);

        String serialisedEventData = nostr::getSerialisedEncryptedDmObject(pubKeyHex, recipientPubKeyHex, kind, msgHash, timestamp, encryptedMessageBase64, signatureHex);
        _stopTimer("get serialised encrypted dm object");
        // NOSTR_TRACE("serialisedEventData is", serialisedEventData);
        return serialisedEventData;
    }
}
