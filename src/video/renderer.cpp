#include "veyra/video/renderer.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>

namespace veyra::video {
namespace {

std::runtime_error sdlError(const std::string& operation) {
    return std::runtime_error(operation + ": " + SDL_GetError());
}

std::uint8_t clampChannel(const int value) {
    return static_cast<std::uint8_t>(std::clamp(value, 0, 255));
}

}  // namespace

Renderer::Renderer(const config::DisplayConfig& config) {
    if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS) != 0) {
        throw sdlError("Could not initialize SDL");
    }
    sdlInitialized_ = true;

    SDL_SetHint(SDL_HINT_RENDER_SCALE_QUALITY, "linear");

    Uint32 windowFlags = SDL_WINDOW_SHOWN | SDL_WINDOW_ALLOW_HIGHDPI;
    if (config.fullscreen) {
        windowFlags |= SDL_WINDOW_FULLSCREEN_DESKTOP;
    }

    window_ = SDL_CreateWindow(
        "Veyra",
        SDL_WINDOWPOS_CENTERED,
        SDL_WINDOWPOS_CENTERED,
        config.width,
        config.height,
        windowFlags
    );

    if (window_ == nullptr) {
        const auto error = sdlError("Could not create the Veyra window");
        SDL_Quit();
        sdlInitialized_ = false;
        throw error;
    }

    Uint32 rendererFlags = SDL_RENDERER_ACCELERATED;
    if (config.vsync) {
        rendererFlags |= SDL_RENDERER_PRESENTVSYNC;
    }

    renderer_ = SDL_CreateRenderer(window_, -1, rendererFlags);
    if (renderer_ == nullptr && config.vsync) {
        renderer_ = SDL_CreateRenderer(
            window_,
            -1,
            SDL_RENDERER_ACCELERATED
        );
    }
    if (renderer_ == nullptr) {
        renderer_ = SDL_CreateRenderer(window_, -1, SDL_RENDERER_SOFTWARE);
    }

    if (renderer_ == nullptr) {
        const auto error = sdlError("Could not create an SDL renderer");
        SDL_DestroyWindow(window_);
        window_ = nullptr;
        SDL_Quit();
        sdlInitialized_ = false;
        throw error;
    }

    SDL_ShowCursor(SDL_DISABLE);
    SDL_SetRenderDrawColor(renderer_, 0, 0, 0, 255);
    SDL_RenderClear(renderer_);
    SDL_RenderPresent(renderer_);
}

Renderer::~Renderer() {
    destroyTexture();

    if (renderer_ != nullptr) {
        SDL_DestroyRenderer(renderer_);
    }
    if (window_ != nullptr) {
        SDL_DestroyWindow(window_);
    }
    if (sdlInitialized_) {
        SDL_ShowCursor(SDL_ENABLE);
        SDL_Quit();
    }
}

bool Renderer::pollEvents() {
    SDL_Event event;
    while (SDL_PollEvent(&event) != 0) {
        if (event.type == SDL_QUIT) {
            return false;
        }

        if (event.type == SDL_KEYDOWN && event.key.keysym.sym == SDLK_ESCAPE) {
            return false;
        }

        if (event.type == SDL_RENDER_DEVICE_RESET ||
            event.type == SDL_RENDER_TARGETS_RESET) {
            destroyTexture();
        }
    }
    return true;
}

bool Renderer::createTexture(
    const int width,
    const int height,
    const Uint32 format
) {
    if (texture_ != nullptr && textureWidth_ == width &&
        textureHeight_ == height && textureFormat_ == format) {
        return true;
    }

    destroyTexture();
    texture_ = SDL_CreateTexture(
        renderer_,
        format,
        SDL_TEXTUREACCESS_STREAMING,
        width,
        height
    );

    if (texture_ == nullptr) {
        return false;
    }

    if (SDL_SetTextureBlendMode(texture_, SDL_BLENDMODE_NONE) != 0) {
        destroyTexture();
        return false;
    }

    textureWidth_ = width;
    textureHeight_ = height;
    textureFormat_ = format;
    return true;
}

