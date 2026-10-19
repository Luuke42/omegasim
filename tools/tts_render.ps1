# Called by voice_synth.py, not run by hand. Renders a batch of phrases to 22050 Hz
# mono PCM .wav files via the Windows System.Speech voices - one process start for all
# of them, since each powershell.exe launch has its own noticeable cost.
param([string]$JobsFile)

Add-Type -AssemblyName System.Speech

$jobs = Get-Content -Raw -Encoding UTF8 $JobsFile | ConvertFrom-Json
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono)

foreach ($j in $jobs) {
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    try {
        $synth.SelectVoice($j.voice)
        $synth.Rate = $j.rate
        $synth.SetOutputToWaveFile($j.out, $fmt)
        $synth.Speak($j.text)
    } finally {
        $synth.Dispose()
    }
}
Write-Output ("gerendert: {0} Phrasen" -f $jobs.Count)
