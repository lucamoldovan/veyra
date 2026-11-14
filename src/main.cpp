#include <Processing.NDI.Lib.h>

#include "veyra/ndi/discovery.hpp"

#include <spdlog/spdlog.h>

#include <cstdlib>
#include <exception>

int main() {
    spdlog::info("Veyra {} starting", "0.1.0");

    if (!NDIlib_initialize()) {
        spdlog::critical("Failed to initialize the NDI runtime");
        return EXIT_FAILURE;
    }

    int exitCode = EXIT_SUCCESS;
    try {
        veyra::ndi::Discovery discovery;

        // NDI discovery is asynchronous; give mDNS a moment to populate
        // the initial source list before taking the first snapshot.
        (void)discovery.waitForChanges(3000);

        const auto sources = discovery.currentSources();
        if (sources.empty()) {
            spdlog::warn("No NDI sources found on the local network");
        } else {
            spdlog::info("Discovered {} NDI source(s)", sources.size());
            for (const auto& source : sources) {
                spdlog::info("NDI source: {} [{}]", source.name, source.identity());
            }
        }
    } catch (const std::exception& error) {
        spdlog::critical("NDI discovery failed: {}", error.what());
        exitCode = EXIT_FAILURE;
    }

    // Discovery is destroyed before the global NDI runtime is shut down.
    NDIlib_destroy();

    spdlog::info("Veyra discovery stage finished");
    return exitCode;
}
