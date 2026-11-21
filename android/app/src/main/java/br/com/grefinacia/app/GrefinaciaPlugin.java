package br.com.grefinacia.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.speech.RecognizerIntent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.annotation.ActivityCallback;
import java.util.ArrayList;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

/**
 * Recursos nativos do Grefinacia:
 * - recognizeText: lê o texto de uma foto (cupom/nota) com o ML Kit, no próprio aparelho (modelo do Google Play Services, sem internet na leitura).
 * - scanQr: lê um QR code (nota fiscal) com o leitor do Google, sem permissão de câmera no app.
 * - listen: abre o reconhecimento de voz do próprio Android (pt-BR) e devolve o texto falado.
 * - setWidget: guarda os valores do widget da tela inicial e pede para redesenhá-lo.
 */
@CapacitorPlugin(name = "Grefinacia")
public class GrefinaciaPlugin extends Plugin {

    @PluginMethod
    public void recognizeText(PluginCall call) {
        String b64 = call.getString("base64");
        if (b64 == null || b64.isEmpty()) {
            call.reject("Foto vazia.", "vazio");
            return;
        }
        Bitmap bmp;
        try {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (IllegalArgumentException e) {
            call.reject("Foto inválida.", "invalida");
            return;
        }
        if (bmp == null) {
            call.reject("Não foi possível abrir a foto.", "invalida");
            return;
        }
        TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        recognizer.process(InputImage.fromBitmap(bmp, 0))
            .addOnSuccessListener(result -> {
                JSObject o = new JSObject();
                o.put("text", result.getText());
                call.resolve(o);
                recognizer.close();
            })
            .addOnFailureListener(e -> {
                String m = e.getMessage() == null ? "" : e.getMessage().toLowerCase();
                if (m.contains("download") || m.contains("unavailable") || m.contains("module")) {
                    call.reject("O leitor de texto ainda está sendo baixado pelo Google Play. Deixe o celular na internet e tente de novo em alguns minutos.", "baixando", e);
                } else {
                    call.reject("Não foi possível ler o texto da foto.", "leitura", e);
                }
                recognizer.close();
            });
    }

    /** QR code pelo leitor do Google (Play Services): a câmera abre numa tela do Google; o app não precisa de permissão. */
    @PluginMethod
    public void scanQr(PluginCall call) {
        GmsBarcodeScannerOptions opts = new GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build();
        GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(getActivity(), opts);
        scanner.startScan()
            .addOnSuccessListener(b -> {
                JSObject o = new JSObject();
                o.put("text", b.getRawValue() == null ? "" : b.getRawValue());
                call.resolve(o);
            })
            .addOnCanceledListener(() -> {
                JSObject o = new JSObject();
                o.put("text", "");
                call.resolve(o);
            })
            .addOnFailureListener(e -> call.reject("Não foi possível abrir o leitor de QR code. Confira se o Google Play Services está atualizado.", "qr", e));
    }

    @PluginMethod
    public void listen(PluginCall call) {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR");
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Pergunte à Grefinacia AI");
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("Este aparelho não tem reconhecimento de voz.", "sem-voz");
            return;
        }
        startActivityForResult(call, intent, "onSpeech");
    }

    @ActivityCallback
    private void onSpeech(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        ArrayList<String> said = data == null ? null : data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        JSObject o = new JSObject();
        o.put("text", said == null || said.isEmpty() ? "" : said.get(0));
        call.resolve(o);
    }

    @PluginMethod
    public void setWidget(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences.Editor ed = ctx.getSharedPreferences(GrefinaciaWidget.PREFS, Context.MODE_PRIVATE).edit();
        ed.putString("free", call.getString("free", "—"));
        ed.putString("freeLabel", call.getString("freeLabel", "Livre para gastar"));
        ed.putString("balance", call.getString("balance", "—"));
        ed.putString("next", call.getString("next", ""));
        ed.putString("updated", call.getString("updated", ""));
        ed.apply();
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, GrefinaciaWidget.class));
        GrefinaciaWidget.updateAll(ctx, mgr, ids);
        call.resolve();
    }
}
