#include "veyra/config/config.hpp"

#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

int failures = 0;

void check(const bool condition, const std::string& message) {
    if (!condition) {
        std::cerr << "FAIL: " << message << '\n';
        ++failures;
    }
}

void writeFile(const std::filesystem::path& path, const std::string& contents) {
    std::ofstream output(path);
    if (!output) {
        throw std::runtime_error("Could not create test configuration file");
    }
    output << contents;
}

template <typename Callback>
bool throws(Callback&& callback) {
    try {
        callback();
    } catch (const std::exception&) {
        return true;
    }
    return false;
}

}  // namespace

int main() {
    const auto testDirectory =
        std::filesystem::temp_directory_path() / "veyra-config-tests";
    std::filesystem::remove_all(testDirectory);
    std::filesystem::create_directories(testDirectory);

    const auto configPath = testDirectory / "config.json";

    const auto defaults = veyra::config::load(configPath);
    check(defaults.display.width == 1920, "missing config uses 1920 width");
    check(defaults.display.height == 1080, "missing config uses 1080 height");
    check(defaults.display.targetFps == 30, "missing config uses 30 FPS");
    check(defaults.display.fullscreen, "fullscreen defaults to true");
    check(defaults.display.vsync, "vsync defaults to true");

    writeFile(
        configPath,
        R"({
            "schemaVersion": 1,
            "ndi": {
                "sourceName": "Studio Output",
                "sourceAddress": "ndi://192.168.1.20"
            },
            "display": {
                "width": 1280,
                "height": 720,
                "targetFps": 25,
                "fullscreen": false,
                "vsync": false
            }
        })"
    );

    const auto loaded = veyra::config::load(configPath);
    check(loaded.ndi.sourceName == "Studio Output", "loads NDI source name");
    check(
        loaded.ndi.sourceAddress == "ndi://192.168.1.20",
        "loads NDI source address"
    );
    check(loaded.display.width == 1280, "loads display width");
    check(loaded.display.height == 720, "loads display height");
    check(loaded.display.targetFps == 25, "loads target frame rate");
    check(!loaded.display.fullscreen, "loads fullscreen setting");
    check(!loaded.display.vsync, "loads vsync setting");

    writeFile(
        configPath,
        R"({"schemaVersion":1,"display":{"width":0}})"
    );
    check(
        throws([&] { (void)veyra::config::load(configPath); }),
        "rejects out-of-range display width"
    );

    writeFile(
        configPath,
        R"({"schemaVersion":1,"display":{"targetFps":121}})"
    );
    check(
        throws([&] { (void)veyra::config::load(configPath); }),
        "rejects an output frame rate above 120 FPS"
    );

    writeFile(
        configPath,
        R"({"schemaVersion":1,"ndi":{"sourceName":42}})"
    );
    check(
        throws([&] { (void)veyra::config::load(configPath); }),
        "rejects a non-string NDI source name"
    );

    writeFile(configPath, R"({"schemaVersion":2})");
    check(
        throws([&] { (void)veyra::config::load(configPath); }),
        "rejects unsupported schema versions"
    );

    writeFile(configPath, R"({"schemaVersion":1,"ndi":)");
    check(
        throws([&] { (void)veyra::config::load(configPath); }),
        "rejects malformed JSON"
    );

    std::filesystem::remove_all(testDirectory);

    if (failures != 0) {
        std::cerr << failures << " configuration test(s) failed\n";
        return 1;
    }

    std::cout << "All configuration tests passed\n";
    return 0;
}
