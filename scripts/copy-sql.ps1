<#
.SYNOPSIS
  Copy a migration (or any project SQL file) to the clipboard as real UTF-8.

.DESCRIPTION
  PowerShell's built-in file reader takes a file with no byte-order mark to be
  in the system ANSI code page, so a UTF-8 migration containing a pound sign or
  an em dash arrives on the clipboard already mangled -- and is then pasted into
  the SQL editor and stored that way, so the application prints the mangling.
  The fix is one flag, which is exactly the kind of thing that gets forgotten,
  so this script is the way to copy a file and the flag lives in here.

.EXAMPLE
  .\scripts\copy-sql.ps1 20260902340000_dashboard_interaction.sql
  .\scripts\copy-sql.ps1 check-applied
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string] $Name
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# A bare name, a name without .sql, or a path -- all resolve.
$candidates = @(
  $Name,
  "$Name.sql",
  (Join-Path $root "supabase\migrations\$Name"),
  (Join-Path $root "supabase\migrations\$Name.sql"),
  (Join-Path $root "supabase\$Name"),
  (Join-Path $root "supabase\$Name.sql")
)

$path = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1

if (-not $path) {
  Write-Host "No such file: $Name" -ForegroundColor Red
  Write-Host "Migrations available:"
  Get-ChildItem (Join-Path $root 'supabase\migrations') -Filter *.sql |
    Select-Object -Last 12 |
    ForEach-Object { Write-Host "  $($_.Name)" }
  exit 1
}

# The whole point: read as UTF-8 whatever the system code page says.
$text = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $path), [System.Text.Encoding]::UTF8)
Set-Clipboard -Value $text

$name = Split-Path -Leaf $path
$lines = ($text -split "`n").Count
Write-Host "Copied $name ($lines lines) as UTF-8." -ForegroundColor Green
Write-Host "Paste it into the Supabase SQL editor and Run."
