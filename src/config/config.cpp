#include "veyra/config/config.hpp"

#include <nlohmann/json.hpp>

#include <cstdint>
#include <fstream>
#include <stdexcept>
#include <string>

namespace veyra::config {
namespace {

using Json = nlohmann::json;

const Json& objectOrEmpty(const Json& parent, const char* key, Json& empty) {
    if (!parent.contains(key)) {
        return empty;
    }

    const Json& value = parent.at(key);
    if (!value.is_object()) {
        throw std::runtime_error(std::string("Configuration section '") +
                                 key + "' must be an object");
    }
    return value;
}

std::string readString(
    const Json& object,
    const char* key,
    const std::string& fallback
) {
    if (!object.contains(key)) {
        return fallback;
    }
    if (!object.at(key).is_string()) {
        throw std::runtime_error(std::string("Configuration value '") +
                                 key + "' must be a string");
    }
    return object.at(key).get<std::string>();
}

int readInteger(
    const Json& object,
    const char* key,
    const int fallback,
    const int minimum,
    const int maximum
) {
    if (!object.contains(key)) {
        return fallback;
    }

    const Json& value = object.at(key);
    if (!value.is_number_integer()) {
        throw std::runtime_error(std::string("Configuration value '") +
                                 key + "' must be an integer");
    }

    if (value.is_number_unsigned()) {
        const auto parsed = value.get<std::uint64_t>();
        if (parsed > static_cast<std::uint64_t>(maximum)) {
            throw std::runtime_error(std::string("Configuration value '") +
                                     key + "' is outside its allowed range");
        }
        return static_cast<int>(parsed);
    }

    const auto parsed = value.get<std::int64_t>();
    if (parsed < minimum || parsed > maximum) {
        throw std::runtime_error(std::string("Configuration value '") +
                                 key + "' is outside its allowed range");
    }
    return static_cast<int>(parsed);
}

bool readBoolean(const Json& object, const char* key, const bool fallback) {
    if (!object.contains(key)) {
        return fallback;
    }
    if (!object.at(key).is_boolean()) {
        throw std::runtime_error(std::string("Configuration value '") +
                                 key + "' must be true or false");
    }
    return object.at(key).get<bool>();
}

}  // namespace

AppConfig load(const std::filesystem::path& path) {
    AppConfig config;

    if (!std::filesystem::exists(path)) {
        return config;
    }

    std::ifstream input(path);
    if (!input) {
        throw std::runtime_error("Could not open configuration file: " +
                                 path.string());
    }

    Json document;
    try {
        input >> document;
    } catch (const Json::exception& error) {
        throw std::runtime_error("Invalid JSON in configuration file: " +
                                 std::string(error.what()));
    }

    if (!document.is_object()) {
        throw std::runtime_error("Configuration root must be a JSON object");
    }

    const int schemaVersion =
        readInteger(document, "schemaVersion", 1, 1, 1);
    (void)schemaVersion;

    Json emptyObject = Json::object();
    const Json& ndi = objectOrEmpty(document, "ndi", emptyObject);
    config.ndi.sourceName = readString(ndi, "sourceName", "");
    config.ndi.sourceAddress = readString(ndi, "sourceAddress", "");

    const Json& display = objectOrEmpty(document, "display", emptyObject);
    config.display.width =
        readInteger(display, "width", 1920, 320, 7680);
    config.display.height =
        readInteger(display, "height", 1080, 240, 4320);
    config.display.targetFps =
        readInteger(display, "targetFps", 30, 1, 120);
    config.display.fullscreen =
        readBoolean(display, "fullscreen", true);
    config.display.vsync = readBoolean(display, "vsync", true);

    return config;
}

}  // namespace veyra::config
