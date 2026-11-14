# Publishes the built installer to GitHub Releases (Nixinak/pulsemusic-releases) in one go:
# creates the release for the version in package.json, then uploads the installer, its
# blockmap and latest.yml (which installed apps read to find updates).
# electron-builder's own publishing can create the release twice at once and fail, so this
# does it step by step. Needs $env:GH_TOKEN (a token with the "repo" scope).
# Release notes: release-notes.md in the project folder, when it exists.
param([string]$Dir = 'release')

$ErrorActionPreference = 'Stop'
$repo = 'Nixinak/pulsemusic-releases'
if (-not $env:GH_TOKEN) { throw 'Set GH_TOKEN first (a GitHub token with the "repo" scope).' }
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$tag = "v$version"
$headers = @{ Authorization = "Bearer $($env:GH_TOKEN)"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }

$files = @('PulseMusic-Setup.exe', 'PulseMusic-Setup.exe.blockmap', 'latest.yml') | ForEach-Object { Join-Path $Dir $_ }
foreach ($f in $files) { if (-not (Test-Path $f)) { throw "Missing $f - build first." } }

# read as a plain string (Get-Content adds file info that ConvertTo-Json would send along)
$notes = if (Test-Path 'release-notes.md') { [IO.File]::ReadAllText((Resolve-Path 'release-notes.md'), [Text.Encoding]::UTF8) } else { "Pulse Music $version" }

# The release (reuse it when it already exists, e.g. after a failed upload)
$release = $null
try { $release = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" } catch {}
if (-not $release) {
  Write-Output "Creating release $tag..."
  $body = @{ tag_name = $tag; name = "Pulse Music $version"; body = [string]$notes; draft = $false; prerelease = $false } | ConvertTo-Json
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  $release = Invoke-RestMethod -Method Post -Headers $headers -Uri "https://api.github.com/repos/$repo/releases" -Body $bytes -ContentType 'application/json; charset=utf-8'
} else {
  Write-Output "Release $tag exists, updating its files..."
}

foreach ($f in $files) {
  $name = Split-Path $f -Leaf
  $old = $release.assets | Where-Object { $_.name -eq $name }
  if ($old) { Invoke-RestMethod -Method Delete -Headers $headers -Uri "https://api.github.com/repos/$repo/releases/assets/$($old.id)" | Out-Null }
  Write-Output "Uploading $name ($([math]::Round((Get-Item $f).Length / 1MB)) MB)..."
  Invoke-RestMethod -Method Post -Headers $headers -Uri "https://uploads.github.com/repos/$repo/releases/$($release.id)/assets?name=$name" -InFile $f -ContentType 'application/octet-stream' | Out-Null
}
Write-Output "Done: https://github.com/$repo/releases/tag/$tag"
