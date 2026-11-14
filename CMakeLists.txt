cmake_minimum_required(VERSION 3.20)

project(NDIView
    VERSION 0.1.0
    DESCRIPTION "A lightweight Linux NDI video receiver"
    LANGUAGES CXX
)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(DEFINED VEYRA_BUILD_PLAYER AND NOT DEFINED NDIVIEW_BUILD_PLAYER)
    set(NDIVIEW_BUILD_PLAYER "${VEYRA_BUILD_PLAYER}" CACHE BOOL "Build the NDIView video player" FORCE)
endif()
if(DEFINED VEYRA_BUILD_TESTS AND NOT DEFINED NDIVIEW_BUILD_TESTS)
    set(NDIVIEW_BUILD_TESTS "${VEYRA_BUILD_TESTS}" CACHE BOOL "Build NDIView unit tests" FORCE)
endif()
option(NDIVIEW_BUILD_PLAYER "Build the NDIView video player" ON)
option(NDIVIEW_BUILD_TESTS "Build NDIView unit tests" ON)
if(DEFINED VEYRA_BUILD_PLAYER OR DEFINED VEYRA_BUILD_TESTS)
    message(DEPRECATION "VEYRA_BUILD_PLAYER and VEYRA_BUILD_TESTS are deprecated; use NDIVIEW_BUILD_PLAYER and NDIVIEW_BUILD_TESTS.")
endif()

find_package(nlohmann_json CONFIG REQUIRED)

