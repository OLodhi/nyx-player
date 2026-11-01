<#
.SYNOPSIS
  Compile les APK Android de PUBLICATION (téléphone arm64, Chromecast / box armv7), signés avec la clé
  de publication de Nyx, puis vérifie leur signature.
.EXAMPLE
  ./scripts/android-release-apk.ps1                 # compile, signe, vérifie (demande le mot de passe)
  ./scripts/android-release-apk.ps1 -NoBuild        # vérifie seulement les APK déjà compilés
  ./scripts/android-release-apk.ps1 -Verifier C:\chemin\nyx.apk   # vérifie un APK quelconque
.NOTES
  - Clé par défaut : %USERPROFILE%\.nyx-keys\nyx-release.jks, alias « nyx » (-Keystore, -Alias pour
    une autre). Elle ne doit jamais être copiée dans le dossier du dépôt.
  - Le mot de passe est tapé au clavier (masqué). Il n'est ni affiché ni écrit sur le disque : il passe
    à Gradle par des variables d'environnement de CE processus seulement, effacées à la fin.
  - La signature se fait dans Gradle (src-tauri/gen/android/app/build.gradle.kts) dès que
    NYX_ANDROID_KEYSTORE est défini. Sans elle, les APK release restent non signés comme avant (CI du
    PC, scripts de test signés avec la clé de debug).
  - Un APK dont l'empreinte n'est pas celle attendue n'est jamais copié dans le dossier de sortie.
  - Nom interne vérifié aussi : seul com.nyxplayer.app se publie. Un APK du banc (« Nyx Banc »,
    com.nyxplayer.app.banc) ou de mesure, compilé dans le même dossier de sortie, est refusé ; une
    compilation lancée avec des variables du banc restées dans le terminal aussi.
  - Écrit aussi web/updates/android.json (version, adresses, empreintes SHA-256 et tailles des deux APK) :
    c'est ce fichier que les apps Android lisent pour proposer la mise à jour. Il part sur le site avec
    la fusion vers main, APRÈS l'envoi des APK sur R2.
  - Lancer depuis l'outil PowerShell sans redirection (`*>` rend fatales les sorties des outils natifs).
#>
param(
    [string]$Keystore = (Join-Path $env:USERPROFILE '.nyx-keys\nyx-release.jks'),
    [string]$Alias = 'nyx',
    [switch]$NoBuild,
    [string]$Verifier
)
$ErrorActionPreference = 'Stop'

# Empreinte SHA-256 du certificat de la clé de publication (publique, créée par le mainteneur)
$EmpreinteAttendue = 'AC:F3:08:87:EA:EC:C9:88:BC:9C:F5:92:17:C3:D5:4A:6D:79:E7:8F:0E:09:0A:49:EB:48:1A:7C:50:4A:9D:28'
# Nom interne de la vraie app (applicationId par défaut, src-tauri/gen/android/app/build.gradle.kts).
# Nyx Banc (com.nyxplayer.app.banc) et Nyx Mesure portent un autre nom : jamais publiés.
$PaquetAttendu = 'com.nyxplayer.app'
# Variables qui font compiler une autre app (NYX_ANDROID_APP_*), laissent
# passer une version d'audit ou du banc (NYX_VERSION_AUDIT, scripts/garde-publication.mjs) ou en
# changent le contenu (VITE_*, posées par les scripts du banc, d'audit et de mesure)
$VariablesInterdites = 'NYX_ANDROID_APP_ID', 'NYX_ANDROID_APP_LABEL', 'NYX_VERSION_AUDIT',
    'VITE_AUDIT', 'VITE_BANC', 'VITE_BANC_LECTEUR', 'VITE_AUDIT_BUILD', 'VITE_PERF'

$root = Split-Path $PSScriptRoot -Parent
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
# build-tools le plus récent (versions finales seulement : « 35.0.0-rc1 » ne se compare pas)
$outils = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\d+(\.\d+)+$' } |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $outils) { throw "Aucun build-tools dans $sdk (Android Studio > SDK Manager > SDK Tools)" }
$apksigner = Join-Path $outils.FullName 'apksigner.bat'
$aapt2 = Join-Path $outils.FullName 'aapt2.exe'
if (-not (Test-Path $aapt2)) { throw "aapt2 introuvable dans $($outils.FullName) : nom interne des APK impossible à vérifier" }

