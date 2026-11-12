// Confere que nenhum segredo nem arquivo pessoal foi parar no repositório.
// Roda no GitHub Actions antes de compilar e pode ser rodado à mão: node scripts/check-secrets.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Arquivos que nunca devem ser versionados (chaves de assinatura, senhas, backups reais). */
const FORBIDDEN_FILES = [
  { re: /\.(jks|keystore|p12|pfx|pem)$/i, why: 'chave ou certificado' },
  { re: /(^|\/)keystore\.properties$/i, why: 'senha da chave de assinatura' },
  { re: /(^|\/)\.env(\.(?!example$)[^/]*)?$/i, why: 'arquivo de variáveis de ambiente' },
  { re: /\.gfbackup$/i, why: 'backup do app', allow: /^tests\/fixtures\// },
  { re: /(^|\/)google-services\.json$/i, why: 'configuração do Firebase' },
];

/** Formatos conhecidos de chaves e tokens. */
const SECRET_PATTERNS = [
  { name: 'chave privada', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/ },
  { name: 'chave da Anthropic', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'chave de API do Google', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'token do GitHub', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'chave secreta do Supabase', re: /\bsb_secret_[A-Za-z0-9_-]{20,}/ },
  { name: 'JWT (ex.: service_role do Supabase)', re: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/ },
  { name: 'segredo de cliente OAuth do Google', re: /\bGOCSPX-[A-Za-z0-9_-]{20,}/ },
];

const BINARY = /\.(png|jpe?g|gif|webp|ico|jar|aar|woff2?|ttf|zip|pdf|gfbackup)$/i;

/**
 * @param {{ path: string, content?: string }[]} files
 * @returns {{ path: string, line?: number, problem: string }[]}
 */
export function findSecrets(files) {
  const found = [];
  for (const f of files) {
    for (const rule of FORBIDDEN_FILES) {
      if (rule.re.test(f.path) && !(rule.allow && rule.allow.test(f.path))) found.push({ path: f.path, problem: `arquivo proibido (${rule.why})` });
    }
    if (f.content === undefined || BINARY.test(f.path)) continue;
    const lines = f.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const p of SECRET_PATTERNS) if (p.re.test(lines[i])) found.push({ path: f.path, line: i + 1, problem: p.name });
    }
  }
  return found;
}

function main() {
  const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const files = paths.map((path) => {
    if (BINARY.test(path)) return { path };
    try {
      return { path, content: readFileSync(path, 'utf8') };
    } catch {
      return { path };
    }
  });
  const found = findSecrets(files);
  if (found.length === 0) {
    console.log(`Nenhum segredo encontrado em ${paths.length} arquivos.`);
    return;
  }
  for (const f of found) console.error(`SEGREDO? ${f.path}${f.line ? ':' + f.line : ''} — ${f.problem}`);
  console.error('\nRemova o arquivo ou o valor acima antes de enviar. Se a chave já foi enviada alguma vez, troque-a: o histórico do Git guarda tudo.');
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
