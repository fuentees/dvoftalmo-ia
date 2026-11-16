[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)][int]$Port = 3000,
    [switch]$DisableAuth
)

$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskCaPath = Join-Path ([System.IO.Path]::GetTempPath()) "dvoftalmo-trusted-roots-$PID.pem"
$taskPreviousCa = $env:NODE_EXTRA_CA_CERTS
$taskPreviousAuth = $env:DISABLE_AUTH
$taskPreviousPublicAuth = $env:NEXT_PUBLIC_DISABLE_AUTH
$taskExitCode = 1

try {
    # Export only roots that Windows already trusts; TLS validation stays enabled.
    $taskRoots = @(Get-ChildItem Cert:\CurrentUser\Root, Cert:\LocalMachine\Root | Sort-Object Thumbprint -Unique)
    if ($taskRoots.Count -eq 0) { throw 'Nenhum certificado raiz confiavel foi encontrado no Windows.' }
    $taskPem = ($taskRoots | ForEach-Object {
        "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($_.RawData, [Base64FormattingOptions]::InsertLineBreaks) + "`n-----END CERTIFICATE-----"
    }) -join "`n"
    [System.IO.File]::WriteAllText($taskCaPath, $taskPem, [System.Text.UTF8Encoding]::new($false))
    $env:NODE_EXTRA_CA_CERTS = $taskCaPath
    if ($DisableAuth) {
        $env:DISABLE_AUTH = 'true'
        $env:NEXT_PUBLIC_DISABLE_AUTH = 'true'
    }
    Push-Location -LiteralPath $taskRoot
    try {
        & node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port $Port
        $taskExitCode = $LASTEXITCODE
    } finally { Pop-Location }
} finally {
    $env:NODE_EXTRA_CA_CERTS = $taskPreviousCa
    $env:DISABLE_AUTH = $taskPreviousAuth
    $env:NEXT_PUBLIC_DISABLE_AUTH = $taskPreviousPublicAuth
    if (Test-Path -LiteralPath $taskCaPath) { Remove-Item -LiteralPath $taskCaPath }
}
exit $taskExitCode
