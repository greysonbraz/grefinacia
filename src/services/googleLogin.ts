import { SocialLogin } from '@capgo/capacitor-social-login';
import { GOOGLE_WEB_CLIENT_ID } from '../lib/cloudConfig';
import { isNative } from './platform';

let ready = false;

/** Abre a escolha de conta do Google (Android) e devolve o token de identidade. Só funciona no app instalado. */
export async function googleIdToken(): Promise<string> {
  if (!isNative()) throw new Error('O login com Google só funciona no app Android instalado.');
  if (!ready) {
    await SocialLogin.initialize({ google: { webClientId: GOOGLE_WEB_CLIENT_ID } });
    ready = true;
  }
  const r = await SocialLogin.login({ provider: 'google', options: {} });
  const token = (r.result as { idToken?: string | null }).idToken;
  if (!token) throw new Error('O Google não devolveu a identificação. Tente de novo.');
  return token;
}

export async function googleSignOut(): Promise<void> {
  if (!isNative() || !ready) return;
  try {
    await SocialLogin.logout({ provider: 'google' });
  } catch {
    /* já estava deslogado */
  }
}
