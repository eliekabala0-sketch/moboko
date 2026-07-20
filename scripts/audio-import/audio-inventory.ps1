param(
  [string]$SermonPath = "D:\AUDIO\SERMENT WMB",
  [string]$PrayerLinePath = "D:\AUDIO\PREDICATION\LIGNE_DE_PRIERE_DU_PROPHETE",
  [string]$OutDir = "scripts\audio-import\reports",
  [int]$Limit = 0,
  [switch]$SkipHash,
  [switch]$SkipMetadata
)

$ErrorActionPreference = "Stop"
$audioExtensions = @(".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".wma")

function Normalize-Text([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
  $normalized = $Value.Normalize([Text.NormalizationForm]::FormD)
  $chars = New-Object System.Text.StringBuilder
  foreach ($c in $normalized.ToCharArray()) {
    if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($c) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
      [void]$chars.Append($c)
    }
  }
  return ($chars.ToString().ToLowerInvariant() -replace "[^a-z0-9]+", " ").Trim()
}

function Parse-DateFromName([string]$Name) {
  $patterns = @(
    "(?<year>19[0-9]{2}|20[0-9]{2})[-_. ](?<month>[0-1]?[0-9])[-_. ](?<day>[0-3]?[0-9])",
    "(?<day>[0-3]?[0-9])[-_. ](?<month>[0-1]?[0-9])[-_. ](?<year>19[0-9]{2}|20[0-9]{2})",
    "\b(?<year>19[0-9]{2}|20[0-9]{2})\b"
  )
  foreach ($pattern in $patterns) {
    $m = [regex]::Match($Name, $pattern)
    if ($m.Success) {
      $year = [int]$m.Groups["year"].Value
      if ($m.Groups["month"].Success -and $m.Groups["day"].Success) {
        $month = [int]$m.Groups["month"].Value
        $day = [int]$m.Groups["day"].Value
        try {
          return [pscustomobject]@{ Year = $year; Date = ([datetime]::new($year, $month, $day)).ToString("yyyy-MM-dd") }
        } catch {
          return [pscustomobject]@{ Year = $year; Date = $null }
        }
      }
      return [pscustomobject]@{ Year = $year; Date = $null }
    }
  }
  return [pscustomobject]@{ Year = $null; Date = $null }
}

function Get-ShellMetadata($File) {
  $metadata = @{
    duration = $null
    bitrate = $null
    title = $null
    artist = $null
    album = $null
    year = $null
    codec = $null
  }
  try {
    $shell = New-Object -ComObject Shell.Application
    $folder = $shell.Namespace($File.DirectoryName)
    if ($null -eq $folder) { return $metadata }
    $item = $folder.ParseName($File.Name)
    if ($null -eq $item) { return $metadata }
    for ($i = 0; $i -le 320; $i++) {
      $label = [string]$folder.GetDetailsOf($null, $i)
      $value = [string]$folder.GetDetailsOf($item, $i)
      if ([string]::IsNullOrWhiteSpace($label) -or [string]::IsNullOrWhiteSpace($value)) { continue }
      $key = Normalize-Text $label
      if ($null -eq $metadata.duration -and ($key -match "duration|length|duree")) { $metadata.duration = $value }
      elseif ($null -eq $metadata.bitrate -and ($key -match "bit rate|bitrate|debit")) { $metadata.bitrate = $value }
      elseif ($null -eq $metadata.title -and ($key -match "^title$|titre")) { $metadata.title = $value }
      elseif ($null -eq $metadata.artist -and ($key -match "artist|artiste|auteur|author")) { $metadata.artist = $value }
      elseif ($null -eq $metadata.album -and ($key -match "album")) { $metadata.album = $value }
      elseif ($null -eq $metadata.year -and ($key -match "year|annee")) { $metadata.year = $value }
      elseif ($null -eq $metadata.codec -and ($key -match "codec|compression")) { $metadata.codec = $value }
    }
  } catch {
    $metadata.metadata_error = $_.Exception.Message
  }
  return $metadata
}

function Get-InventoryRows($Root, [string]$Category) {
  if (!(Test-Path -LiteralPath $Root)) {
    throw "Chemin introuvable: $Root"
  }
  $files = Get-ChildItem -LiteralPath $Root -File -Recurse
  if ($Limit -gt 0) { $files = $files | Select-Object -First $Limit }
  $rows = New-Object System.Collections.Generic.List[object]
  $rootFull = (Get-Item -LiteralPath $Root).FullName.TrimEnd("\")
  $index = 0
  foreach ($file in $files) {
    $index++
    Write-Progress -Activity "Inventaire audio $Category" -Status $file.Name -PercentComplete (($index / [math]::Max(1, $files.Count)) * 100)
    $ext = $file.Extension.ToLowerInvariant()
    $isAudio = $audioExtensions -contains $ext
    $hash = $null
    $hashError = $null
    if ($isAudio -and !$SkipHash) {
      try { $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
      catch { $hashError = $_.Exception.Message }
    }
    $meta = if ($isAudio -and !$SkipMetadata) { Get-ShellMetadata $file } else { @{} }
    $parsedDate = Parse-DateFromName $file.BaseName
    $relative = $file.FullName.Substring($rootFull.Length).TrimStart("\")
    $embeddedTitle = if ($meta.ContainsKey("title")) { $meta.title } else { $null }
    $normalizedTitle = Normalize-Text $(if ($embeddedTitle) { $embeddedTitle } else { $file.BaseName })
    $rows.Add([pscustomobject]@{
      category = $Category
      source_root = $rootFull
      relative_path = $relative
      original_filename = $file.Name
      extension = $ext
      is_audio = $isAudio
      file_size = $file.Length
      size_mb = [math]::Round($file.Length / 1MB, 2)
      last_write_time = $file.LastWriteTimeUtc.ToString("o")
      checksum_sha256 = $hash
      hash_error = $hashError
      title_embedded = $embeddedTitle
      normalized_title = $normalizedTitle
      artist = $meta.artist
      album = $meta.album
      year_embedded = $meta.year
      sermon_year_from_name = $parsedDate.Year
      sermon_date_from_name = $parsedDate.Date
      duration_raw = $meta.duration
      bitrate_raw = $meta.bitrate
      codec_raw = $meta.codec
      import_status = if ($isAudio) { "inventoried" } else { "unsupported_format" }
    })
  }
  Write-Progress -Activity "Inventaire audio $Category" -Completed
  return $rows
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$allRows = @()
$allRows += Get-InventoryRows -Root $SermonPath -Category "sermon"
$allRows += Get-InventoryRows -Root $PrayerLinePath -Category "prayer_line"

$audioRows = $allRows | Where-Object { $_.is_audio -eq $true }
$nonAudioRows = $allRows | Where-Object { $_.is_audio -ne $true }
$exactDuplicates = $audioRows |
  Where-Object { $_.checksum_sha256 } |
  Group-Object checksum_sha256 |
  Where-Object { $_.Count -gt 1 } |
  ForEach-Object {
    [pscustomobject]@{
      checksum_sha256 = $_.Name
      count = $_.Count
      files = ($_.Group | ForEach-Object { "$($_.category):$($_.relative_path)" }) -join " | "
      total_size = ($_.Group | Measure-Object file_size -Sum).Sum
    }
  }
$probableDuplicates = $audioRows |
  Group-Object category, normalized_title |
  Where-Object { $_.Name -and $_.Count -gt 1 } |
  ForEach-Object {
    [pscustomobject]@{
      category = $_.Group[0].category
      normalized_title = $_.Group[0].normalized_title
      count = $_.Count
      files = ($_.Group | ForEach-Object { "$($_.category):$($_.relative_path)" }) -join " | "
    }
  }

$summary = [ordered]@{
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
  sermon_path = $SermonPath
  prayer_line_path = $PrayerLinePath
  total_files = $allRows.Count
  audio_files = $audioRows.Count
  non_audio_files = $nonAudioRows.Count
  sermon_files = ($allRows | Where-Object category -eq "sermon").Count
  sermon_audio_files = ($audioRows | Where-Object category -eq "sermon").Count
  sermon_total_bytes = (($allRows | Where-Object category -eq "sermon" | Measure-Object file_size -Sum).Sum)
  prayer_line_files = ($allRows | Where-Object category -eq "prayer_line").Count
  prayer_line_audio_files = ($audioRows | Where-Object category -eq "prayer_line").Count
  prayer_line_total_bytes = (($allRows | Where-Object category -eq "prayer_line" | Measure-Object file_size -Sum).Sum)
  extensions = @($allRows | Group-Object extension | Sort-Object Count -Descending | ForEach-Object { [ordered]@{ extension = $_.Name; count = $_.Count; bytes = (($_.Group | Measure-Object file_size -Sum).Sum) } })
  exact_duplicate_groups = @($exactDuplicates).Count
  probable_duplicate_groups = @($probableDuplicates).Count
  unsupported_files = @($nonAudioRows | Select-Object category, relative_path, extension, file_size)
  hash_errors = @($audioRows | Where-Object { $_.hash_error } | Select-Object category, relative_path, hash_error)
}

$prefix = Join-Path $OutDir $timestamp
$allRows | Export-Csv -LiteralPath "$prefix-audio-inventory.csv" -NoTypeInformation -Encoding UTF8
$exactDuplicates | Export-Csv -LiteralPath "$prefix-exact-duplicates.csv" -NoTypeInformation -Encoding UTF8
$probableDuplicates | Export-Csv -LiteralPath "$prefix-probable-duplicates.csv" -NoTypeInformation -Encoding UTF8
$summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$prefix-summary.json" -Encoding UTF8

Write-Host "Inventaire termine"
Write-Host "Summary: $prefix-summary.json"
Write-Host "Inventory: $prefix-audio-inventory.csv"
Write-Host "Exact duplicates: $prefix-exact-duplicates.csv"
Write-Host "Probable duplicates: $prefix-probable-duplicates.csv"
