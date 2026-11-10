# CosmicShore.scr: a thin Win32 + WebView2 host around the single-file web bundle.
# Build (host/windows/build.ps1 does all of this):
#   cmake -S host/windows -B build/scr -A x64 -DINDEX_HTML=<dist-single/screensaver-host.html> -DWEBVIEW2_DIR=<extracted nupkg> -DSCR_VERSION=0.1.0
#   cmake --build build/scr --config Release
cmake_minimum_required(VERSION 3.20)
project(CosmicShoreScr LANGUAGES CXX RC)

set(SCR_VERSION "0.0.0" CACHE STRING "Version stamped into the .scr (x.y.z)")
set(INDEX_HTML "" CACHE FILEPATH "The single-file page to embed (npm run build:host)")
set(WEBVIEW2_DIR "" CACHE PATH "The extracted Microsoft.Web.WebView2 NuGet package")

if(NOT EXISTS "${INDEX_HTML}")
  message(FATAL_ERROR "INDEX_HTML not found: '${INDEX_HTML}'. Run `npm run build:host` first.")
endif()
if(NOT EXISTS "${WEBVIEW2_DIR}/build/native/include/WebView2.h")
  message(FATAL_ERROR "WEBVIEW2_DIR does not hold the WebView2 SDK: '${WEBVIEW2_DIR}'")
endif()
if(NOT SCR_VERSION MATCHES "^([0-9]+)\\.([0-9]+)\\.([0-9]+)")
  message(FATAL_ERROR "SCR_VERSION must look like 1.2.3, got '${SCR_VERSION}'")
endif()
set(SCR_VERSION_COMMAS "${CMAKE_MATCH_1},${CMAKE_MATCH_2},${CMAKE_MATCH_3},0")
file(TO_CMAKE_PATH "${INDEX_HTML}" INDEX_HTML)
file(TO_CMAKE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/src/scr.manifest" SCR_MANIFEST)
configure_file(src/scr.rc.in "${CMAKE_CURRENT_BINARY_DIR}/scr.rc" @ONLY)
# Re-embed when the page changes.
set_property(SOURCE "${CMAKE_CURRENT_BINARY_DIR}/scr.rc" APPEND PROPERTY OBJECT_DEPENDS "${INDEX_HTML}" "${SCR_MANIFEST}")

add_executable(CosmicShore WIN32 src/main.cpp "${CMAKE_CURRENT_BINARY_DIR}/scr.rc")
set_target_properties(CosmicShore PROPERTIES SUFFIX ".scr" CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
target_include_directories(CosmicShore PRIVATE src "${WEBVIEW2_DIR}/build/native/include")
target_compile_definitions(CosmicShore PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX
                           SCR_VERSION_W=L"${SCR_VERSION}")
target_link_libraries(CosmicShore PRIVATE user32 gdi32 ole32 shell32 shlwapi comctl32 advapi32 version uuid)

if(MSVC)
  # One self-contained file: the static CRT and the static WebView2 loader, so nothing ships beside it.
  set_property(TARGET CosmicShore PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded")
  target_compile_options(CosmicShore PRIVATE /W4 /utf-8 /permissive-)
  target_link_options(CosmicShore PRIVATE /MANIFEST:NO)
  target_link_libraries(CosmicShore PRIVATE "${WEBVIEW2_DIR}/build/native/x64/WebView2LoaderStatic.lib")
else()
  # MinGW: a compile-and-link check only (it needs WebView2Loader.dll beside it, so it is never shipped).
  target_include_directories(CosmicShore PRIVATE mingw)
  target_compile_options(CosmicShore PRIVATE -Wall -Wextra -Wno-unknown-pragmas)
  target_link_options(CosmicShore PRIVATE -static -municode)
  target_link_libraries(CosmicShore PRIVATE "${WEBVIEW2_DIR}/build/native/x64/WebView2Loader.dll.lib")
endif()
