package br.com.grefinacia.app;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.genai.common.DownloadCallback;
import com.google.mlkit.genai.common.FeatureStatus;
import com.google.mlkit.genai.common.GenAiException;
import com.google.mlkit.genai.prompt.Candidate;
import com.google.mlkit.genai.prompt.Feature;
import com.google.mlkit.genai.prompt.GenerateContentRequest;
import com.google.mlkit.genai.prompt.GenerateContentResponse;
import com.google.mlkit.genai.prompt.Generation;
import com.google.mlkit.genai.prompt.SystemInstruction;
import com.google.mlkit.genai.prompt.TextPart;
import com.google.mlkit.genai.prompt.java.GenerativeModelFutures;

import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/**
 * Conversa com o Gemini Nano do próprio aparelho (ML Kit GenAI, "direct model access").
 * Tudo roda no celular, pelo serviço AICore do Android: o texto da pergunta e dos dados não vai para a internet.
 * O ML Kit envia ao Google apenas métricas de uso (aparelho, tamanhos, erros), como informado ao usuário no app.
 *
 * Classe sem dependência do Capacitor, para poder ser compilada e conferida fora do Android Studio.
 */
public final class NanoEngine {

    public interface Result<T> {
        void ok(T value);
        void fail(String code, String message);
    }

    /** Estado do modelo no aparelho. */
    public static final class Status {
        public final String status; // disponivel | baixar | baixando | indisponivel
        public final int tokenLimit;
        public final boolean systemPrompt;

        Status(String status, int tokenLimit, boolean systemPrompt) {
            this.status = status;
            this.tokenLimit = tokenLimit;
            this.systemPrompt = systemPrompt;
        }
    }

    private final Executor executor = Executors.newSingleThreadExecutor();
    private GenerativeModelFutures model;

    private synchronized GenerativeModelFutures model() {
        if (model == null) model = GenerativeModelFutures.from(Generation.INSTANCE.getClient());
        return model;
    }

    private static String describe(Throwable t) {
        Throwable c = t;
        while (c.getCause() != null && !(c instanceof GenAiException)) c = c.getCause();
        if (c instanceof GenAiException) {
            GenAiException g = (GenAiException) c;
            return "Gemini Nano: erro " + g.getErrorCode() + (g.getMessage() != null ? " (" + g.getMessage() + ")" : "");
        }
        return "Gemini Nano: " + (c.getMessage() != null ? c.getMessage() : c.getClass().getSimpleName());
    }

    private <T> void await(ListenableFuture<T> f, Result<T> r) {
        f.addListener(() -> {
            try {
                r.ok(f.get());
            } catch (Throwable t) {
                r.fail("erro", describe(t));
            }
        }, executor);
    }

    /** Confere se o aparelho tem o Gemini Nano, se precisa baixar, e os limites do modelo. */
    public void status(Result<Status> r) {
        final GenerativeModelFutures m;
        try {
            m = model();
        } catch (Throwable t) {
            r.ok(new Status("indisponivel", 0, false));
            return;
        }
        await(m.checkStatus(), new Result<Integer>() {
            @Override public void ok(Integer s) {
                int v = s == null ? FeatureStatus.UNAVAILABLE : s;
                if (v != FeatureStatus.AVAILABLE) {
                    String name = v == FeatureStatus.DOWNLOADABLE ? "baixar" : v == FeatureStatus.DOWNLOADING ? "baixando" : "indisponivel";
                    r.ok(new Status(name, 0, false));
                    return;
                }
                await(m.getTokenLimit(), new Result<Integer>() {
                    @Override public void ok(Integer limit) {
                        await(m.getAvailableFeatures(), new Result<List<Integer>>() {
                            @Override public void ok(List<Integer> f) { r.ok(new Status("disponivel", limit == null ? 0 : limit, f != null && f.contains(Feature.SYSTEM_PROMPT))); }
                            @Override public void fail(String code, String message) { r.ok(new Status("disponivel", limit == null ? 0 : limit, false)); }
                        });
                    }
                    @Override public void fail(String code, String message) { r.ok(new Status("disponivel", 0, false)); }
                });
            }
            @Override public void fail(String code, String message) { r.ok(new Status("indisponivel", 0, false)); }
        });
    }

    /** Baixa o modelo (o Android faz o download; pode levar alguns minutos, de preferência no Wi-Fi). */
    public void download(DownloadCallback progress, Result<Boolean> r) {
        try {
            await(model().download(progress), new Result<Void>() {
                @Override public void ok(Void v) { r.ok(true); }
                @Override public void fail(String code, String message) { r.fail(code, message); }
            });
        } catch (Throwable t) {
            r.fail("erro", describe(t));
        }
    }

    /**
     * Gera uma resposta. As instruções de sistema vão separadas quando o modelo aceita; senão, vão antes da pergunta.
     * Temperatura baixa: respostas mais previsíveis, menos invenção.
     */
    public void generate(String system, String prompt, boolean systemSupported, int maxOutputTokens, Result<String> r) {
        try {
            GenerateContentRequest.Builder b = systemSupported && system != null && !system.isEmpty()
                ? new GenerateContentRequest.Builder(new SystemInstruction(system), new TextPart(prompt))
                : new GenerateContentRequest.Builder(new TextPart(system == null || system.isEmpty() ? prompt : system + "\n\n" + prompt));
            b.setTemperature(0.2f);
            b.setTopK(16);
            b.setCandidateCount(1);
            if (maxOutputTokens > 0) b.setMaxOutputTokens(maxOutputTokens);
            await(model().generateContent(b.build()), new Result<GenerateContentResponse>() {
                @Override public void ok(GenerateContentResponse res) {
                    List<Candidate> c = res == null ? null : res.getCandidates();
                    String text = c == null || c.isEmpty() ? null : c.get(0).getText();
                    if (text == null || text.trim().isEmpty()) r.fail("vazio", "Gemini Nano não devolveu resposta.");
                    else r.ok(text.trim());
                }
                @Override public void fail(String code, String message) { r.fail(code, message); }
            });
        } catch (Throwable t) {
            r.fail("erro", describe(t));
        }
    }
}
