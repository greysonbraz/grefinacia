// Auditoria das ferramentas de build e teste (devDependencies), que não vão dentro do APK.
// Bloqueia quando um alerta alto/crítico já tem versão corrigida publicada (atualize a dependência).
// Quando nenhuma versão publicada escapa do alerta, só avisa no log. As dependências do app são
// auditadas à parte, sempre com bloqueio (npm audit --omit=dev --audit-level=high).
// O "fixAvailable" do npm não serve aqui: ele sugere voltar para versões antigas (major menor).
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const semver = createRequire(import.meta.url)('semver');
const run = (cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    return e.stdout; // npm audit sai com código 1 quando encontra algo
  }
};

const report = JSON.parse(run('npm audit --json'));
const advisories = new Map(); // pacote vulnerável -> faixas afetadas
for (const v of Object.values(report.vulnerabilities ?? {})) {
  for (const via of v.via ?? []) {
    if (typeof via === 'object' && (via.severity === 'high' || via.severity === 'critical')) {
      advisories.set(via.name, [...(advisories.get(via.name) ?? []), { range: via.range, url: via.url }]);
    }
  }
}
const fixed = [], open = [];
for (const [name, list] of advisories) {
  const latest = run(`npm view ${name} version`).trim();
  for (const a of list) (latest && !semver.satisfies(latest, a.range) ? fixed : open).push(`${name} (${a.range}; última ${latest || '?'}; ${a.url})`);
}
if (fixed.length) {
  console.log(`::error::Já existe versão corrigida: ${fixed.join(' | ')}. Atualize a dependência.`);
  process.exit(1);
}
if (open.length) console.log(`::warning::Alerta alto sem versão corrigida em ferramenta de build (não vai no APK): ${open.join(' | ')}`);
else console.log('Ferramentas de build sem alerta alto.');
