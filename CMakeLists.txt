cmake_minimum_required(VERSION 3.20)

project(Veyra
    VERSION 0.1.0
    DESCRIPTION "A lightweight Linux NDI video receiver"
    LANGUAGES CXX
)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(VEYRA_BUILD_PLAYER "Build the NDI video player" ON)
option(VEYRA_BUILD_TESTS "Build Veyra unit tests" ON)

find_package(nlohmann_json CONFIG REQUIRED)

if(VEYRA_BUILD_PLAYER)
    find_package(PkgConfig REQUIRED)
    find_package(Threads REQUIRED)
    find_package(CURL REQUIRED)
    pkg_check_modules(SDL2 REQUIRED IMPORTED_TARGET sdl2)
    pkg_check_modules(SDL2_IMAGE REQUIRED IMPORTED_TARGET SDL2_image)

    find_package(spdlog CONFIG REQUIRED)

    # NDI SDK installation varies by platform and version. The SDK path can be
    # supplied with NDI_SDK_DIR; discovery is intentionally explicit.
    set(NDI_SDK_DIR "" CACHE PATH "Path to the installed NDI SDK")
    find_path(NDI_INCLUDE_DIR Processing.NDI.Lib.h
        HINTS
            "${NDI_SDK_DIR}/include"
            "${NDI_SDK_DIR}/Include"
    )

    # Linux SDK packages may expose an unversioned development symlink
    # (libndi.so) or only a versioned runtime library (for example libndi.so.6).
    find_library(NDI_LIBRARY
        NAMES
            ndi
            libndi.so.6
            libndi.so.5
        HINTS
            "${NDI_SDK_DIR}/lib"
            "${NDI_SDK_DIR}/Lib"
            "${NDI_SDK_DIR}/lib/x86_64-linux-gnu"
            "${NDI_SDK_DIR}/lib/linux"
            "${NDI_SDK_DIR}/lib/linux-x86_64"
    )

    if(NOT NDI_INCLUDE_DIR OR NOT NDI_LIBRARY)
        message(FATAL_ERROR
            "NDI SDK not found. Install the official NDI SDK and configure "
            "-DNDI_SDK_DIR=/path/to/ndi/sdk."
        )
    endif()

    add_executable(veyra
        src/main.cpp
        src/config/config.cpp
        src/control_plane/client.cpp
        src/control_plane/sync.cpp
        src/ndi/discovery.cpp
        src/ndi/receiver.cpp
        src/video/renderer.cpp
    )

    target_include_directories(veyra PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/include"
        "${NDI_INCLUDE_DIR}"
    )
    target_link_libraries(veyra PRIVATE
        PkgConfig::SDL2
        PkgConfig::SDL2_IMAGE
        Threads::Threads
        spdlog::spdlog
        CURL::libcurl
        nlohmann_json::nlohmann_json
        "${NDI_LIBRARY}"
    )

    get_filename_component(NDI_LIBRARY_DIR "${NDI_LIBRARY}" DIRECTORY)
    set_target_properties(veyra PROPERTIES
        BUILD_RPATH "${NDI_LIBRARY_DIR}"
        INSTALL_RPATH "${NDI_LIBRARY_DIR}"
    )

    target_compile_options(veyra PRIVATE
        -Wall
        -Wextra
        -Wpedantic
    )

    install(TARGETS veyra RUNTIME DESTINATION bin)
endif()

if(VEYRA_BUILD_TESTS)
    enable_testing()

    # Compile the SDL renderer independently from the proprietary NDI SDK.
    # This catches renderer/interface regressions in the public CI environment.
    if(NOT TARGET PkgConfig::SDL2)
        find_package(PkgConfig REQUIRED)
        pkg_check_modules(SDL2 REQUIRED IMPORTED_TARGET sdl2)
    endif()

    add_library(veyra_renderer_compile OBJECT
        src/video/renderer.cpp
    )
    target_include_directories(veyra_renderer_compile PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/include"
    )
    target_link_libraries(veyra_renderer_compile PRIVATE PkgConfig::SDL2 PkgConfig::SDL2_IMAGE)
    target_compile_options(veyra_renderer_compile PRIVATE
        -Wall
        -Wextra
        -Wpedantic
    )

    find_package(Threads REQUIRED)
    find_package(CURL REQUIRED)
    find_package(OpenSSL REQUIRED)

    add_library(veyra_control_plane_compile OBJECT
        src/control_plane/client.cpp
        src/control_plane/sync.cpp
    )
    target_include_directories(veyra_control_plane_compile PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/include"
    )
    target_link_libraries(veyra_control_plane_compile PRIVATE
        CURL::libcurl
        Threads::Threads
        nlohmann_json::nlohmann_json
        OpenSSL::Crypto
    )
    target_compile_options(veyra_control_plane_compile PRIVATE
        -Wall
        -Wextra
        -Wpedantic
    )

    add_executable(veyra_control_plane_tests
        src/control_plane/client.cpp
        src/control_plane/sync.cpp
        tests/control_plane_tests.cpp
    )
    target_include_directories(veyra_control_plane_tests PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/include"
    )
    target_link_libraries(veyra_control_plane_tests PRIVATE
        CURL::libcurl
        Threads::Threads
        nlohmann_json::nlohmann_json
        OpenSSL::Crypto
    )
    target_compile_options(veyra_control_plane_tests PRIVATE
        -Wall
        -Wextra
        -Wpedantic
    )
    add_test(NAME veyra_control_plane_tests COMMAND veyra_control_plane_tests)

    add_executable(veyra_config_tests
        src/config/config.cpp
        tests/config_tests.cpp
    )
    target_include_directories(veyra_config_tests PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/include"
    )
    target_link_libraries(veyra_config_tests PRIVATE
        nlohmann_json::nlohmann_json
    )
    target_compile_options(veyra_config_tests PRIVATE
        -Wall
        -Wextra
        -Wpedantic
    )

    add_test(NAME veyra_config_tests COMMAND veyra_config_tests)
endif()
