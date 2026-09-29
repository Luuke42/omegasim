# Die vier Signier-Secrets fuer .github/workflows/android.yml setzen.
#
#   gh auth login                       (einmal)
#   powershell -ExecutionPolicy Bypass -File tools\android_secrets.ps1
#
# Liest den Schluessel aus %USERPROFILE%\.omegasim-android (dort erzeugt, NICHT im Repo) und
# schreibt ihn in die Secrets des Repos LukasRoeseler/btsr. Die Werte erscheinen nirgends auf
# dem Bildschirm.
#
# DEN ORDNER SICHERN (etwa in KeePassXC): geht der Schluessel verloren, laesst sich die
# installierte App nie mehr durch eine neue APK aktualisieren - nur deinstallieren, und dann
# sind alle Einstellungen weg.
$ErrorActionPreference = 'Stop'
$ordner = Join-Path $env:USERPROFILE '.omegasim-android'
$props = @{}
Get-Content (Join-Path $ordner 'keystore.properties') | ForEach-Object {
    if ($_ -match '^(\w+)=(.*)$') { $props[$Matches[1]] = $Matches[2] }
}
$repo = 'LukasRoeseler/btsr'
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $ordner 'omegasim-release.jks')))
$b64 | gh secret set ANDROID_KEYSTORE_B64 --repo $repo
$props['storePassword'] | gh secret set ANDROID_KEYSTORE_PASSWORD --repo $repo
$props['keyAlias'] | gh secret set ANDROID_KEY_ALIAS --repo $repo
$props['keyPassword'] | gh secret set ANDROID_KEY_PASSWORD --repo $repo
Write-Host 'Vier Secrets gesetzt. Eine APK entsteht beim naechsten Tag apk-v<Version>.'
