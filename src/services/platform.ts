import { Capacitor } from '@capacitor/core';

export const isNative = (): boolean => Capacitor.isNativePlatform();
export const isAndroid = (): boolean => Capacitor.getPlatform() === 'android';

/**
 * No Android a ponte com os recursos nativos (notificações, biometria, arquivos) é injetada pelo sistema antes
 * de o app carregar. Se o componente "Android System WebView" for antigo demais ela não chega, e o app ficaria
 * funcionando pela metade sem avisar. Aqui detectamos esse caso para mostrar uma orientação clara.
 */
export function nativeBridgeMissing(win: { androidBridge?: unknown; Capacitor?: { PluginHeaders?: unknown } } = window as never): boolean {
  return win.androidBridge !== undefined && !Array.isArray(win.Capacitor?.PluginHeaders);
}
