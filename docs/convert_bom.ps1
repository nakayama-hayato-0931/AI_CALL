$srcPath = Join-Path $PSScriptRoot "create_pptx.ps1"
$content = [System.IO.File]::ReadAllText($srcPath, [System.Text.Encoding]::UTF8)
$bomEncoding = New-Object System.Text.UTF8Encoding $true
[System.IO.File]::WriteAllText($srcPath, $content, $bomEncoding)
Write-Host "BOM added to $srcPath"