if(NDIVIEW_BUILD_PLAYER)
    find_package(PkgConfig REQUIRED)
    find_package(Threads REQUIRED)
    find_package(CURL REQUIRED)
    find_package(OpenSSL REQUIRED)
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

    # NDI SDK headers have used both p_ndi_name and p_ndi_recv_name for
    # the receiver's advertised name. Detect the installed header instead
    # of assuming one SDK generation's spelling.
    include(CheckCXXSourceCompiles)
    unset(NDIVIEW_NDI_HAS_P_NDI_NAME CACHE)
    unset(NDIVIEW_NDI_HAS_P_NDI_RECV_NAME CACHE)
    set(CMAKE_REQUIRED_INCLUDES "${NDI_INCLUDE_DIR}")
    check_cxx_source_compiles("
        #include <cstddef>
        #include <Processing.NDI.Lib.h>
        int main() {
            NDIlib_recv_create_v3_t settings{};
            settings.p_ndi_name = \"NDIView Receiver\";
            return 0;
        }
    " NDIVIEW_NDI_HAS_P_NDI_NAME)
    if(NOT NDIVIEW_NDI_HAS_P_NDI_NAME)
        check_cxx_source_compiles("
            #include <cstddef>
        #include <Processing.NDI.Lib.h>
            int main() {
                NDIlib_recv_create_v3_t settings{};
                settings.p_ndi_recv_name = \"NDIView Receiver\";
                return 0;
            }
        " NDIVIEW_NDI_HAS_P_NDI_RECV_NAME)
    endif()
    unset(CMAKE_REQUIRED_INCLUDES)
    if(NOT NDIVIEW_NDI_HAS_P_NDI_NAME AND NOT NDIVIEW_NDI_HAS_P_NDI_RECV_NAME)
        message(FATAL_ERROR
            "The installed NDI SDK has an unsupported NDIlib_recv_create_v3_t receiver-name field."
        )
    endif()

    add_executable(ndiview
        src/main.cpp
        src/config/config.cpp
        src/control_plane/client.cpp
        src/control_plane/sync.cpp
        src/ndi/discovery.cpp
        src/ndi/receiver.cpp
        src/video/renderer.cpp
    )

    target_include_directories(ndiview PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/include"
        "${NDI_INCLUDE_DIR}"
    )
    target_link_libraries(ndiview PRIVATE
        PkgConfig::SDL2
        PkgConfig::SDL2_IMAGE
        Threads::Threads
        spdlog::spdlog
        CURL::libcurl
        OpenSSL::Crypto
        nlohmann_json::nlohmann_json
        "${NDI_LIBRARY}"
    )

    get_filename_component(NDI_LIBRARY_DIR "${NDI_LIBRARY}" DIRECTORY)
    set_target_properties(ndiview PROPERTIES
        BUILD_RPATH "${NDI_LIBRARY_DIR}"
        INSTALL_RPATH "${NDI_LIBRARY_DIR}"
    )

    if(NDIVIEW_NDI_HAS_P_NDI_NAME)
        target_compile_definitions(ndiview PRIVATE NDIVIEW_NDI_RECV_NAME_FIELD_P_NDI_NAME)
    else()
        target_compile_definitions(ndiview PRIVATE NDIVIEW_NDI_RECV_NAME_FIELD_P_NDI_RECV_NAME)
    endif()

    target_compile_options(ndiview PRIVATE
        -Wall
        -Wextra
        -Wpedantic
    )

    install(TARGETS ndiview RUNTIME DESTINATION bin)
endif()

if(NDIVIEW_BUILD_TESTS)
    enable_testing()

    # Compile the SDL renderer independently from the proprietary NDI SDK.
    # This catches renderer/interface regressions in the public CI environment.
    if(NOT TARGET PkgConfig::SDL2)
        find_package(PkgConfig REQUIRED)
        pkg_check_modules(SDL2 REQUIRED IMPORTED_TARGET sdl2)
    endif()
    if(NOT TARGET PkgConfig::SDL2_IMAGE)
        pkg_check_modules(SDL2_IMAGE REQUIRED IMPORTED_TARGET SDL2_image)
    endif()

    add_library(ndiview_renderer_compile OBJECT
        src/video/renderer.cpp
    )
    target_include_directories(ndiview_renderer_compile PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/include"
    )
    target_link_libraries(ndiview_renderer_compile PRIVATE PkgConfig::SDL2 PkgConfig::SDL2_IMAGE)
    target_compile_options(ndiview_renderer_compile PRIVATE
        -Wall
        -Wextra
        -Wpedantic
    )

    find_package(Threads REQUIRED)
    find_package(CURL REQUIRED)
    find_package(OpenSSL REQUIRED)

    add_library(ndiview_control_plane_compile OBJECT
        src/control_plane/client.cpp
        src/control_plane/sync.cpp
    )
    target_include_directories(ndiview_control_plane_compile PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/include"
    )
    target_link_libraries(ndiview_control_plane_compile PRIVATE
        CURL::libcurl
        Threads::Threads
        nlohmann_json::nlohmann_json
        OpenSSL::Crypto
    )
    target_compile_options(ndiview_control_plane_compile PRIVATE
        -Wall
        -Wextra
        -Wpedantic
    )

    add_executable(ndiview_control_plane_tests
        src/control_plane/client.cpp
        src/control_plane/sync.cpp
        tests/control_plane_tests.cpp
    )
    target_include_directories(ndiview_control_plane_tests PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/include"
    )
    target_link_libraries(ndiview_control_plane_tests PRIVATE
        CURL::libcurl
        Threads::Threads
        nlohmann_json::nlohmann_json
        OpenSSL::Crypto
    )
    target_compile_options(ndiview_control_plane_tests PRIVATE
        -Wall
        -Wextra
        -Wpedantic
    )
    add_test(NAME ndiview_control_plane_tests COMMAND ndiview_control_plane_tests)

    add_executable(ndiview_config_tests
        src/config/config.cpp
        tests/config_tests.cpp
    )
    target_include_directories(ndiview_config_tests PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/include"
    )
    target_link_libraries(ndiview_config_tests PRIVATE
        nlohmann_json::nlohmann_json
    )
    target_compile_options(ndiview_config_tests PRIVATE
        -Wall
        -Wextra
        -Wpedantic
    )

    add_test(NAME ndiview_config_tests COMMAND ndiview_config_tests)
endif()
