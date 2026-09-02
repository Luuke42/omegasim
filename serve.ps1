# Minimal static file server for the CH Control desktop app.
# Uses .NET's HttpListener, which ships with every Windows install - no Python,
# Node, or anything else needs to be installed. Binding specifically to
# "localhost" (not "+" or a real hostname) is exempt from the URL-ACL /
# admin-rights requirement HttpListener normally has on Windows, so this runs
# fine as a regular (non-admin) user with no setup prompts.

$port = 8990
$root = $PSScriptRoot

$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm'  = 'text/html; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.ico'  = 'image/x-icon'
    '.txt'  = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$port/"
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Host "Konnte Port $port nicht oeffnen: $($_.Exception.Message)"
    Write-Host "Laeuft evtl. schon ein Server? Dieses Fenster kann geschlossen werden."
    Read-Host "Enter zum Beenden druecken"
    exit 1
}

Write-Host "CH Control Server laeuft auf $prefix"
Write-Host "Dieses Fenster offen lassen, waehrend die App laeuft."
Write-Host "Zum Beenden: dieses Fenster einfach schliessen."
Write-Host ""

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
    } catch {
        break
    }
    $request = $context.Request
    $response = $context.Response

    $requestedPath = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath)
    if ($requestedPath -eq '/') { $requestedPath = '/index.html' }

    # Prevent escaping the app folder via ../ traversal.
    $safeRelative = $requestedPath.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $filePath = [System.IO.Path]::GetFullPath((Join-Path $root $safeRelative))

    if (-not $filePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $filePath -PathType Leaf)) {
        $response.StatusCode = 404
        $notFound = [System.Text.Encoding]::UTF8.GetBytes('404 - Nicht gefunden')
        $response.OutputStream.Write($notFound, 0, $notFound.Length)
        $response.OutputStream.Close()
        continue
    }

    $ext = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
    $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }

    try {
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $response.ContentType = $contentType
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
        $response.StatusCode = 500
    } finally {
        $response.OutputStream.Close()
    }
}
