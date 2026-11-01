/**
 * Longueur minimale du mot de passe du compte Nyx : 10 caractères, à l'inscription
 * et à chaque changement. Le serveur en exige 8 jusqu'à ce que son réglage passe à 10 :
 * l'app demande donc déjà au moins autant que lui, et l'utilisateur ne reçoit
 * jamais le refus peu clair du serveur. Les mots de passe plus courts créés
 * avant restent valables pour se connecter : la longueur n'est vérifiée qu'à la création.
 */
export const MIN_PASSWORD_LENGTH = 10;

export function isPasswordLongEnough(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}
