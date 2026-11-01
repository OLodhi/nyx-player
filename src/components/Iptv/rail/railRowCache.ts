/**
 * Données des rangées du rail gardées d'une version de la source à l'autre : une rangée dont les entrées n'ont pas
 * changé rend le même objet, et le rail ne la remplit pas de nouveau (railSlots.ts). Sans elle, chaque nouvelle
 * version des données (Ma liste, une reprise, une note arrivée) faisait reconstruire toutes les rangées montées.
 */

import type { RailRowData } from './railRow';

export interface RailRowCache {
  /**
   * Données de la rangée `key` : celles d'avant si chacune des `inputs` est la même (comparées une à une, par
   * identité), sinon celles que rend `build`.
   */
  get: (key: string, inputs: readonly unknown[], build: () => RailRowData) => RailRowData;
}

export function createRailRowCache(): RailRowCache {
  const rows = new Map<string, { inputs: readonly unknown[]; data: RailRowData }>();
  return {
    get: (key, inputs, build) => {
      const known = rows.get(key);
      if (known && known.inputs.length === inputs.length && known.inputs.every((input, index) => input === inputs[index])) {
        return known.data;
      }
      const data = build();
      rows.set(key, { inputs, data });
      return data;
    },
  };
}
