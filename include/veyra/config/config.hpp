#pragma once

#include <filesystem>
#include <string>

namespace veyra::config {

struct NdiConfig {
    std::string sourceName;
    std::string sourceAddress;
};

struct DisplayConfig {
    int width{1920};
    int height{1080};
    int targetFps{30};
    bool fullscreen{true};
    bool vsync{true};
};

struct AppConfig {
    NdiConfig ndi;
    DisplayConfig display;
};

[[nodiscard]] AppConfig load(const std::filesystem::path& path);

}  // namespace veyra::config
