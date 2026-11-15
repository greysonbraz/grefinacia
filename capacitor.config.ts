import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.com.grefinacia.app',
  appName: 'Grefinacia',
  webDir: 'dist',
  android: {
    backgroundColor: '#0b0f17',
    allowMixedContent: false,
  },
  plugins: {
    // Faz as chamadas fetch() passarem pela camada nativa (sem bloqueio de CORS) — necessário p/ APIs de cotação.
    CapacitorHttp: { enabled: true },
    LocalNotifications: { smallIcon: 'ic_stat_finance', iconColor: '#E4B85C' },
    // Verificação de novos proventos com o app fechado, a cada ~6 h (o Android decide o horário exato).
    // Anúncio de provento não muda de hora em hora; menos consultas poupa bateria e a cota das fontes gratuitas.
    BackgroundRunner: {
      label: 'br.com.grefinacia.proventos',
      src: 'runners/runner.js',
      event: 'checkDividends',
      repeat: true,
      interval: 360,
      autoStart: true,
    },
  },
};

export default config;
