import { registerPlugin } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { isNative } from './platform';
import { parseReceipt, type ReceiptGuess } from '../domain/receipt';

/** Plugin nativo do app (android/app/src/main/java/.../GrefinaciaPlugin.java). */
interface GrefinaciaPlugin {
  recognizeText(o: { base64: string }): Promise<{ text: string }>;
  listen(): Promise<{ text: string }>;
  scanQr(): Promise<{ text: string }>;
  setWidget(o: { free: string; freeLabel: string; balance: string; next: string; updated: string }): Promise<void>;
}
const Native = registerPlugin<GrefinaciaPlugin>('Grefinacia');

export class ScanError extends Error {}

/**
 * Fotografa (ou escolhe da galeria) um cupom/nota e lê no próprio aparelho: loja, total e data.
 * Nada sai do celular. Devolve null se você cancelar.
 */
export async function scanReceipt(today: string): Promise<(ReceiptGuess & { text: string }) | null> {
  if (!isNative()) throw new ScanError('A leitura de cupom funciona no app Android.');
  let photo;
  try {
    photo = await Camera.getPhoto({ resultType: CameraResultType.Base64, source: CameraSource.Prompt, quality: 70, width: 1600, correctOrientation: true, promptLabelHeader: 'Cupom ou nota', promptLabelPhoto: 'Escolher da galeria', promptLabelPicture: 'Tirar foto', promptLabelCancel: 'Cancelar' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(msg)) return null;
    throw new ScanError(/permission|denied/i.test(msg) ? 'Sem permissão para a câmera. Libere em Configurações do Android → Apps → Grefinacia → Permissões.' : 'Não foi possível abrir a câmera.');
  }
  if (!photo.base64String) return null;
  const { text } = await Native.recognizeText({ base64: photo.base64String });
  return { ...parseReceipt(text ?? '', today), text: text ?? '' };
}

let lastWidget = '';
/** Atualiza o widget da tela inicial (só no Android; só quando algo mudou). */
export function pushWidget(v: { free: string; freeLabel: string; balance: string; next: string; updated: string }): void {
  if (!isNative()) return;
  const key = JSON.stringify({ ...v, updated: '' });
  if (key === lastWidget) return;
  lastWidget = key;
  void Native.setWidget(v).catch(() => undefined);
}

/** Ouve uma pergunta pelo reconhecimento de voz do Android (pt-BR). Devolve '' se você não falou nada. */
export async function listen(): Promise<string> {
  if (!isNative()) throw new ScanError('Falar com a AI funciona no app Android.');
  try {
    const { text } = await Native.listen();
    return (text ?? '').trim();
  } catch (e) {
    throw new ScanError(e instanceof Error && e.message ? e.message : 'Não foi possível ouvir agora.');
  }
}

/**
 * Foto ou print (câmera ou galeria) → texto lido no aparelho pelo ML Kit. Nada sai do celular.
 * Devolve null se você cancelar.
 */
export async function photoText(header = 'Foto ou print'): Promise<string | null> {
  if (!isNative()) throw new ScanError('Ler fotos funciona no app Android.');
  let photo;
  try {
    photo = await Camera.getPhoto({ resultType: CameraResultType.Base64, source: CameraSource.Prompt, quality: 80, width: 2000, correctOrientation: true, promptLabelHeader: header, promptLabelPhoto: 'Escolher da galeria (prints)', promptLabelPicture: 'Tirar foto', promptLabelCancel: 'Cancelar' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(msg)) return null;
    throw new ScanError(/permission|denied/i.test(msg) ? 'Sem permissão para a câmera ou fotos. Libere em Configurações do Android → Apps → Grefinacia → Permissões.' : 'Não foi possível abrir a foto.');
  }
  if (!photo.base64String) return null;
  const { text } = await Native.recognizeText({ base64: photo.base64String });
  return text ?? '';
}

/** Lê um QR code com o leitor do Google (Play Services): abre a câmera numa tela do próprio Google, sem pedir permissão ao app. '' se cancelar. */
export async function scanQrCode(): Promise<string> {
  if (!isNative()) throw new ScanError('Ler QR code funciona no app Android.');
  try {
    const { text } = await Native.scanQr();
    return (text ?? '').trim();
  } catch (e) {
    throw new ScanError(e instanceof Error && e.message ? e.message : 'Não foi possível ler o QR code.');
  }
}