void Renderer::destroyTexture() noexcept {
    if (texture_ != nullptr) {
        SDL_DestroyTexture(texture_);
        texture_ = nullptr;
    }

    textureWidth_ = 0;
    textureHeight_ = 0;
    textureFormat_ = SDL_PIXELFORMAT_UNKNOWN;
}

bool Renderer::uploadPixels(
    const std::uint8_t* pixels,
    const int sourcePitch,
    const int rowBytes,
    const int height
) {
    if (pixels == nullptr || sourcePitch < rowBytes || rowBytes <= 0 ||
        height <= 0) {
        return false;
    }

    void* texturePixels = nullptr;
    int texturePitch = 0;
    if (SDL_LockTexture(
            texture_,
            nullptr,
            &texturePixels,
            &texturePitch
        ) != 0) {
        return false;
    }

    if (texturePixels == nullptr || texturePitch < rowBytes) {
        SDL_UnlockTexture(texture_);
        return false;
    }

    const auto* source = pixels;
    auto* destination = static_cast<std::uint8_t*>(texturePixels);
    for (int row = 0; row < height; ++row) {
        std::memcpy(
            destination + static_cast<std::size_t>(row) *
                static_cast<std::size_t>(texturePitch),
            source + static_cast<std::size_t>(row) *
                static_cast<std::size_t>(sourcePitch),
            static_cast<std::size_t>(rowBytes)
        );
    }

    SDL_UnlockTexture(texture_);
    return true;
}

void Renderer::convertUyvyToBgra(const ndi::VideoFrame& frame) {
    if (frame.format != ndi::PixelFormat::UYVY || frame.width <= 0 ||
        frame.height <= 0 || (frame.width % 2) != 0 ||
        static_cast<std::int64_t>(frame.stride) <
            static_cast<std::int64_t>(frame.width) * 2) {
        throw std::runtime_error("Invalid UYVY frame supplied to renderer");
    }

    const auto inputStride = static_cast<std::size_t>(frame.stride);
    const auto height = static_cast<std::size_t>(frame.height);
    if (height > frame.pixels.size() / inputStride) {
        throw std::runtime_error("UYVY frame buffer is smaller than its dimensions");
    }

    const std::size_t outputStride =
        static_cast<std::size_t>(frame.width) * 4U;
    constexpr std::size_t maxConvertedFrameBytes = 512U * 1024U * 1024U;
    if (height > maxConvertedFrameBytes / outputStride) {
        throw std::runtime_error("Converted video frame exceeds the memory limit");
    }
    conversionBuffer_.resize(outputStride * height);

    const bool isHd = frame.width > 720 || frame.height > 576;

    for (int y = 0; y < frame.height; ++y) {
        const auto* source = frame.pixels.data() +
            static_cast<std::size_t>(y) *
                static_cast<std::size_t>(frame.stride);
        auto* destination = conversionBuffer_.data() +
            static_cast<std::size_t>(y) * outputStride;

        for (int x = 0; x < frame.width; x += 2) {
            const int u = static_cast<int>(source[0]) - 128;
            const int y0 = static_cast<int>(source[1]) - 16;
            const int v = static_cast<int>(source[2]) - 128;
            const int y1 = static_cast<int>(source[3]) - 16;

            const auto writePixel = [&](const int luminance,
                                        std::uint8_t* pixel) {
                const int c = std::max(0, luminance);
                int red;
                int green;
                int blue;

                if (isHd) {
                    red = (298 * c + 459 * v + 128) >> 8;
                    green = (298 * c - 55 * u - 136 * v + 128) >> 8;
                    blue = (298 * c + 541 * u + 128) >> 8;
                } else {
                    red = (298 * c + 409 * v + 128) >> 8;
                    green = (298 * c - 100 * u - 208 * v + 128) >> 8;
                    blue = (298 * c + 516 * u + 128) >> 8;
                }

                pixel[0] = clampChannel(blue);
                pixel[1] = clampChannel(green);
                pixel[2] = clampChannel(red);
                pixel[3] = 255;
            };

            writePixel(y0, destination);
            writePixel(y1, destination + 4);

            source += 4;
            destination += 8;
        }
    }
}

