<#
.SYNOPSIS
  Compile l'installeur Windows de PUBLICATION, signé avec la clé de mise à jour de Nyx, vérifie sa
  signature et écrit web/updates/latest.json (étapes de compilation et de signature d'une publication).

.DESCRIPTION
  La clé privée de mise à jour et son mot de passe sont saisis MASQUÉS dans ce terminal : jamais tapés
  dans une ligne de commande, donc jamais dans l'historique de PowerShell (PSReadLine,
  ConsoleHost_history.txt). Ils ne sont ni affichés ni écrits sur le disque. La compilation se fait
  SANS eux : seul l'outil de signature (`tauri signer sign`) les reçoit, par des variables
  d'environnement de CE processus posées le temps de signer, effacées aussitôt, même en cas d'échec
  ou d'arrêt par Ctrl+C. Le script ne met rien dans le presse-papiers ; il le vide à la fin.

  Dans l'ordre :
    1. refuse de compiler si des fichiers autres que ceux de la version sont modifiés, si le lecteur
       mpv.exe n'est pas le vrai programme (pointeur Git LFS : « git lfs pull »), si les trois
       numéros de version ne sont pas identiques, ou si des variables du banc ou d'audit traînent
       dans ce terminal ;
    2. demande la clé et le mot de passe, et vérifie, AVANT la compilation (une dizaine de minutes),
       que c'est la clé attendue par l'app (src-tauri/tauri.conf.json → plugins.updater.pubkey) ;
    3. compile sans la clé (`pnpm tauri build`, fichiers de mise à jour coupés), puis signe
       l'installeur et efface la clé et le mot de passe ;
    4. vérifie la signature produite : bonne clé, et faite pour CETTE version (l'app refuse sinon la
       mise à jour, sans message : src-tauri/src/app_update.rs) ;
    5. écrit web/updates/latest.json sans BOM, avec la signature, l'adresse R2 et les notes de
       NOTES_DE_VERSION_X.Y.Z.md du dossier docs (section « Texte court pour latest.json »),
       tenu par le mainteneur hors du dépôt public.

  La clé se copie depuis le gestionnaire de mots de passe : elle passe donc par le presse-papiers,
  dont Windows garde un historique. Après la compilation : Win+V → « Effacer tout ».

.PARAMETER Notes
  Texte du champ `notes` de latest.json, si ce fichier de notes n'existe pas (une ligne).

.EXAMPLE
  ./scripts/windows-release.ps1
  Compile, signe, vérifie et écrit latest.json (clé et mot de passe demandés, masqués).

.NOTES
  - Lancer depuis l'outil PowerShell, sans redirection (`*>` rend fatales les sorties des outils
    natifs).
  - Renvoie 1 et n'écrit pas latest.json si une vérification échoue : ne rien envoyer sur R2.
#>
param(
  [string]$Notes
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

# Début du nom de l'installeur signé, avant la version : vient de `productName` (tauri.conf.json).
# L'app le lit dans la signature (INSTALLER_PREFIX, src-tauri/src/app_update.rs) : les deux vont ensemble.
$PrefixeInstalleur = 'Nyx Player_'
# Seuls fichiers que la publication modifie avant la compilation (étapes 1 et 5 du guide) : tout autre
# changement non commité partirait dans l'installeur sans être passé par la CI
$FichiersDeVersion = 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock',
  'package.json', 'web/updates/latest.json'
# Variables qui changent le contenu de la version compilée (scripts du banc, d'audit et de mesure ;
# même liste que android-release-apk.ps1)
$VariablesInterdites = 'NYX_ANDROID_APP_ID', 'NYX_ANDROID_APP_LABEL', 'NYX_VERSION_AUDIT',
  'VITE_AUDIT', 'VITE_BANC', 'VITE_BANC_LECTEUR', 'VITE_AUDIT_BUILD', 'VITE_PERF'

# Clé publique, signature : base64 d'un texte minisign (« untrusted comment » + ligne base64).
# Octets 2 à 9 de cette ligne = identifiant de la clé, en petit-boutiste (comme verify-updater-key.ps1).
function Get-MinisignKeyId([string]$encoded) {
  $text = $encoded.Trim()
  if ($text -notmatch 'untrusted comment') {
    $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($text))
  }
  $line = @($text -split "`n" | Where-Object { $_.Trim() -and $_ -notmatch '^untrusted comment' -and $_ -notmatch '^trusted comment' })[0].Trim()
  $bytes = [Convert]::FromBase64String($line)
  $id = $bytes[2..9]
  [array]::Reverse($id)
  return ($id | ForEach-Object { $_.ToString('X2') }) -join ''
}

