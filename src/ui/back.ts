import { useEffect, useRef } from 'react';

/**
 * Botão "voltar" do Android: cada tela cheia ou janela aberta se registra aqui; o voltar fecha a última aberta.
 * Sem nenhuma aberta, o App decide (volta ao Início ou minimiza).
 */
const stack: { close: () => void }[] = [];

export function useBackHandler(close: () => void): void {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    const entry = { close: () => ref.current() };
    stack.push(entry);
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, []);
}

/** Fecha a tela/janela mais recente. Devolve false quando não havia nenhuma. */
export function closeTop(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}
export const openLayers = () => stack.length;