void Renderer::present(const ndi::VideoFrame& frame) {
    if (frame.width <= 0 || frame.height <= 0 || frame.stride <= 0 ||
        frame.pixels.empty()) {
        throw std::runtime_error("Renderer received an invalid video frame");
    }

    const int bytesPerPixel =
        frame.format == ndi::PixelFormat::UYVY ? 2 : 4;
    if (frame.format == ndi::PixelFormat::UYVY && (frame.width % 2) != 0) {
        throw std::runtime_error("UYVY video width must be even");
    }

    const auto rowBytes64 =
        static_cast<std::int64_t>(frame.width) * bytesPerPixel;
    if (rowBytes64 > std::numeric_limits<int>::max() ||
        frame.stride < rowBytes64) {
        throw std::runtime_error("Video frame stride is invalid");
    }

    const auto inputStride = static_cast<std::size_t>(frame.stride);
    const auto frameHeight = static_cast<std::size_t>(frame.height);
    if (frameHeight > frame.pixels.size() / inputStride) {
        throw std::runtime_error("Video frame buffer is smaller than its dimensions");
    }

    const int rowBytes = static_cast<int>(rowBytes64);
    Uint32 desiredFormat = frame.format == ndi::PixelFormat::UYVY
        ? SDL_PIXELFORMAT_UYVY
        : SDL_PIXELFORMAT_BGRA32;

    bool converted = false;
    if (!createTexture(frame.width, frame.height, desiredFormat)) {
        if (frame.format != ndi::PixelFormat::UYVY) {
            throw sdlError("Could not create the video texture");
        }

        convertUyvyToBgra(frame);
        desiredFormat = SDL_PIXELFORMAT_BGRA32;
        converted = true;
        if (!createTexture(frame.width, frame.height, desiredFormat)) {
            throw sdlError("Could not create the fallback video texture");
        }
    }

    bool uploaded = false;
    if (!converted) {
        uploaded = uploadPixels(
            frame.pixels.data(),
            frame.stride,
            rowBytes,
            frame.height
        );
    }

    if (!uploaded) {
        if (frame.format != ndi::PixelFormat::UYVY || converted) {
            throw sdlError("Could not upload the video frame");
        }

        convertUyvyToBgra(frame);
        if (!createTexture(
                frame.width,
                frame.height,
                SDL_PIXELFORMAT_BGRA32
            )) {
            throw sdlError("Could not create the fallback video texture");
        }

        uploaded = uploadPixels(
            conversionBuffer_.data(),
            frame.width * 4,
            frame.width * 4,
            frame.height
        );
        if (!uploaded) {
            throw sdlError("Could not upload the converted video frame");
        }
    }

    int outputWidth = 0;
    int outputHeight = 0;
    if (SDL_GetRendererOutputSize(
            renderer_,
            &outputWidth,
            &outputHeight
        ) != 0) {
        throw sdlError("Could not read renderer output dimensions");
    }

    const double scale = std::min(
        static_cast<double>(outputWidth) / frame.width,
        static_cast<double>(outputHeight) / frame.height
    );

    const int destinationWidth =
        static_cast<int>(std::lround(frame.width * scale));
    const int destinationHeight =
        static_cast<int>(std::lround(frame.height * scale));

    SDL_Rect destination{
        (outputWidth - destinationWidth) / 2,
        (outputHeight - destinationHeight) / 2,
        destinationWidth,
        destinationHeight
    };

    if (SDL_RenderClear(renderer_) != 0 ||
        SDL_RenderCopy(renderer_, texture_, nullptr, &destination) != 0) {
        throw sdlError("Could not render the video frame");
    }

    SDL_RenderPresent(renderer_);
}

void Renderer::clear() {
    if (SDL_SetRenderDrawColor(renderer_, 0, 0, 0, 255) != 0 ||
        SDL_RenderClear(renderer_) != 0) {
        throw sdlError("Could not clear the display");
    }
    SDL_RenderPresent(renderer_);
}

}  // namespace veyra::video
