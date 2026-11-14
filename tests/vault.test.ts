import { describe, expect, it } from 'vitest';
import { changePassphrase, createVault, openRecord, sealRecord, unlockVault, VaultError, type RecordRef } from '../src/services/vault';

const ITER = 100_000; // mínimo aceito; o app usa 600 mil
const PASS = 'frase secreta de teste';
const ref: RecordRef = { userId: 'u1', collection: 'transactions', id: 't1' };
const value = { id: 't1', description: 'Salário', amountCents: 350000 };

describe('cofre da nuvem (criptografia ponta a ponta)', () => {
  it('o que vai para a nuvem não contém os dados nem a senha', async () => {
    const { meta, key } = await createVault(PASS, ITER);
    const sealed = await sealRecord(key, ref, value);
    const sent = JSON.stringify({ meta, sealed });
    expect(sent).not.toContain('Salário');
    expect(sent).not.toContain('350000');
    expect(sent).not.toContain(PASS);
  }, 30000);

  it('outro aparelho abre com a senha certa e falha com a errada', async () => {
    const { meta, key } = await createVault(PASS, ITER);
    const sealed = await sealRecord(key, ref, value);
    const other = await unlockVault(JSON.parse(JSON.stringify(meta)), PASS);
    expect(await openRecord(other, ref, sealed)).toEqual(value);
    await expect(unlockVault(meta, 'senha errada 123')).rejects.toThrow('Senha de sincronização incorreta');
  }, 30000);

  it('registro alterado, trocado de lugar ou de outro dono não abre', async () => {
    const { key } = await createVault(PASS, ITER);
    const sealed = await sealRecord(key, ref, value);
    const flip = (s: string) => (s[5] === 'A' ? 'B' : 'A') + s.slice(1);
    await expect(openRecord(key, ref, { ...sealed, payload: flip(sealed.payload) })).rejects.toBeInstanceOf(VaultError);
    await expect(openRecord(key, { ...ref, id: 't2' }, sealed)).rejects.toThrow('ilegível');
    await expect(openRecord(key, { ...ref, collection: 'debts' }, sealed)).rejects.toThrow('ilegível');
    await expect(openRecord(key, { ...ref, userId: 'u2' }, sealed)).rejects.toThrow('ilegível');
    const stranger = (await createVault(PASS, ITER)).key;
    await expect(openRecord(stranger, ref, sealed)).rejects.toThrow('ilegível');
  }, 30000);

  it('cada gravação usa um IV novo', async () => {
    const { key } = await createVault(PASS, ITER);
    const a = await sealRecord(key, ref, value);
    const b = await sealRecord(key, ref, value);
    expect(a.iv).not.toBe(b.iv);
    expect(a.payload).not.toBe(b.payload);
  }, 30000);

  it('trocar a senha mantém os registros legíveis e invalida a senha antiga', async () => {
    const { meta, key } = await createVault(PASS, ITER);
    const sealed = await sealRecord(key, ref, value);
    const meta2 = await changePassphrase(meta, PASS, 'nova frase bem longa', ITER);
    expect(await openRecord(await unlockVault(meta2, 'nova frase bem longa'), ref, sealed)).toEqual(value);
    await expect(unlockVault(meta2, PASS)).rejects.toThrow('incorreta');
  }, 30000);

  it('recusa senha curta e cofre forjado', async () => {
    await expect(createVault('curta', ITER)).rejects.toThrow('pelo menos');
    const { meta } = await createVault(PASS, ITER);
    await expect(unlockVault({ ...meta, iter: 1 }, PASS)).rejects.toThrow('formato desconhecido');
    await expect(unlockVault({ ...meta, iter: 9e12 }, PASS)).rejects.toThrow('formato desconhecido');
    await expect(unlockVault({ ...meta, v: 2 as 1 }, PASS)).rejects.toThrow('formato desconhecido');
  }, 30000);
});
