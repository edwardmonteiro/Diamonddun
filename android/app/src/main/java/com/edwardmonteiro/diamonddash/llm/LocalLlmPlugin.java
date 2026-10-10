package com.edwardmonteiro.diamonddash.llm;

import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * "LocalLlm" — downloads a GGUF model once and runs it on the phone's CPU with
 * llama.cpp (multi-threaded, ARM dot-product kernels). Used by the AI phase studio.
 */
@CapacitorPlugin(name = "LocalLlm")
public class LocalLlmPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService net = Executors.newSingleThreadExecutor();
    private final AtomicBoolean cancelGen = new AtomicBoolean(false);
    private final AtomicBoolean cancelDl = new AtomicBoolean(false);
    private volatile boolean downloading = false;

    private File modelsDir() {
        File d = new File(getContext().getFilesDir(), "models");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private File modelFile(String name) {
        return new File(modelsDir(), name.replaceAll("[^A-Za-z0-9._-]", "_"));
    }

    private int pickThreads() {
        int cores = Runtime.getRuntime().availableProcessors();
        // big.LITTLE phones: the big + prime cores do the work; little cores only add contention
        return Math.max(2, Math.min(6, cores >= 8 ? cores / 2 : cores - 1));
    }

    @PluginMethod
    public void info(PluginCall call) {
        String name = call.getString("file", "");
        JSObject r = new JSObject();
        r.put("native", NativeLlm.isAvailable());
        r.put("abi", Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "");
        r.put("cores", Runtime.getRuntime().availableProcessors());
        if (!NativeLlm.isAvailable()) r.put("error", NativeLlm.loadError());
        File f = name.isEmpty() ? null : modelFile(name);
        r.put("downloaded", f != null && f.exists());
        r.put("bytes", f != null && f.exists() ? f.length() : 0);
        File part = name.isEmpty() ? null : new File(f.getPath() + ".part");
        r.put("partial", part != null && part.exists() ? part.length() : 0);
        r.put("downloading", downloading);
        r.put("loaded", NativeLlm.isAvailable() && NativeLlm.nativeLoaded());
        r.put("threads", NativeLlm.isAvailable() ? NativeLlm.nativeThreads() : 0);
        call.resolve(r);
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String name = call.getString("file");
        long expected = call.getLong("bytes", 0L);
        if (url == null || name == null) { call.reject("url/file obrigatórios"); return; }
        if (downloading) { call.reject("download já em andamento"); return; }
        downloading = true;
        cancelDl.set(false);
        net.execute(() -> {
            File dst = modelFile(name);
            File part = new File(dst.getPath() + ".part");
            try {
                String current = url;
                HttpURLConnection c = null;
                long have = part.exists() ? part.length() : 0;
                for (int hop = 0; hop < 6; hop++) {
                    c = (HttpURLConnection) new URL(current).openConnection();
                    c.setInstanceFollowRedirects(false);
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(30000);
                    c.setRequestProperty("User-Agent", "DiamondDash/1.0 (Android)");
                    if (have > 0) c.setRequestProperty("Range", "bytes=" + have + "-");
                    int code = c.getResponseCode();
                    if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                        current = new URL(new URL(current), c.getHeaderField("Location")).toString();
                        c.disconnect();
                        continue;
                    }
                    break;
                }
                int code = c.getResponseCode();
                if (code == 416 && expected > 0 && have == expected) {
                    // already complete
                } else if (code != 200 && code != 206) {
                    throw new RuntimeException("HTTP " + code);
                }
                boolean append = code == 206;
                if (!append) have = 0;
                long len = c.getContentLengthLong();
                long total = len > 0 ? have + len : expected;
                byte[] buf = new byte[1 << 16];
                long lastEmit = 0;
                if (code != 416) {
                    try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(part, append)) {
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            if (cancelDl.get()) throw new RuntimeException("cancelado");
                            out.write(buf, 0, n);
                            have += n;
                            long now = System.currentTimeMillis();
                            if (now - lastEmit > 250) {
                                lastEmit = now;
                                JSObject p = new JSObject();
                                p.put("loaded", have);
                                p.put("total", total);
                                notifyListeners("progress", p);
                            }
                        }
                    }
                }
                c.disconnect();
                if (expected > 0 && part.length() != expected) throw new RuntimeException("arquivo incompleto (" + part.length() + "/" + expected + ")");
                if (dst.exists()) dst.delete();
                if (!part.renameTo(dst)) throw new RuntimeException("não consegui salvar o modelo");
                verifyGguf(dst);
                JSObject r = new JSObject();
                r.put("bytes", dst.length());
                call.resolve(r);
            } catch (Throwable t) {
                call.reject(String.valueOf(t.getMessage()));
            } finally {
                downloading = false;
            }
        });
    }

    private static void verifyGguf(File f) throws Exception {
        try (RandomAccessFile r = new RandomAccessFile(f, "r")) {
            byte[] magic = new byte[4];
            r.readFully(magic);
            if (!"GGUF".equals(new String(magic, StandardCharsets.US_ASCII))) {
                f.delete();
                throw new RuntimeException("arquivo baixado não é um modelo GGUF");
            }
        }
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        cancelDl.set(true);
        call.resolve();
    }

    @PluginMethod
    public void load(PluginCall call) {
        String name = call.getString("file", "");
        int ctx = call.getInt("ctx", 2048);
        if (!NativeLlm.isAvailable()) { call.reject("motor nativo indisponível: " + NativeLlm.loadError()); return; }
        File f = modelFile(name);
        if (!f.exists()) { call.reject("modelo não baixado"); return; }
        worker.execute(() -> {
            try {
                long t0 = System.currentTimeMillis();
                int threads = call.getInt("threads", pickThreads());
                String libDir = getContext().getApplicationInfo().nativeLibraryDir;
                String err = NativeLlm.nativeLoad(libDir, f.getAbsolutePath(), threads, ctx);
                if (err != null && !err.isEmpty()) { call.reject(err); return; }
                JSObject r = new JSObject();
                r.put("ms", System.currentTimeMillis() - t0);
                r.put("threads", NativeLlm.nativeThreads());
                r.put("system", NativeLlm.nativeSystemInfo());
                call.resolve(r);
            } catch (Throwable t) {
                call.reject(String.valueOf(t.getMessage()));
            }
        });
    }

    @PluginMethod
    public void prefill(PluginCall call) {
        String prompt = call.getString("prompt", "");
        worker.execute(() -> {
            try {
                if (!NativeLlm.nativeLoaded()) { call.reject("modelo não carregado"); return; }
                int n = NativeLlm.nativePrefill(prompt.getBytes(StandardCharsets.UTF_8));
                double[] s = NativeLlm.nativeLastStats();
                JSObject r = new JSObject();
                r.put("tokens", n);
                r.put("ms", s[2]);
                call.resolve(r);
            } catch (Throwable t) {
                call.reject(String.valueOf(t.getMessage()));
            }
        });
    }

    @PluginMethod
    public void generate(PluginCall call) {
        String prompt = call.getString("prompt", "");
        String grammar = call.getString("grammar", "");
        int maxTokens = call.getInt("maxTokens", 384);
        float temp = call.getFloat("temperature", 0.8f);
        int seed = call.getInt("seed", (int) (System.nanoTime() & 0x7fffffff));
        cancelGen.set(false);
        worker.execute(() -> {
            try {
                if (!NativeLlm.nativeLoaded()) { call.reject("modelo não carregado"); return; }
                byte[] out = NativeLlm.nativeGenerate(prompt.getBytes(StandardCharsets.UTF_8), grammar.getBytes(StandardCharsets.UTF_8),
                    maxTokens, temp, seed, utf8 -> {
                        JSObject p = new JSObject();
                        p.put("text", new String(utf8, StandardCharsets.UTF_8));
                        notifyListeners("token", p);
                        return !cancelGen.get();
                    });
                double[] s = NativeLlm.nativeLastStats();
                String[] stops = { "eog", "length", "cancel", "error" };
                JSObject r = new JSObject();
                r.put("text", new String(out, StandardCharsets.UTF_8));
                r.put("promptTokens", (int) s[0]);
                r.put("cachedTokens", (int) s[1]);
                r.put("promptMs", s[2]);
                r.put("genTokens", (int) s[3]);
                r.put("genMs", s[4]);
                r.put("stop", stops[Math.max(0, Math.min(3, (int) s[5]))]);
                call.resolve(r);
            } catch (Throwable t) {
                call.reject(String.valueOf(t.getMessage()));
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cancelGen.set(true);
        call.resolve();
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String name = call.getString("file", "");
        worker.execute(() -> {
            try {
                if (NativeLlm.isAvailable()) NativeLlm.nativeFree();
                File f = modelFile(name);
                if (f.exists()) f.delete();
                File part = new File(f.getPath() + ".part");
                if (part.exists()) part.delete();
                call.resolve();
            } catch (Throwable t) {
                call.reject(String.valueOf(t.getMessage()));
            }
        });
    }
}
