#include <Processing.NDI.Lib.h>

#include "veyra/config/config.hpp"
#include "veyra/ndi/discovery.hpp"
#include "veyra/ndi/receiver.hpp"
#include "veyra/video/renderer.hpp"

#include <spdlog/spdlog.h>

#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <exception>
#include <filesystem>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {

volatile std::sig_atomic_t shutdownRequested = 0;

void handleShutdownSignal(int) {
    shutdownRequested = 1;
}

int listSources() {
    try {
        veyra::ndi::Discovery discovery;
        const auto discoveryDeadline =
            std::chrono::steady_clock::now() + std::chrono::seconds(5);
        while (std::chrono::steady_clock::now() < discoveryDeadline) {
            (void)discovery.waitForChanges(250);
        }
        const auto sources = discovery.currentSources();

        if (sources.empty()) {
            spdlog::warn("No NDI sources found");
            return EXIT_SUCCESS;
        }

        spdlog::info("Found {} NDI source(s):", sources.size());
        for (const auto& source : sources) {
            spdlog::info("Name: {}", source.name);
            spdlog::info("Address: {}", source.identity());
        }
        return EXIT_SUCCESS;
    } catch (const std::exception& error) {
        spdlog::error("Could not list NDI sources: {}", error.what());
        return EXIT_FAILURE;
    }
}

std::optional<veyra::ndi::Source> selectSource(
    const std::vector<veyra::ndi::Source>& sources,
    const veyra::config::NdiConfig& config,
    const bool allowAutomaticSelection
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

    if (allowAutomaticSelection && sources.size() == 1) {
        return sources.front();
    }

    return std::nullopt;
}

}  // namespace

int main(int argc, char* argv[]) {
    std::filesystem::path configPath = "/etc/veyra/config.json";
    bool listSourcesOnly = false;

    for (int index = 1; index < argc; ++index) {
        const std::string argument = argv[index];
        if (argument == "--help" || argument == "-h") {
            spdlog::info(
                "Usage: veyra [--config /path/to/config.json] [--list-sources]"
            );
            return EXIT_SUCCESS;
        }

        if (argument == "--list-sources") {
            listSourcesOnly = true;
            continue;
        }

        if (argument == "--config" && index + 1 < argc) {
            configPath = argv[++index];
            continue;
        }

        spdlog::error("Unknown or incomplete argument: {}", argument);
        spdlog::info(
            "Usage: veyra [--config /path/to/config.json] [--list-sources]"
        );
        return EXIT_FAILURE;
    }

    std::signal(SIGINT, handleShutdownSignal);
    std::signal(SIGTERM, handleShutdownSignal);

    spdlog::info("Veyra {} starting", "0.1.0");

    if (!NDIlib_initialize()) {
        spdlog::critical("Failed to initialize the NDI runtime");
        return EXIT_FAILURE;
    }

    if (listSourcesOnly) {
        const int listExitCode = listSources();
        NDIlib_destroy();
        return listExitCode;
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
        std::mutex latestFrameMutex;
        std::optional<veyra::ndi::VideoFrame> latestFrame;
        std::atomic_bool captureFailed{false};
        std::jthread captureThread;

        bool displayIsClear = true;
        bool playbackWasActive = false;
        const auto frameInterval =
            std::chrono::duration_cast<std::chrono::steady_clock::duration>(
                std::chrono::duration<double>(1.0 / config.display.targetFps)
            );
        auto nextPresentationAt = std::chrono::steady_clock::now();
        const auto discoveryStartedAt = nextPresentationAt;
        auto lastFrameAt = nextPresentationAt;
        auto lastDiscoveryLog = lastFrameAt;

        spdlog::info("Waiting for the configured NDI source");

        while (shutdownRequested == 0 && renderer.pollEvents()) {
            if (!receiver) {
                (void)discovery.waitForChanges(250);
                const auto sources = discovery.currentSources();
                const bool automaticSelectionReady =
                    std::chrono::steady_clock::now() - discoveryStartedAt >=
                    std::chrono::seconds(3);
                const auto selected = selectSource(
                    sources,
                    config.ndi,
                    automaticSelectionReady
                );

                if (selected.has_value()) {
                    spdlog::info(
                        "Connecting to NDI source '{}' [{}]",
                        selected->name,
                        selected->identity()
                    );
                    receiver =
                        std::make_unique<veyra::ndi::Receiver>(*selected);

                    auto* activeReceiver = receiver.get();
                    captureThread = std::jthread(
                        [activeReceiver, &latestFrameMutex, &latestFrame,
                         &captureFailed](const std::stop_token stopToken) {
                            try {
                                while (!stopToken.stop_requested()) {
                                    auto captured = activeReceiver->capture(100);
                                    if (captured.has_value()) {
                                        std::lock_guard lock(latestFrameMutex);
                                        latestFrame = std::move(*captured);
                                    }
                                }
                            } catch (const std::exception& error) {
                                spdlog::critical(
                                    "NDI capture worker failed: {}",
                                    error.what()
                                );
                                captureFailed.store(true);
                            }
                        }
                    );

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

            if (captureFailed.load()) {
                throw std::runtime_error("NDI capture worker stopped unexpectedly");
            }

            const auto now = std::chrono::steady_clock::now();
            std::optional<veyra::ndi::VideoFrame> frame;
            if (now >= nextPresentationAt) {
                std::lock_guard lock(latestFrameMutex);
                if (latestFrame.has_value()) {
                    frame = std::move(latestFrame);
                    latestFrame.reset();
                }
            }

            if (frame.has_value()) {
                nextPresentationAt = now + frameInterval;
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

            const auto statusTime = std::chrono::steady_clock::now();
            const bool frameIsStale =
                statusTime - lastFrameAt > std::chrono::seconds(2);

            if (frameIsStale) {
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

            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        }

        if (captureThread.joinable()) {
            captureThread.request_stop();
            captureThread.join();
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