function Get-Empreinte([string]$apk) {
    # apksigner écrit l'empreinte en minuscules sans « : » (« certificate SHA-256 digest: acf3… »)
    # Ses avertissements sur stderr ne doivent pas arrêter le script (PowerShell 5.1)
    $ErrorActionPreference = 'Continue'
    $sortie = & $apksigner verify --print-certs $apk 2>&1 | Out-String
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { throw "Signature invalide ou absente : $apk`n$sortie" }
    $ligne = [regex]::Match($sortie, 'certificate SHA-256 digest:\s*([0-9a-fA-F]{64})')
    if (-not $ligne.Success) { throw "Empreinte introuvable dans la sortie d'apksigner pour $apk" }
    $hex = $ligne.Groups[1].Value.ToUpperInvariant()
    return (($hex -split '(.{2})' | Where-Object { $_ }) -join ':')
}

function Test-Empreinte([string]$apk) {
    $empreinte = Get-Empreinte $apk
    if ($empreinte -eq $EmpreinteAttendue) {
        Write-Host "BONNE CLÉ : $apk" -ForegroundColor Green
        return $true
    }
    Write-Host "MAUVAISE CLÉ : $apk" -ForegroundColor Red
    Write-Host "  empreinte trouvée : $empreinte" -ForegroundColor Yellow
    Write-Host "  empreinte attendue : $EmpreinteAttendue" -ForegroundColor Yellow
    return $false
}

function Get-NomPaquet([string]$apk) {
    # Première ligne de « aapt2 dump badging » : package: name='com.nyxplayer.app' versionCode=…
    $ErrorActionPreference = 'Continue'
    $sortie = & $aapt2 dump badging $apk 2>&1 | Out-String
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { throw "Nom interne illisible (aapt2) : $apk`n$sortie" }
    $ligne = [regex]::Match($sortie, "package: name='([^']+)'")
    if (-not $ligne.Success) { throw "Nom interne introuvable dans la sortie d'aapt2 pour $apk" }
    return $ligne.Groups[1].Value
}

function Test-NomPaquet([string]$apk) {
    $nom = Get-NomPaquet $apk
    # -ceq : un nom de paquet Android distingue les majuscules
    if ($nom -ceq $PaquetAttendu) {
        Write-Host "BONNE APP : $apk ($nom)" -ForegroundColor Green
        return $true
    }
    Write-Host "MAUVAISE APP : $apk" -ForegroundColor Red
    Write-Host "  nom interne trouvé : $nom" -ForegroundColor Yellow
    Write-Host "  nom interne attendu : $PaquetAttendu (un APK du banc ou de mesure ne se publie jamais)" -ForegroundColor Yellow
    return $false
}

if ($Verifier) {
    if (-not (Test-Path $Verifier)) { throw "APK introuvable : $Verifier" }
    # Un nom interne différent n'empêche pas d'afficher aussi la clé (un fichier illisible par aapt2
    # arrête le script en erreur)
    $bonneApp = Test-NomPaquet $Verifier
    $bonneCle = Test-Empreinte $Verifier
    if ($bonneApp -and $bonneCle) { exit 0 } else { exit 1 }
}