# Nom du fichier signé, lu comme l'app le lit : 3e ligne seulement (commentaire couvert par la signature)
function Get-FichierSigne([string]$signatureB64) {
  $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($signatureB64.Trim()))
  $lignes = $text -split "`n"
  if ($lignes.Count -lt 3 -or -not $lignes[2].StartsWith('trusted comment: ')) { return $null }
  foreach ($champ in $lignes[2].Substring('trusted comment: '.Length).TrimEnd("`r") -split "`t") {
    if ($champ.StartsWith('file:')) { return $champ.Substring(5) }
  }
  return $null
}

function ConvertFrom-Secure([Security.SecureString]$secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

# --- 1. Contrôles, sans la clé ------------------------------------------------------------------
$restees = @($VariablesInterdites | Where-Object { Test-Path "Env:$_" })
if ($restees.Count -gt 0) {
  throw "Compilation refusée : $($restees -join ', ') défini dans ce terminal (reste d'une compilation du banc ou d'audit). Ouvrir un nouveau terminal PowerShell pour la publication."
}
if ($env:TAURI_SIGNING_PRIVATE_KEY -or $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  throw "Une clé de signature est déjà posée dans ce terminal (ancienne méthode du guide). Fermer ce terminal, en ouvrir un neuf et relancer ce script : la clé est demandée masquée."
}

Push-Location $root
try {
  # Format -z : chemins bruts (un nom accentué n'est ni entre guillemets ni échappé), séparés par
  # un caractère nul ; un renommage indexé donne « R  nouveau », puis l'ancien nom à part.
  $encodageAvant = [Console]::OutputEncoding
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  try { $brut = (& git status --porcelain=v1 -z --untracked-files=all) -join "`n" }
  finally { [Console]::OutputEncoding = $encodageAvant }
  if ($LASTEXITCODE -ne 0) { throw 'git status a échoué : lancer ce script depuis le dépôt.' }
  $entrees = @()
  $jetons = $brut.Split([char]0)
  for ($i = 0; $i -lt $jetons.Count; $i++) {
    $jeton = $jetons[$i].Trim("`n")
    if ($jeton.Length -lt 4) { continue }
    $entrees += [pscustomobject]@{ Etat = $jeton.Substring(0, 2); Chemin = $jeton.Substring(3) }
    if ($jeton[0] -eq 'R' -or $jeton[0] -eq 'C') { $i++ }  # ancien nom du renommage ou de la copie
  }
  # Fichiers suivis régénérés par chaque compilation dont seules les fins de ligne changent
  # (permissions du plugin Android sous Windows) : rien ne change dans l'installeur, jamais commités,
  # donc ignorés. Un fichier non suivi (« ?? ») compte toujours.
  $modifies = @($entrees | Where-Object { $FichiersDeVersion -notcontains $_.Chemin } |
    Where-Object { $_.Etat -eq '??' -or $(& git diff --quiet --ignore-cr-at-eol HEAD -- $_.Chemin; $LASTEXITCODE -ne 0) } |
    ForEach-Object { $_.Chemin })
} finally { Pop-Location }
if ($modifies.Count -gt 0) {
  throw "Compilation refusée : fichiers modifiés hors version ($($modifies -join ', ')). Les commiter par le circuit habituel ou les annuler : ils partiraient dans l'installeur sans être passés par la CI."
}

# Le lecteur vidéo embarqué (resources/mpv/mpv.exe, suivi par Git LFS) doit être le vrai programme. Dans
# une copie du dépôt sans le contenu Git LFS, c'est un pointeur texte de 134 octets que git ne voit pas
# comme modifié : l'app publiée afficherait « Application 16 bits non prise en charge » à la première
# lecture. Vérifié sans rien télécharger (taille, empreinte SHA-256) ; le détail s'affiche au-dessus.
# Messages de node sur sa sortie d'erreur : affichés tels quels, sans arrêter le script avant le refus
# clair ci-dessous (même motif que pour `tauri signer sign`).
$ErrorActionPreference = 'Continue'
try { & node (Join-Path $root 'scripts\binaires-natifs.mjs') windows --verifier }
finally { $ErrorActionPreference = 'Stop' }
if ($LASTEXITCODE -ne 0) {
  throw "Compilation refusée : le lecteur vidéo mpv.exe n'est pas le vrai programme (détail ci-dessus). Lancer « git lfs pull » à la racine du dépôt, puis relancer ce script."
}

$conf = Get-Content (Join-Path $root 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$version = $conf.version
$versionCargo = [regex]::Match((Get-Content (Join-Path $root 'src-tauri\Cargo.toml') -Raw), '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
$versionPaquet = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Version illisible dans tauri.conf.json : $version" }
if ($versionCargo -ne $version -or $versionPaquet -ne $version) {
  throw "Versions différentes : tauri.conf.json $version, Cargo.toml $versionCargo, package.json $versionPaquet (étape 1 du guide)."
}
if ($conf.productName + '_' -ne $PrefixeInstalleur) {
  throw "productName a changé ($($conf.productName)) : l'app n'accepterait plus la mise à jour (INSTALLER_PREFIX de src-tauri/src/app_update.rs à changer d'abord, voir RELEASE_GUIDE.md)."
}

if (-not $Notes) {
  $fichierNotes = Join-Path $root "docs\NOTES_DE_VERSION_$version.md"
  if (-not (Test-Path $fichierNotes)) { throw "Notes introuvables : $fichierNotes. Les écrire, ou passer -Notes 'texte'." }
  $section = [regex]::Match((Get-Content $fichierNotes -Raw -Encoding UTF8), '(?s)## Texte court pour `latest\.json`.*?```text\r?\n(.+?)\r?\n```')
  if (-not $section.Success) { throw "Section « Texte court pour latest.json » introuvable dans $fichierNotes." }
  $Notes = $section.Groups[1].Value
}
$Notes = $Notes.Trim()
if ($Notes -match "[`r`n]") { throw 'Les notes de latest.json tiennent sur une seule ligne.' }

$cleAttendue = Get-MinisignKeyId $conf.plugins.updater.pubkey
$bundle = Join-Path $root 'src-tauri\target\release\bundle\nsis'
$installeur = Join-Path $bundle "$PrefixeInstalleur${version}_x64-setup.exe"
$fichierSig = "$installeur.sig"
Write-Host "Version $version, clé attendue par l'app : $cleAttendue" -ForegroundColor Cyan

# --- 2 et 3. Clé masquée et vérifiée, compilation SANS la clé, puis signature ---------------------
# La clé reste chiffrée en mémoire (SecureString) pendant la compilation : seul `tauri signer sign`
# la reçoit, quelques secondes. Le code lancé par la compilation (dépendances npm, build.rs des
# crates) ne la voit jamais.
function Invoke-Signature([string]$fichier) {
  try {
    $env:TAURI_SIGNING_PRIVATE_KEY = ConvertFrom-Secure $cleSecure
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ConvertFrom-Secure $motDePasseSecure
    Push-Location $root
    # Outil verrouillé du dépôt (pas npx, qui pourrait en télécharger un autre). Sa sortie ne contient
    # que la signature (publique) ou un message d'erreur, jamais la clé : gardée, jamais affichée.
    $ErrorActionPreference = 'Continue'
    $sortie = & pnpm tauri signer sign $fichier 2>&1 | Out-String
    $ok = $LASTEXITCODE -eq 0 -and (Test-Path "$fichier.sig")
  } finally {
    $ErrorActionPreference = 'Stop'
    Pop-Location
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
  }
  if (-not $ok) {
    # Dernière ligne utile de l'outil, telle quelle : un message d'erreur, jamais la clé. Les lignes
    # ajoutées par pnpm (ELIFECYCLE) et par PowerShell (erreur d'un programme externe) ne disent rien.
    $erreur = @($sortie -split "`r?`n" | Where-Object { $_.Trim() -and $_ -notmatch 'ELIFECYCLE|NativeCommandError|^\s*\+ |^At .*char:\d|^Au caractère' }) | Select-Object -Last 1
    if (-not $erreur) { $erreur = 'aucun message, aucune signature produite' }
    $indice = if ($sortie -match '(?i)password|decrypt|wrong') { ' Le mot de passe ne correspond sans doute pas à cette clé.' } else { ' La clé est peut-être incomplète ou mal copiée.' }
    throw "Signature refusée par tauri signer : $($erreur.Trim()).$indice"
  }
}

$workDir = Join-Path ([IO.Path]::GetTempPath()) ("nyx-release-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workDir | Out-Null
$cleSecure = $null
$motDePasseSecure = $null
try {
  $cleSecure = Read-Host 'Colle la clé PRIVÉE de mise à jour puis Entrée (rien ne s''affiche)' -AsSecureString
  try { Set-Clipboard -Value ' ' } catch { }
  $debutCle = (ConvertFrom-Secure $cleSecure).Trim()
  if (-not $debutCle.StartsWith('dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWdu')) {
    throw 'Ce texte ne ressemble pas à une clé privée Tauri (elle commence par dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWdu ; celle en dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWdu est la clé PUBLIQUE).'
  }
  # Sans retour à la ligne ni espace autour (collée depuis le gestionnaire de mots de passe)
  $cleSecure.Dispose()
  $cleSecure = ConvertTo-SecureString $debutCle -AsPlainText -Force
  $debutCle = $null
  $motDePasseSecure = Read-Host 'Mot de passe de la clé (rien ne s''affiche)' -AsSecureString
  try { Set-Clipboard -Value ' ' } catch { }
  # Vide : l'outil le demanderait sans que rien s'affiche (sa sortie est gardée)
  if ($motDePasseSecure.Length -eq 0) { throw 'Mot de passe vide : la clé de Nyx en a un.' }

  # Bonne clé et bon mot de passe avant de compiler : signature d'un fichier jetable
  $essai = Join-Path $workDir 'essai.txt'
  Set-Content -Path $essai -Value 'Nyx Player - essai de la cle de mise a jour' -Encoding ascii
  Invoke-Signature $essai
  $cleEssai = Get-MinisignKeyId (Get-Content "$essai.sig" -Raw)
  if ($cleEssai -ne $cleAttendue) {
    throw "Ce n'est PAS la clé de l'app : elle signe en $cleEssai, l'app attend $cleAttendue."
  }
  Write-Host "Bonne clé ($cleEssai). Compilation, sans la clé…" -ForegroundColor Green

  # Un ancien installeur de la même version ne doit pas passer pour le nouveau
  Remove-Item $installeur, $fichierSig -ErrorAction SilentlyContinue
  # Sans fichiers de mise à jour, la compilation ne demande pas la clé ; la signature se fait après.
  # Réglage passé par un fichier : PowerShell 5.1 abîme les guillemets d'un JSON passé en argument.
  $sansSignature = Join-Path $workDir 'sans-signature.json'
  [IO.File]::WriteAllText($sansSignature, '{"bundle":{"createUpdaterArtifacts":false}}', [Text.UTF8Encoding]::new($false))
  Push-Location $root
  try {
    & pnpm tauri build --config $sansSignature
    if ($LASTEXITCODE -ne 0) { throw "Compilation échouée ($LASTEXITCODE) : voir les messages plus haut." }
  } finally { Pop-Location }
  if (-not (Test-Path $installeur)) { throw "Installeur introuvable après la compilation : $installeur" }
  if (Test-Path $fichierSig) { throw "Une signature a été produite par la compilation elle-même ($fichierSig) : la clé était donc visible d'elle. Ne rien publier, prévenir Claude." }

  Write-Host 'Signature de l''installeur…'
  Invoke-Signature $installeur
} finally {
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
  if ($cleSecure) { $cleSecure.Dispose() }
  if ($motDePasseSecure) { $motDePasseSecure.Dispose() }
  $cleSecure = $null
  $motDePasseSecure = $null
  $debutCle = $null
  Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
  # La clé collée peut encore être dans le presse-papiers : il est vidé (pas son historique Win+V)
  try { Set-Clipboard -Value ' ' } catch { }
  Write-Host 'Clé et mot de passe effacés, presse-papiers vidé. Vider aussi son historique (Win+V → « Effacer tout ») et fermer ce terminal.' -ForegroundColor Yellow
}

# --- 4. Signature produite : bonne clé, bonne version ------------------------------------------
if (-not (Test-Path $installeur) -or -not (Test-Path $fichierSig)) {
  throw "Installeur ou signature introuvable : $installeur(.sig). Ne rien envoyer sur R2."
}
$signature = (Get-Content $fichierSig -Raw).Trim()
$cleSignature = Get-MinisignKeyId $signature
if ($cleSignature -ne $cleAttendue) {
  throw "Installeur signé avec une autre clé ($cleSignature, l'app attend $cleAttendue) : ne rien envoyer sur R2."
}
$signePour = Get-FichierSigne $signature
if ($signePour -ne "$PrefixeInstalleur${version}_x64-setup.exe") {
  throw "Signature faite pour « $signePour », pas pour la version $version : l'app refuserait la mise à jour. Ne rien envoyer sur R2."
}
Write-Host "Signature vérifiée : clé $cleSignature, fichier « $signePour »." -ForegroundColor Green

# --- 5. latest.json, sans BOM (sinon l'app ne le lit pas) ---------------------------------------
$manifeste = [ordered]@{
  version = $version
  notes = $Notes
  pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ', [Globalization.CultureInfo]::InvariantCulture)
  platforms = [ordered]@{
    'windows-x86_64' = [ordered]@{
      signature = $signature
      url = "https://releases.nyxplayer.app/Nyx-Player_${version}_x64-setup.exe"
    }
  }
}
$cheminManifeste = Join-Path $root 'web\updates\latest.json'
[IO.File]::WriteAllText($cheminManifeste, ($manifeste | ConvertTo-Json -Depth 4) + "`n", [Text.UTF8Encoding]::new($false))
Write-Host "latest.json écrit : $cheminManifeste (relire les notes ; il part sur le site avec la fusion vers main)."
Write-Host "Installeur prêt : $installeur → à envoyer sur R2 sous le nom Nyx-Player_${version}_x64-setup.exe (étape 4)." -ForegroundColor Green
