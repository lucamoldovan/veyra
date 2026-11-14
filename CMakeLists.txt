cmake_minimum_required(VERSION 3.20)

project(Veyra
    VERSION 0.1.0
    DESCRIPTION "A lightweight Linux NDI video receiver"
    LANGUAGES CXX
)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(VEYRA_BUILD_TESTS "Build Veyra tests" ON)

find_package(PkgConfig REQUIRED)
pkg_check_modules(SDL2 REQUIRED IMPORTED_TARGET sdl2)

find_package(spdlog CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)

# NDI SDK installation varies by platform and version. The SDK path can be
# supplied with NDI_SDK_DIR; discovery is intentionally explicit.
set(NDI_SDK_DIR "" CACHE PATH "Path to the installed NDI SDK")
find_path(NDI_INCLUDE_DIR Processing.NDI.Lib.h
    HINTS
        "${NDI_SDK_DIR}/include"
        "${NDI_SDK_DIR}/Include"
)
find_library(NDI_LIBRARY
    NAMES ndi
    HINTS
        "${NDI_SDK_DIR}/lib"
        "${NDI_SDK_DIR}/Lib"
        "${NDI_SDK_DIR}/lib/x86_64-linux-gnu"
)

if(NOT NDI_INCLUDE_DIR OR NOT NDI_LIBRARY)
    message(FATAL_ERROR
        "NDI SDK not found. Install the official NDI SDK and configure "
        "-DNDI_SDK_DIR=/path/to/ndi/sdk."
    )
endif()

add_executable(veyra
    src/main.cpp
)

target_include_directories(veyra PRIVATE "${NDI_INCLUDE_DIR}")
target_link_libraries(veyra PRIVATE
    PkgConfig::SDL2
    spdlog::spdlog
    nlohmann_json::nlohmann_json
    "${NDI_LIBRARY}"
)

target_compile_options(veyra PRIVATE
    -Wall
    -Wextra
    -Wpedantic
)

install(TARGETS veyra RUNTIME DESTINATION bin)
