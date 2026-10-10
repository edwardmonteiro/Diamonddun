#include "dd_engine.h"
#include "llama.h"
#include "ggml-backend.h"

#include <algorithm>
#include <chrono>
#include <mutex>
#include <vector>

namespace {
llama_model * g_model = nullptr;
llama_context * g_ctx = nullptr;
const llama_vocab * g_vocab = nullptr;
std::vector<llama_token> g_cached;   // tokens currently held in the KV cache (seq 0)
int g_threads = 0;
int g_batch = 512;
bool g_backend_ready = false;
std::mutex g_mu;

double now_ms() {
    using namespace std::chrono;
    return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

std::vector<llama_token> tokenize(const std::string & text) {
    int n = -llama_tokenize(g_vocab, text.c_str(), (int) text.size(), nullptr, 0, true, true);
    std::vector<llama_token> out(std::max(n, 0));
    if (n > 0) llama_tokenize(g_vocab, text.c_str(), (int) text.size(), out.data(), n, true, true);
    return out;
}

std::string piece(llama_token t) {
    char buf[256];
    int n = llama_token_to_piece(g_vocab, t, buf, sizeof(buf), 0, false);
    if (n < 0) {
        std::string big(-n, '\0');
        n = llama_token_to_piece(g_vocab, t, big.data(), (int) big.size(), 0, false);
        return big.substr(0, std::max(n, 0));
    }
    return std::string(buf, n);
}

// Length of the longest prefix of s that ends on a UTF-8 character boundary.
size_t utf8_complete(const std::string & s) {
    size_t i = s.size();
    int back = 0;
    while (i > 0 && back < 4) {
        unsigned char c = (unsigned char) s[i - 1];
        if ((c & 0xC0) != 0x80) {
            int need = (c & 0x80) == 0 ? 1 : (c & 0xE0) == 0xC0 ? 2 : (c & 0xF0) == 0xE0 ? 3 : (c & 0xF8) == 0xF0 ? 4 : 1;
            return (back + 1 >= need) ? s.size() : i - 1;
        }
        --i;
        ++back;
    }
    return s.size();
}

// Make the KV cache hold exactly `tokens` (reusing the common prefix). Returns false on error.
bool sync_prompt(const std::vector<llama_token> & tokens, DDStats & st) {
    size_t keep = 0;
    while (keep < g_cached.size() && keep < tokens.size() && g_cached[keep] == tokens[keep]) keep++;
    if (keep == tokens.size() && keep > 0) keep--;  // must decode at least one token to get fresh logits
    llama_memory_t mem = llama_get_memory(g_ctx);
    if (!llama_memory_seq_rm(mem, 0, (llama_pos) keep, -1)) {
        llama_memory_clear(mem, true);
        keep = 0;
    }
    g_cached.resize(keep);
    st.cached_tokens = (int) keep;
    std::vector<llama_token> rest(tokens.begin() + keep, tokens.end());
    for (size_t i = 0; i < rest.size(); i += g_batch) {
        int n = (int) std::min<size_t>(g_batch, rest.size() - i);
        if (llama_decode(g_ctx, llama_batch_get_one(rest.data() + i, n)) != 0) {
            llama_memory_clear(mem, true);
            g_cached.clear();
            return false;
        }
        g_cached.insert(g_cached.end(), rest.begin() + i, rest.begin() + i + n);
    }
    st.prompt_tokens = (int) rest.size();
    return true;
}
}  // namespace

std::string dd_load(const std::string & lib_dir, const std::string & model_path, int n_threads, int n_ctx) {
    std::lock_guard<std::mutex> lock(g_mu);
    if (g_model) return "";
    if (!g_backend_ready) {
        llama_log_set([](ggml_log_level, const char *, void *) {}, nullptr);
        if (!lib_dir.empty()) ggml_backend_load_all_from_path(lib_dir.c_str());
        else ggml_backend_load_all();
        llama_backend_init();
        g_backend_ready = true;
    }
    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0;
    g_model = llama_model_load_from_file(model_path.c_str(), mp);
    if (!g_model) return "não consegui abrir o modelo";
    llama_context_params cp = llama_context_default_params();
    cp.n_ctx = n_ctx;
    cp.n_batch = g_batch;
    cp.n_ubatch = g_batch;
    cp.n_threads = n_threads;
    cp.n_threads_batch = n_threads;
    g_ctx = llama_init_from_model(g_model, cp);
    if (!g_ctx) {
        llama_model_free(g_model);
        g_model = nullptr;
        return "memória insuficiente para o contexto";
    }
    g_vocab = llama_model_get_vocab(g_model);
    g_threads = n_threads;
    g_cached.clear();
    return "";
}

bool dd_loaded() { return g_model && g_ctx; }
int dd_threads() { return g_threads; }

int dd_prefill(const std::string & prompt, DDStats & st) {
    std::lock_guard<std::mutex> lock(g_mu);
    if (!dd_loaded()) return -1;
    double t0 = now_ms();
    bool ok = sync_prompt(tokenize(prompt), st);
    st.prompt_ms = now_ms() - t0;
    return ok ? st.prompt_tokens : -1;
}

std::string dd_generate(const std::string & prompt, const std::string & grammar, int max_tokens,
                        float temperature, unsigned seed,
                        const std::function<bool(const std::string &)> & on_piece, DDStats & st) {
    std::lock_guard<std::mutex> lock(g_mu);
    st = DDStats();
    if (!dd_loaded()) { st.stop = "error"; return ""; }

    double t0 = now_ms();
    std::vector<llama_token> tokens = tokenize(prompt);
    if ((int) tokens.size() + max_tokens + 8 > (int) llama_n_ctx(g_ctx)) {
        st.stop = "error";
        return "";
    }
    if (!sync_prompt(tokens, st)) { st.stop = "error"; return ""; }
    double t1 = now_ms();
    st.prompt_ms = t1 - t0;

    llama_sampler_chain_params sp = llama_sampler_chain_default_params();
    llama_sampler * chain = llama_sampler_chain_init(sp);
    if (!grammar.empty()) {
        llama_sampler * g = llama_sampler_init_grammar(g_vocab, grammar.c_str(), "root");
        if (!g) { llama_sampler_free(chain); st.stop = "error"; return ""; }
        llama_sampler_chain_add(chain, g);
    }
    if (temperature <= 0.f) {
        llama_sampler_chain_add(chain, llama_sampler_init_greedy());
    } else {
        llama_sampler_chain_add(chain, llama_sampler_init_top_k(40));
        llama_sampler_chain_add(chain, llama_sampler_init_top_p(0.92f, 1));
        llama_sampler_chain_add(chain, llama_sampler_init_temp(temperature));
        llama_sampler_chain_add(chain, llama_sampler_init_dist(seed));
    }

    std::string out, pending;
    st.stop = "length";
    for (int i = 0; i < max_tokens; i++) {
        llama_token tok = llama_sampler_sample(chain, g_ctx, -1);
        if (llama_vocab_is_eog(g_vocab, tok)) { st.stop = "eog"; break; }
        std::string p = piece(tok);
        out += p;
        pending += p;
        size_t cut = utf8_complete(pending);
        if (cut > 0) {
            if (!on_piece(pending.substr(0, cut))) { st.stop = "cancel"; st.gen_tokens++; break; }
            pending.erase(0, cut);
        }
        st.gen_tokens++;
        if (llama_decode(g_ctx, llama_batch_get_one(&tok, 1)) != 0) { st.stop = "error"; break; }
        g_cached.push_back(tok);
    }
    if (!pending.empty()) on_piece(pending);
    st.gen_ms = now_ms() - t1;
    llama_sampler_free(chain);
    return out;
}

std::string dd_system_info() { return llama_print_system_info(); }

void dd_free() {
    std::lock_guard<std::mutex> lock(g_mu);
    if (g_ctx) llama_free(g_ctx);
    if (g_model) llama_model_free(g_model);
    g_ctx = nullptr;
    g_model = nullptr;
    g_vocab = nullptr;
    g_cached.clear();
}
