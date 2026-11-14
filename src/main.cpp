#include <Processing.NDI.Lib.h>

#include <SDL.h>
#include <spdlog/spdlog.h>

#include <cstdlib>

int main() {
    spdlog::info("Veyra {} starting", "0.1.0");

    if (!NDIlib_initialize()) {
        spdlog::critical("Failed to initialize the NDI runtime");
        return EXIT_FAILURE;
    }

    if (SDL_Init(SDL_INIT_VIDEO) != 0) {
        spdlog::critical("Failed to initialize SDL: {}", SDL_GetError());
        NDIlib_destroy();
        return EXIT_FAILURE;
    }

    // The receiver and renderer are implemented in the next milestones.
    spdlog::info("NDI runtime and SDL initialized successfully");

    SDL_Quit();
    NDIlib_destroy();

    spdlog::info("Veyra shut down cleanly");
    return EXIT_SUCCESS;
}
