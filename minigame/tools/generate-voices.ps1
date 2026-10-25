param(
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [string]$PythonExecutable = $env:VOICE_PYTHON,
  [string]$PythonPackageDirectory = $env:VOICE_PYTHON_PACKAGES
)
$ErrorActionPreference = 'Stop'

# Install voice-requirements.txt explicitly into a virtual environment or an owned
# --target directory. This wrapper never installs packages or substitutes a voice.
$pythonArguments = @()
if ($PythonExecutable) {
  $pythonCommand = $PythonExecutable
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
  $pythonCommand = 'py'
  $pythonArguments += '-3'
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $pythonCommand = 'python'
} else {
  throw 'Python 3.10+ is required. Set VOICE_PYTHON to its executable path.'
}
$pythonArguments += @('-u', (Join-Path $PSScriptRoot 'generate-voices.py'), '--output-directory', $OutputDirectory)
if ($PythonPackageDirectory) {
  $pythonArguments += @('--python-package-directory', $PythonPackageDirectory)
}
& $pythonCommand @pythonArguments
if ($LASTEXITCODE -ne 0) { throw 'Neural voice generation failed; no desktop voice fallback was used.' }
