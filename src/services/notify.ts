import { LocalNotifications } from '@capacitor/local-notifications';
import type { Channel, ImmediateAlert, PlannedNotification } from '../domain/notifications';
import { hashId } from '../domain/notifications';
import { isNative } from './platform';

const CHANNELS: { id: Channel; name: string; description: string; importance: 1 | 2 | 3 | 4 | 5 }[] = [
  { id: 'contas', name: 'Contas e vencimentos', description: 'Lembretes de contas e faturas', importance: 4 },
  { id: 'salario', name: 'Salário', description: 'Recebimento do salário e plano do mês', importance: 4 },
  { id: 'dividendos', name: 'Dividendos e rendimentos', description: 'Proventos anunciados e a caminho', importance: 3 },
  { id: 'alertas', name: 'Alertas financeiros', description: 'Orçamento, saldo e backup', importance: 4 },
  { id: 'metas', name: 'Metas de economia', description: 'Metas alcançadas', importance: 3 },
];

/** Registro em memória das notificações da web (usado apenas em desenvolvimento e testes). */
export const webLog: { planned: PlannedNotification[]; fired: ImmediateAlert[] } = { planned: [], fired: [] };

export async function ensureChannels(): Promise<void> {
  if (!isNative()) return;
  for (const c of CHANNELS) {
    // visibility 0 = privada: o conteúdo (valores) fica oculto na tela de bloqueio
    await LocalNotifications.createChannel({ id: c.id, name: c.name, description: c.description, importance: c.importance, visibility: 0, vibration: true });
  }
}

export async function notificationPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unsupported'> {
  if (isNative()) {
    const r = await LocalNotifications.checkPermissions();
    return r.display === 'granted' ? 'granted' : r.display === 'denied' ? 'denied' : 'prompt';
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission === 'default' ? 'prompt' : (Notification.permission as 'granted' | 'denied');
}

export async function requestNotificationPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (isNative()) {
    const r = await LocalNotifications.requestPermissions();
    return r.display === 'granted' ? 'granted' : 'denied';
  }
  if (typeof Notification === 'undefined') return 'unsupported';
  const p = await Notification.requestPermission();
  return p === 'granted' ? 'granted' : 'denied';
}

const IDS_KEY = 'mf_sched_ids';
function readIds(): number[] {
  try {
    return JSON.parse(localStorage.getItem(IDS_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function saveIds(ids: number[]): void {
  try {
    localStorage.setItem(IDS_KEY, JSON.stringify(ids));
  } catch {
    /* sem armazenamento: ignora */
  }
}

/** Substitui as notificações que o app havia agendado pelo plano recalculado. */
export async function syncScheduled(plan: PlannedNotification[]): Promise<void> {
  if (!isNative()) {
    webLog.planned = plan;
    return;
  }
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted') return;
  // cancela só o que o próprio plano agendou antes (não derruba alertas imediatos que ainda vão ser exibidos)
  const prev = readIds();
  if (prev.length > 0) await LocalNotifications.cancel({ notifications: prev.map((id) => ({ id })) });
  saveIds(plan.map((p) => p.id));
  if (plan.length === 0) return;
  await LocalNotifications.schedule({
    notifications: plan.map((p) => ({
      id: p.id,
      title: p.title,
      body: p.body,
      channelId: p.channel,
      smallIcon: 'ic_stat_finance',
      schedule: { at: p.at, allowWhileIdle: true },
      // horário aproximado já basta para lembretes; evita abrir a tela de "Alarmes e lembretes" do Android
      isExactNotification: false,
    })),
  });
}

export async function fireNow(alert: ImmediateAlert): Promise<void> {
  if (!isNative()) {
    webLog.fired.push(alert);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(alert.title, { body: alert.body });
    return;
  }
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted') return;
  await LocalNotifications.schedule({
    notifications: [{ id: hashId(alert.key + ':' + Date.now()), title: alert.title, body: alert.body, channelId: alert.channel, smallIcon: 'ic_stat_finance', schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true }, isExactNotification: false }],
  });
}
