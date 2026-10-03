param([string]$Destination)
$ErrorActionPreference = 'Stop'
$taskRepository = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskCli = Join-Path $taskRepository 'dist/cli.cjs'
if (-not (Test-Path -LiteralPath $taskCli -PathType Leaf)) {
  throw 'Run npm run build in the OpenAware repository first.'
}
if (-not $Destination) {
  $taskCodexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex' }
  $Destination = Join-Path $taskCodexRoot 'skills/openaware-video-workflows'
}
$taskTarget = [System.IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $taskTarget) {
  $taskItem = Get-Item -LiteralPath $taskTarget
  if (-not $taskItem.PSIsContainer -or ($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'The skill destination must be a regular directory.'
  }
}
New-Item -ItemType Directory -Path $taskTarget -Force | Out-Null
$taskScripts = Join-Path $taskTarget 'scripts'
if (Test-Path -LiteralPath $taskScripts) {
  if ((Get-Item -LiteralPath $taskScripts).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'The skill scripts destination must be a regular directory.'
  }
}
New-Item -ItemType Directory -Path $taskScripts -Force | Out-Null
foreach ($taskFile in @((Join-Path $taskTarget 'SKILL.md'),(Join-Path $taskScripts 'openaware.cjs'))) {
  if ((Test-Path -LiteralPath $taskFile) -and ((Get-Item -LiteralPath $taskFile).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Existing skill files must not be symbolic links.'
  }
}
Copy-Item -LiteralPath (Join-Path $taskRepository 'skills/openaware-video-workflows/SKILL.md') -Destination (Join-Path $taskTarget 'SKILL.md') -Force
Copy-Item -LiteralPath $taskCli -Destination (Join-Path $taskScripts 'openaware.cjs') -Force
Write-Output "Installed OpenAware skill at $taskTarget. New Codex sessions can discover it."
