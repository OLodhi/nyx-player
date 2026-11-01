/**
 * tauriCoreShim.ts — Remplace `@tauri-apps/api/core` quand NYX_PREVIEW=1 (alias Vite, dev uniquement).
 *
 * Dans une vraie WebView Tauri, window.__TAURI_INTERNALS__.invoke est verrouillé : on intercepte donc
 * les commandes au niveau du module. Les commandes non gérées par le mode preview partent vers le vrai backend.
 */

export * from '../../../node_modules/@tauri-apps/api/core.js';
import { invoke as realInvoke, type InvokeArgs, type InvokeOptions } from '../../../node_modules/@tauri-apps/api/core.js';

const PASS = Symbol.for('nyx-preview-pass');
/** Le handler peut renvoyer { [PASS_WITH_ARGS]: args } pour transmettre au vrai backend avec d'autres arguments. */
const PASS_WITH_ARGS = Symbol.for('nyx-preview-pass-with-args');

export async function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  const handler = (window as unknown as { __NYX_PREVIEW_HANDLER__?: (cmd: string, args: unknown) => unknown })
    .__NYX_PREVIEW_HANDLER__;
  if (handler) {
    const result = await handler(cmd, args);
    if (result && typeof result === 'object' && PASS_WITH_ARGS in result) {
      return realInvoke<T>(cmd, (result as Record<symbol, InvokeArgs>)[PASS_WITH_ARGS], options);
    }
    if (result !== PASS) return result as T;
  }
  return realInvoke<T>(cmd, args, options);
}
