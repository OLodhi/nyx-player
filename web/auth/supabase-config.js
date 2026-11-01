// Adresse du projet Supabase et clé PUBLIQUE utilisées par les 3 pages d'authentification
// (confirmation d'inscription, changement d'e-mail, mot de passe oublié). Cette clé est publique
// par nature (elle est aussi dans l'app) : les règles d'accès de la base protègent les données.
//
// Clé « publishable » (Settings → API Keys), à la place de l'ancienne clé « anon ». La marque
// « gitleaks:allow » dit au détecteur de secrets que cette ligne est publique, en connaissance de cause.
window.NYX_SUPABASE = {
  url: 'https://tgbctbkcsvziongtekku.supabase.co',
  key: 'sb_publishable_SMsi0xduB_faRH9rOVqBXA_hRxsNhUC', // gitleaks:allow
};
