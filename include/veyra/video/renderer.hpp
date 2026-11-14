#pragma once

#include "veyra/config/config.hpp"
#include "veyra/ndi/receiver.hpp"

#include <SDL.h>

#include <cstdint>
#include <vector>

namespace veyra::video {

class Renderer {
public:
    explicit Renderer(const config::DisplayConfig& config);
    ~Renderer();

    Renderer(const Renderer&) = delete;
    Renderer& operator=(const Renderer&) = delete;

    Renderer(Renderer&&) = delete;
    Renderer& operator=(Renderer&&) = delete;

    [[nodiscard]] bool pollEvents();
    void present(const ndi::VideoFrame& frame);
    void clear();

private:
    [[nodiscard]] bool createTexture(
        int width,
        int height,
        Uint32 format
    );
    void destroyTexture() noexcept;
    void convertUyvyToBgra(const ndi::VideoFrame& frame);

    SDL_Window* window_{nullptr};
    SDL_Renderer* renderer_{nullptr};
    SDL_Texture* texture_{nullptr};
    int textureWidth_{0};
    int textureHeight_{0};
    Uint32 textureFormat_{SDL_PIXELFORMAT_UNKNOWN};
    bool sdlInitialized_{false};
    std::vector<std::uint8_t> conversionBuffer_;
};

}  // namespace veyra::video
