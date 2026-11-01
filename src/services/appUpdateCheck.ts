/**
 * Mise à jour Windows : vérification faite par l'app elle-même (commande `nyx_update_check`, Rust
 * `app_update.rs`). La page ne choisit plus aucune option : la vérification du greffon acceptait
 * de la page un retour en arrière (`allowDowngrades`), un proxy, des en-têtes ou une autre cible ;
 * elle n'est plus permise. Le téléchargement et l'installation passent toujours par le greffon.
 */

import { invoke } from '@tauri-apps/api/core';
import { Update } from '@tauri-apps/plugin-updater';

type UpdateMetadata = ConstructorParameters<typeof Update>[0];

/** Mise à jour proposée (version plus récente, signée pour cette version), ou `null`. */
export async function checkForAppUpdate(): Promise<Update | null> {
  const metadata = await invoke<UpdateMetadata | null>('nyx_update_check');
  return metadata ? new Update(metadata) : null;
}
