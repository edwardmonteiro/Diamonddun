// usage: dd_test model.gguf grammar.gbnf prompt1.txt [prompt2.txt ...]
#include "dd_engine.h"
#include <cstdio>
#include <fstream>
#include <sstream>
#include <thread>

static std::string slurp(const char * p) { std::ifstream f(p); std::stringstream s; s << f.rdbuf(); return s.str(); }

int main(int argc, char ** argv) {
    if (argc < 4) { fprintf(stderr, "usage: %s model grammar prompt...\n", argv[0]); return 2; }
    int threads = (int) std::thread::hardware_concurrency();
    std::string err = dd_load("", argv[1], threads, 2048);
    if (!err.empty()) { fprintf(stderr, "load error: %s\n", err.c_str()); return 1; }
    fprintf(stderr, "threads=%d\n%s\n", dd_threads(), dd_system_info().c_str());
    std::string grammar = slurp(argv[2]);
    for (int i = 3; i < argc; i++) {
        DDStats st;
        std::string out = dd_generate(slurp(argv[i]), grammar, 380, 0.8f, 1234 + i,
            [](const std::string & p) { fputs(p.c_str(), stderr); return true; }, st);
        printf("\n### %s\nprompt %d tok (+%d cached) %.0f ms | gen %d tok %.0f ms (%.1f tok/s) | stop=%s\n%s\n", argv[i],
               st.prompt_tokens, st.cached_tokens, st.prompt_ms, st.gen_tokens, st.gen_ms,
               st.gen_tokens * 1000.0 / (st.gen_ms > 0 ? st.gen_ms : 1), st.stop.c_str(), out.c_str());
    }
    dd_free();
    return 0;
}
