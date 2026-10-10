// JNI bridge: com.edwardmonteiro.diamonddash.llm.NativeLlm <-> dd_engine
#include <jni.h>
#include <string>
#include "dd_engine.h"

namespace {
DDStats g_last;

std::string str(JNIEnv * env, jstring s) {
    if (!s) return "";
    const char * c = env->GetStringUTFChars(s, nullptr);
    std::string out(c ? c : "");
    if (c) env->ReleaseStringUTFChars(s, c);
    return out;
}

// Java strings may hold any Unicode: go through UTF-8 bytes, not modified UTF-8.
std::string utf8(JNIEnv * env, jbyteArray a) {
    if (!a) return "";
    jsize n = env->GetArrayLength(a);
    std::string out(n, '\0');
    env->GetByteArrayRegion(a, 0, n, reinterpret_cast<jbyte *>(out.data()));
    return out;
}

jbyteArray bytes(JNIEnv * env, const std::string & s) {
    jbyteArray a = env->NewByteArray((jsize) s.size());
    env->SetByteArrayRegion(a, 0, (jsize) s.size(), reinterpret_cast<const jbyte *>(s.data()));
    return a;
}
}  // namespace

#define FN(name) Java_com_edwardmonteiro_diamonddash_llm_NativeLlm_##name

extern "C" JNIEXPORT jstring JNICALL FN(nativeLoad)(JNIEnv * env, jclass, jstring libDir, jstring model, jint threads, jint nCtx) {
    std::string err = dd_load(str(env, libDir), str(env, model), threads, nCtx);
    return env->NewStringUTF(err.c_str());
}

extern "C" JNIEXPORT jboolean JNICALL FN(nativeLoaded)(JNIEnv *, jclass) { return dd_loaded(); }
extern "C" JNIEXPORT jint JNICALL FN(nativeThreads)(JNIEnv *, jclass) { return dd_threads(); }

extern "C" JNIEXPORT jstring JNICALL FN(nativeSystemInfo)(JNIEnv * env, jclass) {
    return env->NewStringUTF(dd_system_info().c_str());
}

extern "C" JNIEXPORT jint JNICALL FN(nativePrefill)(JNIEnv * env, jclass, jbyteArray prompt) {
    DDStats st;
    int n = dd_prefill(utf8(env, prompt), st);
    g_last = st;
    return n;
}

extern "C" JNIEXPORT jbyteArray JNICALL FN(nativeGenerate)(JNIEnv * env, jclass, jbyteArray prompt, jbyteArray grammar,
                                                           jint maxTokens, jfloat temp, jint seed, jobject sink) {
    jclass cls = env->GetObjectClass(sink);
    jmethodID onPiece = env->GetMethodID(cls, "onPiece", "([B)Z");
    DDStats st;
    std::string out = dd_generate(utf8(env, prompt), utf8(env, grammar), maxTokens, temp, (unsigned) seed,
        [&](const std::string & p) {
            jbyteArray a = bytes(env, p);
            jboolean keep = env->CallBooleanMethod(sink, onPiece, a);
            env->DeleteLocalRef(a);
            if (env->ExceptionCheck()) { env->ExceptionClear(); return false; }
            return (bool) keep;
        }, st);
    g_last = st;
    return bytes(env, out);
}

extern "C" JNIEXPORT jdoubleArray JNICALL FN(nativeLastStats)(JNIEnv * env, jclass) {
    double v[6] = { (double) g_last.prompt_tokens, (double) g_last.cached_tokens, g_last.prompt_ms,
                    (double) g_last.gen_tokens, g_last.gen_ms,
                    g_last.stop == "eog" ? 0.0 : g_last.stop == "length" ? 1.0 : g_last.stop == "cancel" ? 2.0 : 3.0 };
    jdoubleArray a = env->NewDoubleArray(6);
    env->SetDoubleArrayRegion(a, 0, 6, v);
    return a;
}

extern "C" JNIEXPORT void JNICALL FN(nativeFree)(JNIEnv *, jclass) { dd_free(); }
