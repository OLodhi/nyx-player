<#
.SYNOPSIS
  Vérifie qu'une clé privée de signature Tauri et son mot de passe correspondent à la clé publique
  embarquée dans l'app (src-tauri/tauri.conf.json → plugins.updater.pubkey).

.DESCRIPTION
  La clé et le mot de passe sont saisis masqués dans ce terminal, ne sont ni affichés ni écrits sur
  le disque, et sont effacés des variables d'environnement à la fin. Le script signe un fichier
  temporaire avec `tauri signer sign`, puis compare l'identifiant de la clé qui a signé à celui de la
  clé publique de l'app. Une clé correcte avec un mauvais mot de passe échoue à la signature.

.EXAMPLE
  ./scripts/verify-updater-key.ps1

.NOTES
  -PublicKey sert seulement à tester le script avec une clé jetable.
#>
param(
  [string]$PublicKey
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent

if (-not $PublicKey) {
  $conf = Get-Content (Join-Path $projectRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
  $PublicKey = $conf.plugins.updater.pubkey
}

# Clé publique, signature : base64 d'un texte minisign (« untrusted comment » + ligne base64).
# Octets 2 à 9 de cette ligne = identifiant de la clé, en petit-boutiste.
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

function ConvertFrom-Secure([Security.SecureString]$secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$expectedId = Get-MinisignKeyId $PublicKey
Write-Host "Clé attendue par l'app : $expectedId" -ForegroundColor Cyan

$key = (ConvertFrom-Secure (Read-Host 'Colle la clé PRIVÉE puis Entrée (rien ne s''affiche)' -AsSecureString)).Trim()
$password = ConvertFrom-Secure (Read-Host 'Mot de passe de la clé (rien ne s''affiche)' -AsSecureString)

if (-not $key.StartsWith('dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWdu')) {
  Write-Host "Ce texte ne ressemble pas à une clé privée Tauri : elle commence par dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWdu" -ForegroundColor Red
  Write-Host "(une clé qui commence par dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWdu est la clé PUBLIQUE)" -ForegroundColor Yellow
  exit 1
}

$workDir = Join-Path ([IO.Path]::GetTempPath()) ("nyx-key-check-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workDir | Out-Null
$testFile = Join-Path $workDir 'check.txt'
Set-Content -Path $testFile -Value 'Nyx Player - verification de la cle de mise a jour' -Encoding ascii

try {
  $env:TAURI_SIGNING_PRIVATE_KEY = $key
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $password
  Push-Location $projectRoot
  # Un mauvais mot de passe sort en erreur sur stderr : on l'analyse au lieu d'arrêter le script.
  # La sortie ne contient que la signature (publique) ou le message d'erreur, jamais la clé.
  $ErrorActionPreference = 'Continue'
  $output = & npx tauri signer sign $testFile 2>&1 | Out-String
  $signed = $LASTEXITCODE -eq 0 -and (Test-Path "$testFile.sig")
} finally {
  $ErrorActionPreference = 'Stop'
  Pop-Location
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
  $key = $null
  $password = $null
}

try {
  if (-not $signed) {
    Write-Host ''
    Write-Host 'ÉCHEC : la signature n''a pas pu être produite.' -ForegroundColor Red
    if ($output -match '(?i)password|decrypt|wrong') {
      Write-Host 'Le mot de passe ne correspond pas à cette clé.' -ForegroundColor Yellow
    } else {
      Write-Host 'La clé semble incomplète ou mal copiée (vérifie qu''il ne manque pas de caractères).' -ForegroundColor Yellow
    }
    exit 1
  }

  $signatureId = Get-MinisignKeyId (Get-Content "$testFile.sig" -Raw)
  Write-Host ''
  if ($signatureId -eq $expectedId) {
    Write-Host "C'EST LA BONNE CLÉ ($signatureId) et le bon mot de passe." -ForegroundColor Green
    Write-Host 'Sauvegarde-la maintenant à DEUX endroits (gestionnaire de mots de passe + support hors ligne).' -ForegroundColor Green
  } else {
    Write-Host "Clé valide mais ce n'est PAS celle de l'app : elle a signé en $signatureId, l'app attend $expectedId." -ForegroundColor Red
    exit 2
  }
} finally {
  Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
}
