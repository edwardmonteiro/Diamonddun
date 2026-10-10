#!/usr/bin/env sh
# Fetch the pinned llama.cpp used by the native local-LLM engine.
set -e
TAG="${LLAMA_TAG:-b11540}"
DIR="$(cd "$(dirname "$0")" && pwd)/llama.cpp"
if [ -f "$DIR/CMakeLists.txt" ]; then echo "llama.cpp present ($DIR)"; exit 0; fi
git clone --depth 1 --branch "$TAG" https://github.com/ggml-org/llama.cpp "$DIR"
