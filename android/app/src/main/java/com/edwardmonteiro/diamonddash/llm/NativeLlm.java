package com.edwardmonteiro.diamonddash.llm;

/** Thin JNI facade over dd_engine (llama.cpp). All calls must run on one worker thread. */
public final class NativeLlm {
    public interface TokenSink {
        boolean onPiece(byte[] utf8);
    }

    private static boolean available;
    private static String loadError = "";

    static {
        try {
            System.loadLibrary("ddllm");
            available = true;
        } catch (Throwable t) {
            available = false;
            loadError = String.valueOf(t.getMessage());
        }
    }

    private NativeLlm() {}

    public static boolean isAvailable() { return available; }
    public static String loadError() { return loadError; }

    public static native String nativeLoad(String libDir, String modelPath, int threads, int nCtx);
    public static native boolean nativeLoaded();
    public static native int nativeThreads();
    public static native String nativeSystemInfo();
    public static native int nativePrefill(byte[] prompt);
    public static native byte[] nativeGenerate(byte[] prompt, byte[] grammar, int maxTokens, float temp, int seed, TokenSink sink);
    public static native double[] nativeLastStats();
    public static native void nativeFree();
}