$apkDir = Join-Path $root 'src-tauri\gen\android\app\build\outputs\apk'
$version = (Get-Content (Join-Path $root 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version
$sortie = Join-Path (Split-Path $root -Parent) 'nyx-release-apk'
$debut = Get-Date

if (-not $NoBuild) {
    $restees = @($VariablesInterdites | Where-Object { Test-Path "Env:$_" })
    if ($restees.Count -gt 0) {
        throw "Compilation refusée : $($restees -join ', ') défini dans ce terminal (reste d'une compilation du banc ou d'audit). Ouvrir un nouveau terminal PowerShell pour la publication."
    }
    if (-not (Test-Path $Keystore -PathType Leaf)) { throw "Clé de publication introuvable : $Keystore" }
    $motDePasse = Read-Host "Mot de passe de la clé de publication ($Alias)" -AsSecureString
    try {
        $env:NYX_ANDROID_KEYSTORE = (Resolve-Path $Keystore).Path
        $env:NYX_ANDROID_KEY_ALIAS = $Alias
        $env:NYX_ANDROID_KEYSTORE_PASSWORD = [Net.NetworkCredential]::new('', $motDePasse).Password
        # Gradle ne réécrit pas un APK qu'il juge à jour : on retire les anciens pour être sûr de vérifier les nouveaux
        Remove-Item (Join-Path $apkDir '*\release\app-*-release.apk') -ErrorAction SilentlyContinue
        & (Join-Path $PSScriptRoot 'android.ps1') build --apk --split-per-abi --target aarch64 --target armv7
        if ($LASTEXITCODE -ne 0) { throw "Compilation échouée ($LASTEXITCODE) : un mauvais mot de passe s'affiche plus haut (« keystore password was incorrect »)" }
    } finally {
        Remove-Item Env:NYX_ANDROID_KEYSTORE, Env:NYX_ANDROID_KEY_ALIAS, Env:NYX_ANDROID_KEYSTORE_PASSWORD, Env:NYX_ANDROID_KEY_PASSWORD -ErrorAction SilentlyContinue
        $motDePasse = $null
        # Le démon Gradle garde en mémoire l'environnement de la dernière compilation, mot de passe compris
        $gradlew = Join-Path $root 'src-tauri\gen\android\gradlew.bat'
        if (Test-Path $gradlew) { & $gradlew --stop *> $null }
    }
}

New-Item -ItemType Directory -Force -Path $sortie | Out-Null
$ok = $true
$apks = [ordered]@{}
foreach ($dir in @('arm64', 'arm')) {
    $nom = if ($dir -eq 'arm') { 'armv7' } else { 'arm64' }
    # Gradle nomme « -release.apk » un APK signé, « -release-unsigned.apk » un APK non signé
    $apk = Join-Path $apkDir "$dir\release\app-$dir-release.apk"
    if (-not (Test-Path $apk)) { throw "APK signé introuvable : $apk" }
    if (-not $NoBuild -and (Get-Item $apk).LastWriteTime -lt $debut) { throw "APK pas recompilé (ancien fichier) : $apk" }
    $bonneApp = Test-NomPaquet $apk
    $bonneCle = Test-Empreinte $apk
    if ($bonneApp -and $bonneCle) {
        $final = Join-Path $sortie "nyx-player-$nom-v$version.apk"
        Copy-Item $apk $final -Force
        Write-Host "Copié : $final"
        $apks[$nom] = [ordered]@{
            url = "https://releases.nyxplayer.app/nyx-player-$nom-v$version.apk"
            sha256 = (Get-FileHash $final -Algorithm SHA256).Hash.ToLowerInvariant()
            size = (Get-Item $final).Length
        }
    } else {
        $ok = $false
    }
}
if (-not $ok) { Write-Host 'Au moins un APK n''est pas la vraie app signée avec la clé de publication : ne rien diffuser.' -ForegroundColor Red; exit 1 }
# Manifeste lu par les apps Android (src/services/androidUpdate.ts) : mêmes noms que les fichiers à
# envoyer sur R2. Sans BOM : la lecture JSON de l'app n'en veut pas.
$manifeste = [ordered]@{
    version = $version
    pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ', [Globalization.CultureInfo]::InvariantCulture)
    apks = $apks
}
$cheminManifeste = Join-Path $root 'web\updates\android.json'
[IO.File]::WriteAllText($cheminManifeste, ($manifeste | ConvertTo-Json -Depth 4) + "`n", [Text.UTF8Encoding]::new($false))
Write-Host "Manifeste des apps Android écrit : $cheminManifeste (à commiter avec la version, après l'envoi des APK sur R2)."
Write-Host "APK de publication prêts dans $sortie (téléphone : arm64 ; Chromecast et box 32 bits : armv7)." -ForegroundColor Green
