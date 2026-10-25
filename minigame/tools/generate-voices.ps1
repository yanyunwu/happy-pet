param([Parameter(Mandatory = $true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$voiceOutput = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $voiceOutput.StartsWith($projectDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Voice output must stay inside the minigame project.' }
New-Item -ItemType Directory -Path $voiceOutput -Force | Out-Null
$spec = Get-Content -LiteralPath (Join-Path $projectDirectory 'art\woodland-voices.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $available = @($speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'zh-CN' })
  $selected = $available | Where-Object { $_.VoiceInfo.Name -eq $spec.preferredVoice } | Select-Object -First 1
  if (-not $selected) { $selected = $available | Select-Object -First 1 }
  if (-not $selected) { throw 'A local zh-CN speech synthesis voice is required.' }
  $speaker.SelectVoice($selected.VoiceInfo.Name)
  $speaker.Rate = [int]$spec.rate
  $speaker.Volume = 95
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  foreach ($clip in $spec.clips) {
    $target = Join-Path $voiceOutput ($clip.name + '.wav')
    $speaker.SetOutputToWaveFile($target, $format)
    $speaker.Speak([string]$clip.text)
    $speaker.SetOutputToNull()
  }
  [IO.File]::WriteAllText((Join-Path $voiceOutput 'voice-engine.json'), (@{ engine = 'Windows System.Speech'; voice = $selected.VoiceInfo.Name; language = 'zh-CN' } | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
  Write-Output ('Generated ' + $spec.clips.Count + ' spoken cues with ' + $selected.VoiceInfo.Name + '.')
} finally { $speaker.Dispose() }
