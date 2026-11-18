import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNative } from './platform';

/**
 * Retorno tátil curto (Android), só onde confirma uma ação: trocar de aba, salvar, erro.
 * Desligado no navegador e quando o aparelho não tem vibração (falha silenciosa).
 */
const reduce = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export function tap(): void {
  if (!isNative() || reduce()) return;
  void Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
}
export function notify(kind: 'ok' | 'err'): void {
  if (!isNative()) return;
  void Haptics.notification({ type: kind === 'ok' ? NotificationType.Success : NotificationType.Error }).catch(() => undefined);
}
