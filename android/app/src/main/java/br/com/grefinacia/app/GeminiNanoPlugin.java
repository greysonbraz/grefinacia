package br.com.grefinacia.app;

import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.genai.common.DownloadCallback;
import com.google.mlkit.genai.common.GenAiException;

/**
 * Ponte entre o app (JavaScript) e o Gemini Nano do aparelho. Só é chamada quando a pessoa liga a opção
 * "IA no aparelho" em Ajustes. A lógica fica em {@link NanoEngine}.
 */
@CapacitorPlugin(name = "GeminiNano")
public class GeminiNanoPlugin extends Plugin {

    private NanoEngine engine;

    private NanoEngine engine() {
        if (engine == null) engine = new NanoEngine();
        return engine;
    }

    private static boolean supported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O;
    }

    @PluginMethod
    public void status(PluginCall call) {
        if (!supported()) {
            JSObject o = new JSObject();
            o.put("status", "indisponivel");
            call.resolve(o);
            return;
        }
        engine().status(new NanoEngine.Result<NanoEngine.Status>() {
            @Override public void ok(NanoEngine.Status s) {
                JSObject o = new JSObject();
                o.put("status", s.status);
                o.put("tokenLimit", s.tokenLimit);
                o.put("systemPrompt", s.systemPrompt);
                call.resolve(o);
            }
            @Override public void fail(String code, String message) { call.reject(message, code); }
        });
    }

    @PluginMethod
    public void download(PluginCall call) {
        if (!supported()) {
            call.reject("Este Android não tem suporte ao Gemini Nano.", "indisponivel");
            return;
        }
        DownloadCallback progress = new DownloadCallback() {
            @Override public void onDownloadProgress(long bytes) {
                JSObject o = new JSObject();
                o.put("bytes", bytes);
                notifyListeners("downloadProgress", o);
            }
            @Override public void onDownloadFailed(GenAiException e) {
                JSObject o = new JSObject();
                o.put("message", e.getMessage());
                notifyListeners("downloadFailed", o);
            }
        };
        engine().download(progress, new NanoEngine.Result<Boolean>() {
            @Override public void ok(Boolean done) {
                JSObject o = new JSObject();
                o.put("done", true);
                call.resolve(o);
            }
            @Override public void fail(String code, String message) { call.reject(message, code); }
        });
    }

    @PluginMethod
    public void generate(PluginCall call) {
        String prompt = call.getString("prompt", "");
        if (prompt == null || prompt.isEmpty()) {
            call.reject("Pergunta vazia.", "vazio");
            return;
        }
        if (!supported()) {
            call.reject("Este Android não tem suporte ao Gemini Nano.", "indisponivel");
            return;
        }
        String system = call.getString("system", "");
        boolean systemSupported = Boolean.TRUE.equals(call.getBoolean("systemPrompt", false));
        Integer max = call.getInt("maxOutputTokens", 400);
        engine().generate(system, prompt, systemSupported, max == null ? 400 : max, new NanoEngine.Result<String>() {
            @Override public void ok(String text) {
                JSObject o = new JSObject();
                o.put("text", text);
                call.resolve(o);
            }
            @Override public void fail(String code, String message) { call.reject(message, code); }
        });
    }
}
