package br.com.grefinacia.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/**
 * Widget da tela inicial: quanto ainda dá para gastar no mês, saldo disponível e a próxima conta.
 * Os valores vêm do app (GrefinaciaPlugin.setWidget) sempre que ele abre ou os dados mudam; com "ocultar valores"
 * ligado no app, o widget mostra "•••". Tocar abre o app (que pode pedir PIN/biometria).
 */
public class GrefinaciaWidget extends AppWidgetProvider {
    static final String PREFS = "grefinacia_widget";

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        updateAll(context, mgr, ids);
    }

    static void updateAll(Context context, AppWidgetManager mgr, int[] ids) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        for (int id : ids) {
            RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_grefinacia);
            v.setTextViewText(R.id.w_free_label, p.getString("freeLabel", "Livre para gastar"));
            v.setTextViewText(R.id.w_free, p.getString("free", "Abra o app"));
            v.setTextViewText(R.id.w_balance, p.getString("balance", ""));
            v.setTextViewText(R.id.w_next, p.getString("next", ""));
            v.setTextViewText(R.id.w_updated, p.getString("updated", ""));
            v.setOnClickPendingIntent(R.id.w_root, pi);
            mgr.updateAppWidget(id, v);
        }
    }
}
