// Ajustes no projeto Android gerado pelo Capacitor. Pode rodar quantas vezes quiser (idempotente).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const manifest = 'android/app/src/main/AndroidManifest.xml';
let m = readFileSync(manifest, 'utf8');
const perms = ['android.permission.POST_NOTIFICATIONS', 'android.permission.RECEIVE_BOOT_COMPLETED', 'android.permission.USE_BIOMETRIC', 'android.permission.WAKE_LOCK'];
for (const p of perms) if (!m.includes(p)) m = m.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
// os dados financeiros não vão para o backup automático do Google: o backup é o arquivo criptografado do app
m = m.replace('android:allowBackup="true"', 'android:allowBackup="false"');
writeFileSync(manifest, m);

const gradle = 'android/app/build.gradle';
let g = readFileSync(gradle, 'utf8');
const runnerLibs = "dirs '../../node_modules/@capacitor/background-runner/android/src/main/libs', 'libs'";
if (!g.includes('background-runner')) g = g.replace(/(flatDir\s*\{\s*\n\s*dirs [^\n]+\n)/, `$1        ${runnerLibs}\n`);
writeFileSync(gradle, g);

const drawable = 'android/app/src/main/res/drawable';
mkdirSync(drawable, { recursive: true });
writeFileSync(`${drawable}/ic_stat_finance.xml`, `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:pathData="M4,19h16v2H4zM5,10h3v7H5zM10.5,6h3v11h-3zM16,12h3v5h-3z" />
</vector>
`);
console.log('Projeto Android ajustado:', existsSync(`${drawable}/ic_stat_finance.xml`) ? 'ok' : 'falhou');
