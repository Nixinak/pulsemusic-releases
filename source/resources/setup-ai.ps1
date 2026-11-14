# Sets up Pulse Music's AI DJ completely: its brain (a 3B language model, about 2 GB) and its
# voice (Kokoro, about 330 MB), into the app's data folder. The engines that run them ship
# with the app. Run by the installer; files already there are skipped, unfinished downloads
# continue where they stopped.
# Same files and folders as src/main/aiSetup.ts and src/main/voice.ts.
param([string]$Data = (Join-Path $env:APPDATA 'Pulse Music'))

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$curl = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source

function Get-Size([string]$Url) {
  try {
    $r = Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -MaximumRedirection 10
    return [int64]("$($r.Headers['Content-Length'])" -split ',')[0]
  } catch {
    return 0
  }
}

function Get-File([string]$Url, [string]$Out, [string]$Label, [int64]$Min) {
  if ((Test-Path $Out) -and ((Get-Item $Out).Length -ge $Min)) {
    Write-Output "$Label - already downloaded"
    return
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
  $part = "$Out.part"
  $total = Get-Size $Url
  Write-Output "$Label - downloading..."
  if ($curl) {
    # -C - continues an unfinished download
    $p = Start-Process -FilePath $curl -ArgumentList @('-L', '--fail', '-s', '--retry', '5', '--retry-delay', '3', '-C', '-', '-o', "`"$part`"", "`"$Url`"") -NoNewWindow -PassThru
    $null = $p.Handle
    $shown = -10
    while (-not $p.HasExited) {
      Start-Sleep -Seconds 2
      if ($total -gt 0 -and (Test-Path $part)) {
        $have = (Get-Item $part).Length
        $pct = [math]::Floor($have * 100 / $total)
        if ($pct -ge $shown + 5) {
          $shown = $pct
          Write-Output ('{0} - {1}% ({2} of {3} MB)' -f $Label, $pct, [math]::Round($have / 1MB), [math]::Round($total / 1MB))
        }
      }
    }
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) { throw "$Label could not be downloaded (curl $($p.ExitCode))." }
  } else {
    Invoke-WebRequest -Uri $Url -OutFile $part -UseBasicParsing
  }
  if ((Get-Item $part).Length -lt $Min) { throw "$Label was incomplete." }
  Move-Item -Force $part $Out
  Write-Output "$Label - done"
}

try {
  # The DJ's voice
  $voice = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main'
  $voiceDir = Join-Path $Data 'voice-model\onnx-community\Kokoro-82M-v1.0-ONNX'
  Get-File "$voice/config.json" (Join-Path $voiceDir 'config.json') 'Voice settings' 100
  Get-File "$voice/tokenizer.json" (Join-Path $voiceDir 'tokenizer.json') 'Voice words' 1000
  Get-File "$voice/tokenizer_config.json" (Join-Path $voiceDir 'tokenizer_config.json') 'Voice words' 100
  Get-File "$voice/onnx/model.onnx" (Join-Path $voiceDir 'onnx\model.onnx') 'AI DJ voice (330 MB)' 300000000

  # The DJ's brain
  Get-File 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf' `
    (Join-Path $Data 'dj-model\Llama-3.2-3B-Instruct-Q4_K_M.gguf') 'AI DJ brain (2 GB)' 1900000000

  Write-Output 'The AI DJ is ready.'
  exit 0
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
  exit 1
}
