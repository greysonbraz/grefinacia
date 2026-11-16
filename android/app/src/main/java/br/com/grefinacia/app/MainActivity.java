package br.com.grefinacia.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // plugins do próprio app precisam ser registrados antes de a ponte do Capacitor subir
        registerPlugin(GeminiNanoPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
