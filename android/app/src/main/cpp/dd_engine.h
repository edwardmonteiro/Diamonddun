// Diamond Dash — tiny on-device LLM engine over llama.cpp (no JNI here, so it
// can be unit-tested on a desktop). One model, one context, one sequence.
#pragma once
#include <functional>
#include <string>

struct DDStats {
    int prompt_tokens = 0;      // tokens actually decoded for the prompt
    int cached_tokens = 0;      // prompt tokens reused from the KV cache
    int gen_tokens = 0;
    double prompt_ms = 0;
    double gen_ms = 0;
    std::string stop;           // "eog" | "length" | "cancel" | "error"
};

// Loads backends (from lib_dir, may be empty) and the model. Returns "" or an error.
std::string dd_load(const std::string & lib_dir, const std::string & model_path, int n_threads, int n_ctx);
bool dd_loaded();
// Generates text for a ChatML prompt, constrained by a GBNF grammar (may be empty).
// on_piece receives complete UTF-8 chunks; return false to cancel.
std::string dd_generate(const std::string & prompt, const std::string & grammar, int max_tokens,
                        float temperature, unsigned seed,
                        const std::function<bool(const std::string &)> & on_piece, DDStats & stats);
// Pre-fills the KV cache with a prompt prefix (no sampling).
int dd_prefill(const std::string & prompt, DDStats & stats);
std::string dd_system_info();
int dd_threads();
void dd_free();
