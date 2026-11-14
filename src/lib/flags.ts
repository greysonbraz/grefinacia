/**
 * Recursos pagos ficam desligados nesta fase do projeto (custo zero).
 *
 * A IA externa (API da Anthropic, cobrada por uso na conta de quem informa a chave) continua no código,
 * mas enquanto isto for `false` ela não aparece nos Ajustes e nunca é chamada, mesmo que uma instalação
 * antiga tenha deixado a opção ligada.
 */
export const PAID_AI_ENABLED: boolean = false;
