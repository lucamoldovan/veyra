#include <Processing.NDI.Lib.h>

#include "veyra/config/config.hpp"
#include "veyra/ndi/discovery.hpp"
#include "veyra/ndi/receiver.hpp"
#include "veyra/video/renderer.hpp"

#include <spdlog/spdlog.h>

#include <chrono>
#include <cstdlib>
#include <exception>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace {

std::optional<veyra::ndi::Source> selectSource(
    const std::vector<veyra::ndi::Source>& sources,
    const veyra::config::NdiConfig& config
) {
    if (!config.sourceAddress.empty()) {
        for (const auto& source : sources) {
            if (source.url == config.sourceAddress) {
                return source;
            }
        }
        return std::nullopt;
    }

    if (!config.sourceName.empty()) {
        for (const auto& source : sources) {
            if (source.name == config.sourceName) {
                return source;
            }
        }
        return std::nullopt;
    }

    if (sources.size() == 1) {
        return sources.front();
    }

    return std::nullopt;
}

}  // namespace

int main(int argc, char* argv[]) {
    std::filesystem::path configPath = "/etc/veyra/config.json";

    for (int index = 1; index < argc; ++index) {
        const std::string argument = argv[index];
        if (argument == "--help" || argument == "-h") {
            spdlog::info("Usage: veyra [--config /path/to/config.json]");
            return EXIT_SUCCESS;
        }

        if (argument == "--config" && index + 1 < argc) {
            configPath = argv[++index];
            continue;
        }

        spdlog::error("Unknown or incomplete argument: {}", argument);
        spdlog::info("Usage: veyra [--config /path/to/config.json]");
        return EXIT_FAILURE;
    }

    spdlog::info("Veyra {} starting", "0.1.0");

    if (!NDIlib_initialize()) {
        spdlog::critical("Failed to initialize the NDI runtime");
        return EXIT_FAILURE;
    }

    int exitCode = EXIT_SUCCESS;
    try {
        const auto config = veyra::config::load(configPath);
        if (!std::filesystem::exists(configPath)) {
            spdlog::warn(
                "Configuration file '{}' was not found; using defaults",
                configPath.string()
            );
        }

        veyra::video::Renderer renderer(config.display);
        veyra::ndi::Discovery discovery;
        std::unique_ptr<veyra::ndi::Receiver> receiver;

        bool displayIsClear = true;
        bool playbackWasActive = false;
        auto lastFrameAt = std::chrono::steady_clock::now();
        auto lastDiscoveryLog = lastFrameAt;

        spdlog::info("Waiting for the configured NDI source");

        while (renderer.pollEvents()) {
            if (!receiver) {
                (void)discovery.waitForChanges(250);
                const auto sources = discovery.currentSources();
                const auto selected = selectSource(sources, config.ndi);

                if (selected.has_value()) {
                    spdlog::info(
                        "Connecting to NDI source '{}' [{}]",
                        selected->name,
                        selected->identity()
                    );
                    receiver =
                        std::make_unique<veyra::ndi::Receiver>(*selected);
                    lastFrameAt = std::chrono::steady_clock::now();
                    continue;
                }

                const auto now = std::chrono::steady_clock::now();
                if (now - lastDiscoveryLog >= std::chrono::seconds(5)) {
                    if (sources.empty()) {
                        spdlog::info("No NDI sources are currently available");
                    } else if (config.ndi.sourceName.empty() &&
                               config.ndi.sourceAddress.empty()) {
                        spdlog::warn(
                            "Found {} NDI sources; configure sourceName or "
                            "sourceAddress to choose one",
                            sources.size()
                        );
                        for (const auto& source : sources) {
                            spdlog::info(
                                "Available source: {} [{}]",
                                source.name,
                                source.identity()
                            );
                        }
                    } else {
                        spdlog::info(
                            "Configured NDI source is not currently available"
                        );
                    }
                    lastDiscoveryLog = now;
                }

                if (!displayIsClear) {
                    renderer.clear();
                    displayIsClear = true;
                }
                continue;
            }

            auto frame = receiver->capture(50);
            if (frame.has_value()) {
                renderer.present(*frame);
                displayIsClear = false;

                if (!playbackWasActive) {
                    spdlog::info(
                        "Video playback started: {}x{}",
                        frame->width,
                        frame->height
                    );
                    playbackWasActive = true;
                }
                lastFrameAt = std::chrono::steady_clock::now();
                continue;
            }

            const auto now = std::chrono::steady_clock::now();
            const bool connected = receiver->isConnected();
            const bool frameIsStale =
                now - lastFrameAt > std::chrono::seconds(2);

            if (!connected || frameIsStale) {
                if (playbackWasActive) {
                    spdlog::warn(
                        "NDI video stopped; waiting for the source to recover"
                    );
                    playbackWasActive = false;
                }

                if (!displayIsClear) {
                    renderer.clear();
                    displayIsClear = true;
                }
            }
        }
    } catch (const std::exception& error) {
        spdlog::critical("Veyra stopped after an error: {}", error.what());
        exitCode = EXIT_FAILURE;
    }

    // All NDI finder and receiver instances are destroyed before the runtime.
    NDIlib_destroy();

    spdlog::info("Veyra shut down");
    return exitCode;
}
