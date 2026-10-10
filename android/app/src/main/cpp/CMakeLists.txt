# Native local LLM for "Fases com IA": llama.cpp + a tiny engine (dd_engine.cpp).
# llama.cpp is fetched by CI into android/native/llama.cpp at a pinned tag.
cmake_minimum_required(VERSION 3.22.1)
project(ddllm C CXX)
set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(LLAMA_DIR "${CMAKE_CURRENT_LIST_DIR}/../../../../native/llama.cpp")
if (NOT EXISTS "${LLAMA_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "llama.cpp not found at ${LLAMA_DIR} (run android/native/fetch-llama.sh)")
endif()

if (ANDROID_ABI STREQUAL "arm64-v8a")
    set(GGML_SYSTEM_ARCH "ARM")
endif()

add_subdirectory(${LLAMA_DIR} llama-build)

add_library(ddllm SHARED dd_engine.cpp dd_jni.cpp)
target_include_directories(ddllm PRIVATE ${LLAMA_DIR}/include ${LLAMA_DIR}/ggml/include)
target_link_libraries(ddllm llama ggml android log)
