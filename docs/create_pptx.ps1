# ============================================
# AI CallCenter CRM 説明資料 PPTX生成スクリプト
# PowerShell + Office Open XML (ZIP/XML)で直接生成
# ============================================

$ErrorActionPreference = "Stop"

# 出力先
$outputPath = "$PSScriptRoot\AI_CallCenter_CRM_説明資料.pptx"
$tempDir = "$env:TEMP\pptx_build_$(Get-Random)"

# 色定義 (Midnight Executive + Teal Trust)
$navy = "1E2761"
$teal = "028090"
$white = "FFFFFF"
$lightBg = "F0F4F8"
$darkText = "1E293B"
$grayText = "64748B"
$mint = "02C39A"
$accent = "3B82F6"

# EMU変換 (1 inch = 914400 EMU)
function Inch([double]$val) { [int]($val * 914400) }
function Pt([double]$val) { [int]($val * 100) }

# ============================================
# ディレクトリ構造作成
# ============================================
$dirs = @(
    "$tempDir\_rels",
    "$tempDir\docProps",
    "$tempDir\ppt\_rels",
    "$tempDir\ppt\slideLayouts\_rels",
    "$tempDir\ppt\slideMasters\_rels",
    "$tempDir\ppt\slides\_rels",
    "$tempDir\ppt\theme"
)
foreach ($d in $dirs) { New-Item -ItemType Directory -Path $d -Force | Out-Null }

# ============================================
# [Content_Types].xml
# ============================================
$slideCount = 17
$ctSlides = ""
for ($i = 1; $i -le $slideCount; $i++) {
    $ctSlides += "  <Override PartName=`"/ppt/slides/slide$i.xml`" ContentType=`"application/vnd.openxmlformats-officedocument.presentationml.slide+xml`"/>`n"
}

@"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
$ctSlides</Types>
"@ | Out-File -LiteralPath "$tempDir\[Content_Types].xml" -Encoding UTF8

# ============================================
# _rels/.rels
# ============================================
@"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"@ | Out-File -FilePath "$tempDir\_rels\.rels" -Encoding UTF8

# ============================================
# docProps
# ============================================
@"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>AI CallCenter CRM 説明資料</dc:title>
  <dc:creator>AI CallCenter Team</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">$(Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")</dcterms:created>
</cp:coreProperties>
"@ | Out-File -FilePath "$tempDir\docProps\core.xml" -Encoding UTF8

@"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>AI CallCenter CRM</Application>
  <Slides>$slideCount</Slides>
</Properties>
"@ | Out-File -FilePath "$tempDir\docProps\app.xml" -Encoding UTF8

# ============================================
# Theme
# ============================================
@"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="CallCenterTheme">
  <a:themeElements>
    <a:clrScheme name="CallCenter">
      <a:dk1><a:srgbClr val="1E293B"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1E2761"/></a:dk2>
      <a:lt2><a:srgbClr val="F0F4F8"/></a:lt2>
      <a:accent1><a:srgbClr val="028090"/></a:accent1>
      <a:accent2><a:srgbClr val="02C39A"/></a:accent2>
      <a:accent3><a:srgbClr val="3B82F6"/></a:accent3>
      <a:accent4><a:srgbClr val="F59E0B"/></a:accent4>
      <a:accent5><a:srgbClr val="EF4444"/></a:accent5>
      <a:accent6><a:srgbClr val="8B5CF6"/></a:accent6>
      <a:hlink><a:srgbClr val="028090"/></a:hlink>
      <a:folHlink><a:srgbClr val="64748B"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="CallCenter">
      <a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>
"@ | Out-File -FilePath "$tempDir\ppt\theme\theme1.xml" -Encoding UTF8

# ============================================
# Slide Master & Layout
# ============================================
@"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>
"@ | Out-File -FilePath "$tempDir\ppt\slideMasters\slideMaster1.xml" -Encoding UTF8

@"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>
"@ | Out-File -FilePath "$tempDir\ppt\slideMasters\_rels\slideMaster1.xml.rels" -Encoding UTF8

@"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" type="blank">
  <p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
</p:sldLayout>
"@ | Out-File -FilePath "$tempDir\ppt\slideLayouts\slideLayout1.xml" -Encoding UTF8

@"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>
"@ | Out-File -FilePath "$tempDir\ppt\slideLayouts\_rels\slideLayout1.xml.rels" -Encoding UTF8

# ============================================
# Presentation.xml
# ============================================
$sldIdListXml = ""
for ($i = 1; $i -le $slideCount; $i++) {
    $sldIdListXml += "    <p:sldId id=`"$($255 + $i)`" r:id=`"rId$($i + 1)`"/>`n"
}

@"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" saveSubsetFonts="1">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>
$sldIdListXml  </p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>
"@ | Out-File -FilePath "$tempDir\ppt\presentation.xml" -Encoding UTF8

# ppt/_rels/presentation.xml.rels
$presRels = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
"@
for ($i = 1; $i -le $slideCount; $i++) {
    $presRels += "  <Relationship Id=`"rId$($i + 1)`" Type=`"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide`" Target=`"slides/slide$i.xml`"/>`n"
}
$presRels += "  <Relationship Id=`"rId100`" Type=`"http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme`" Target=`"theme/theme1.xml`"/>`n</Relationships>"
$presRels | Out-File -FilePath "$tempDir\ppt\_rels\presentation.xml.rels" -Encoding UTF8

# ============================================
# スライドヘルパー関数
# ============================================

# テキストボックスXML生成
function TextBox {
    param([string]$text, [double]$x, [double]$y, [double]$w, [double]$h,
          [int]$fontSize = 1400, [string]$color = "1E293B", [string]$align = "l",
          [switch]$bold, [string]$fontFace = "Calibri", [string]$valign = "t", [int]$id = 2)
    $boldXml = if ($bold) { ' b="1"' } else { '' }
    $anchorMap = @{ "t" = "t"; "m" = "ctr"; "b" = "b" }
    $anchor = $anchorMap[$valign]
    @"
      <p:sp>
        <p:nvSpPr><p:cNvPr id="$id" name="TextBox$id"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="$(Inch $x)" y="$(Inch $y)"/><a:ext cx="$(Inch $w)" cy="$(Inch $h)"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square" anchor="$anchor" lIns="91440" tIns="45720" rIns="91440" bIns="45720"/>
          <a:p><a:pPr algn="$align"/><a:r><a:rPr lang="ja-JP" sz="$fontSize" dirty="0"$boldXml><a:solidFill><a:srgbClr val="$color"/></a:solidFill><a:latin typeface="$fontFace"/><a:ea typeface="Meiryo UI"/></a:rPr><a:t>$([System.Security.SecurityElement]::Escape($text))</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
"@
}

# 塗りつぶし矩形
function FilledRect {
    param([double]$x, [double]$y, [double]$w, [double]$h, [string]$fillColor, [int]$id = 50)
    @"
      <p:sp>
        <p:nvSpPr><p:cNvPr id="$id" name="Rect$id"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="$(Inch $x)" y="$(Inch $y)"/><a:ext cx="$(Inch $w)" cy="$(Inch $h)"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="$fillColor"/></a:solidFill><a:ln><a:noFill/></a:ln>
        </p:spPr>
      </p:sp>
"@
}

# 複数行テキスト
function MultiLineText {
    param([string[]]$lines, [double]$x, [double]$y, [double]$w, [double]$h,
          [int]$fontSize = 1400, [string]$color = "1E293B", [string]$align = "l",
          [switch]$bold, [switch]$bullet, [int]$id = 2)
    $boldXml = if ($bold) { ' b="1"' } else { '' }
    $parasXml = ""
    foreach ($line in $lines) {
        $bulletXml = if ($bullet) { '<a:buChar char="&#x2022;"/>' } else { '<a:buNone/>' }
        $parasXml += @"
          <a:p><a:pPr algn="$align" marL="228600" indent="-228600">$bulletXml</a:pPr><a:r><a:rPr lang="ja-JP" sz="$fontSize" dirty="0"$boldXml><a:solidFill><a:srgbClr val="$color"/></a:solidFill><a:latin typeface="Calibri"/><a:ea typeface="Meiryo UI"/></a:rPr><a:t>$([System.Security.SecurityElement]::Escape($line))</a:t></a:r></a:p>
"@
    }
    @"
      <p:sp>
        <p:nvSpPr><p:cNvPr id="$id" name="ML$id"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="$(Inch $x)" y="$(Inch $y)"/><a:ext cx="$(Inch $w)" cy="$(Inch $h)"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square" anchor="t" lIns="91440" tIns="45720" rIns="91440" bIns="45720"/>
          $parasXml
        </p:txBody>
      </p:sp>
"@
}

# スライドXML完成
function MakeSlide {
    param([string]$bodyXml, [int]$slideNum)
    $xml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
$bodyXml
    </p:spTree>
  </p:cSld>
</p:sld>
"@
    $xml | Out-File -FilePath "$tempDir\ppt\slides\slide$slideNum.xml" -Encoding UTF8

    @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>
"@ | Out-File -FilePath "$tempDir\ppt\slides\_rels\slide$slideNum.xml.rels" -Encoding UTF8
}

# ============================================
# SLIDE 1: 表紙
# ============================================
$s1 = (FilledRect 0 0 13.33 7.5 $navy -id 50)
$s1 += (FilledRect 0 0 0.15 7.5 $teal -id 51)
$s1 += (TextBox "AI CallCenter CRM" 1.0 1.8 11 1.2 -fontSize 4000 -color $white -align "ctr" -bold -id 2)
$s1 += (TextBox "法人営業向け AI コールセンター管理システム" 1.0 3.2 11 0.6 -fontSize 2000 -color "94A3B8" -align "ctr" -id 3)
$s1 += (FilledRect 5.5 4.0 2.3 0.04 $teal -id 52)
$s1 += (TextBox "架電効率向上  |  営業案件管理  |  AI通話評価  |  営業教育" 1.0 4.4 11 0.5 -fontSize 1200 -color "94A3B8" -align "ctr" -id 4)
$s1 += (TextBox "Confidential  |  $(Get-Date -Format 'yyyy.MM')" 1.0 6.5 11 0.4 -fontSize 1000 -color "64748B" -align "ctr" -id 5)
MakeSlide $s1 1

# ============================================
# SLIDE 2: システム概要と目的
# ============================================
$s2 = (FilledRect 0 0 13.33 1.2 $navy -id 50)
$s2 += (TextBox "システム概要と目的" 0.7 0.25 11 0.7 -fontSize 2400 -color $white -bold -id 2)
$s2 += (TextBox "AIコールセンターCRMは、法人営業における架電業務を効率化し、AI技術を活用して営業品質を向上させるシステムです。" 0.7 1.6 12 0.7 -fontSize 1400 -color $grayText -id 3)

# 4つの目的カード
$purposes = @(
    @{ title = "架電効率向上"; desc = "業種別ゴールデンタイムに基づく自動架電リスト生成、リコール管理で架電効率を最大化"; color = $teal },
    @{ title = "営業案件管理"; desc = "架電から案件化、面接、採用までのパイプラインを一元管理。ステータス追跡で漏れを防止"; color = $accent },
    @{ title = "AI通話評価"; desc = "OpenAI GPT-4による6項目100点満点の通話品質自動評価。良い点・改善点を即座にフィードバック"; color = $mint },
    @{ title = "営業教育"; desc = "AI評価データの蓄積により、オペレーター個人の強み・弱みを可視化し、教育に活用"; color = "8B5CF6" }
)
for ($i = 0; $i -lt 4; $i++) {
    $cx = 0.7 + ($i * 3.0)
    $p = $purposes[$i]
    $s2 += (FilledRect $cx 2.8 2.7 2.5 "F8FAFC" -id (60+$i))
    $s2 += (FilledRect $cx 2.8 2.7 0.08 $p.color -id (70+$i))
    $s2 += (TextBox $p.title ($cx + 0.2) 3.1 2.3 0.5 -fontSize 1600 -color $darkText -bold -id (10+$i))
    $s2 += (TextBox $p.desc ($cx + 0.2) 3.6 2.3 1.5 -fontSize 1100 -color $grayText -id (20+$i))
}
MakeSlide $s2 2

# ============================================
# SLIDE 3: 技術スタック
# ============================================
$s3 = (FilledRect 0 0 13.33 1.2 $navy -id 50)
$s3 += (TextBox "技術スタック" 0.7 0.25 11 0.7 -fontSize 2400 -color $white -bold -id 2)

$techs = @(
    @{ cat = "Frontend"; tech = "Next.js 14 / React 18"; sub = "Tailwind CSS, Recharts" },
    @{ cat = "Backend"; tech = "Node.js / Express"; sub = "REST API, JWT認証" },
    @{ cat = "Database"; tech = "MySQL 8"; sub = "プリペアドステートメント" },
    @{ cat = "AI"; tech = "OpenAI API (GPT-4)"; sub = "通話品質自動評価" },
    @{ cat = "電話"; tech = "Zoom Phone"; sub = "zoomphone://プロトコル" },
    @{ cat = "連携"; tech = "Google Sheets API"; sub = "通話ログ検索・連携" }
)
for ($i = 0; $i -lt 6; $i++) {
    $row = [math]::Floor($i / 3)
    $col = $i % 3
    $cx = 0.7 + ($col * 4.0)
    $cy = 1.8 + ($row * 2.3)
    $t = $techs[$i]
    $s3 += (FilledRect $cx $cy 3.6 1.9 "F8FAFC" -id (60+$i))
    $s3 += (FilledRect $cx $cy 0.1 1.9 $teal -id (70+$i))
    $s3 += (TextBox $t.cat ($cx + 0.3) ($cy + 0.15) 3.0 0.4 -fontSize 1100 -color $teal -bold -id (10+$i))
    $s3 += (TextBox $t.tech ($cx + 0.3) ($cy + 0.55) 3.0 0.5 -fontSize 1500 -color $darkText -bold -id (20+$i))
    $s3 += (TextBox $t.sub ($cx + 0.3) ($cy + 1.1) 3.0 0.5 -fontSize 1100 -color $grayText -id (30+$i))
}
MakeSlide $s3 3

# ============================================
# SLIDE 4: システム構成図
# ============================================
$s4 = (FilledRect 0 0 13.33 1.2 $navy -id 50)
$s4 += (TextBox "システム構成図" 0.7 0.25 11 0.7 -fontSize 2400 -color $white -bold -id 2)

# ブラウザ
$s4 += (FilledRect 1.0 2.0 3.0 1.5 "EFF6FF" -id 60)
$s4 += (TextBox "Frontend" 1.0 2.1 3.0 0.4 -fontSize 1200 -color $accent -bold -align "ctr" -id 10)
$s4 += (TextBox "Next.js / React`nTailwind CSS" 1.0 2.5 3.0 0.8 -fontSize 1100 -color $darkText -align "ctr" -id 11)

# API
$s4 += (FilledRect 5.0 2.0 3.0 1.5 "F0FDF4" -id 61)
$s4 += (TextBox "Backend API" 5.0 2.1 3.0 0.4 -fontSize 1200 -color $mint -bold -align "ctr" -id 12)
$s4 += (TextBox "Express.js`nJWT / Helmet" 5.0 2.5 3.0 0.8 -fontSize 1100 -color $darkText -align "ctr" -id 13)

# DB
$s4 += (FilledRect 9.2 2.0 3.0 1.5 "FFF7ED" -id 62)
$s4 += (TextBox "Database" 9.2 2.1 3.0 0.4 -fontSize 1200 -color "F59E0B" -bold -align "ctr" -id 14)
$s4 += (TextBox "MySQL 8`n7テーブル" 9.2 2.5 3.0 0.8 -fontSize 1100 -color $darkText -align "ctr" -id 15)

# 矢印テキスト
$s4 += (TextBox "REST API ---->" 4.05 2.5 1.0 0.4 -fontSize 1000 -color $grayText -align "ctr" -id 16)
$s4 += (TextBox "SQL ---->" 8.1 2.5 1.2 0.4 -fontSize 1000 -color $grayText -align "ctr" -id 17)

# 外部サービス
$extServices = @(
    @{ name = "OpenAI API"; desc = "GPT-4 通話評価"; x = 1.0 },
    @{ name = "Zoom Phone"; desc = "電話発信"; x = 4.5 },
    @{ name = "Google Sheets"; desc = "通話ログ連携"; x = 8.0 }
)
foreach ($es in $extServices) {
    $s4 += (FilledRect $es.x 4.5 3.0 1.2 "F8FAFC" -id ([int](80 + $es.x)))
    $s4 += (TextBox $es.name $es.x 4.6 3.0 0.4 -fontSize 1200 -color $teal -bold -align "ctr" -id ([int](90 + $es.x)))
    $s4 += (TextBox $es.desc $es.x 5.0 3.0 0.4 -fontSize 1100 -color $grayText -align "ctr" -id ([int](100 + $es.x)))
}
$s4 += (TextBox "| 外部サービス連携 |" 5.0 3.9 3.0 0.4 -fontSize 1000 -color $grayText -align "ctr" -id 40)
MakeSlide $s4 4

# ============================================
# SLIDE 5: ログイン画面
# ============================================
$s5 = (FilledRect 0 0 13.33 1.2 $navy -id 50)
$s5 += (TextBox "ログイン画面" 0.7 0.25 11 0.7 -fontSize 2400 -color $white -bold -id 2)

# 画面モック
$s5 += (FilledRect 3.5 1.8 6.0 4.8 "F1F5F9" -id 60)
$s5 += (FilledRect 4.5 2.3 4.0 3.8 $white -id 61)
$s5 += (TextBox "AI CallCenter CRM" 4.5 2.5 4.0 0.5 -fontSize 1600 -color $darkText -bold -align "ctr" -id 10)
$s5 += (FilledRect 5.0 3.2 3.0 0.35 "F8FAFC" -id 62)
$s5 += (TextBox "admin@example.com" 5.1 3.22 2.8 0.3 -fontSize 1000 -color $grayText -id 11)
$s5 += (FilledRect 5.0 3.75 3.0 0.35 "F8FAFC" -id 63)
$s5 += (TextBox "**********" 5.1 3.77 2.8 0.3 -fontSize 1000 -color $grayText -id 12)
$s5 += (FilledRect 5.0 4.3 3.0 0.4 $accent -id 64)
$s5 += (TextBox "ログイン" 5.0 4.32 3.0 0.35 -fontSize 1200 -color $white -bold -align "ctr" -id 13)

# 説明
$s5 += (MultiLineText @("JWT認証によるセキュアなログイン", "ロール: admin / manager / operator", "bcryptパスワードハッシュ化", "ログイン試行回数制限 (15分/10回)") 0.5 1.8 3.0 3.0 -fontSize 1200 -color $darkText -bullet -id 30)
MakeSlide $s5 5

# ============================================
# SLIDE 6: ダッシュボード画面
# ============================================
$s6 = (FilledRect 0 0 13.33 1.2 $navy -id 50)
$s6 += (TextBox "ダッシュボード画面" 0.7 0.25 11 0.7 -fontSize 2400 -color $white -bold -id 2)

# KPIカード7つ
$kpis = @(
    @{ label = "稼働時間"; value = "247分"; color = $accent },
    @{ label = "コール数"; value = "68"; color = $accent },
    @{ label = "リコール獲得"; value = "12"; color = $mint },
    @{ label = "リコール消化"; value = "8"; color = $mint },
    @{ label = "有効接続"; value = "23"; color = "F59E0B" },
    @{ label = "担当接続"; value = "15"; color = "8B5CF6" },
    @{ label = "案件獲得"; value = "3"; color = "EF4444" }
)
for ($i = 0; $i -lt 7; $i++) {
    $cx = 0.4 + ($i * 1.75)
    $k = $kpis[$i]
    $s6 += (FilledRect $cx 1.6 1.55 1.1 $white -id (60+$i))
    $s6 += (TextBox $k.label ($cx + 0.1) 1.65 1.35 0.3 -fontSize 900 -color $grayText -id (10+$i))
    $s6 += (TextBox $k.value ($cx + 0.1) 1.95 1.35 0.6 -fontSize 2200 -color $k.color -bold -id (20+$i))
}

# グラフ説明
$s6 += (FilledRect 0.4 3.1 5.9 3.5 $white -id 80)
$s6 += (TextBox "時間帯別コール数" 0.6 3.2 5.5 0.4 -fontSize 1200 -color $darkText -bold -id 30)
$s6 += (TextBox "[棒グラフ] 9時〜19時の各時間帯ごとのコール数を表示。ゴールデンタイムの15時台が最多。ピーク時間帯を把握し架電計画に活用。" 0.6 3.7 5.5 2.5 -fontSize 1100 -color $grayText -id 31)

$s6 += (FilledRect 6.7 3.1 5.9 3.5 $white -id 81)
$s6 += (TextBox "業種別案件化率" 6.9 3.2 5.5 0.4 -fontSize 1200 -color $darkText -bold -id 32)
$s6 += (TextBox "[円グラフ] 飲食4.2% / 製造3.8% / 小売2.5% / IT5.1% 各業種の架電数に対する案件化率をリアルタイムで表示。" 6.9 3.7 5.5 2.5 -fontSize 1100 -color $grayText -id 33)
MakeSlide $s6 6

# ============================================
# SLIDE 7: 架電画面
# ============================================
$s7 = (FilledRect 0 0 13.33 1.2 $navy -id 50)
$s7 += (TextBox "架電画面 - 3カラムレイアウト" 0.7 0.25 11 0.7 -fontSize 2400 -color $white -bold -id 2)

# 左カラム
$s7 += (FilledRect 0.4 1.6 3.8 5.2 $white -id 60)
$s7 += (FilledRect 0.4 1.6 3.8 0.06 $teal -id 70)
$s7 += (TextBox "企業情報" 0.6 1.75 3.4 0.4 -fontSize 1400 -color $darkText -bold -id 10)
$s7 += (MultiLineText @("企業名: 株式会社レストランA","電話番号: 03-1234-5001","業種: 飲食","地域: 東京","---","[前回履歴]","03/08 14:30 RECALL","担当者不在。15時以降に再架電希望") 0.6 2.3 3.4 4.2 -fontSize 1000 -color $grayText -id 11)

# 中央カラム
$s7 += (FilledRect 4.5 1.6 3.8 5.2 $white -id 61)
$s7 += (TextBox "03-1234-5001" 4.5 2.0 3.8 0.5 -fontSize 1800 -color $darkText -bold -align "ctr" -id 12)
$s7 += (TextBox "株式会社レストランA" 4.5 2.5 3.8 0.4 -fontSize 1100 -color $grayText -align "ctr" -id 13)
$s7 += (FilledRect 5.5 3.2 1.8 1.8 $mint -id 71)
$s7 += (TextBox "架電開始" 5.5 3.7 1.8 0.7 -fontSize 1400 -color $white -bold -align "ctr" -valign "m" -id 14)
$s7 += (TextBox "Zoom Phoneが自動起動" 4.5 5.3 3.8 0.3 -fontSize 900 -color $grayText -align "ctr" -id 15)

# 右カラム
$s7 += (FilledRect 8.6 1.6 4.3 5.2 $white -id 62)
$s7 += (FilledRect 8.6 1.6 4.3 0.06 "EF4444" -id 72)
$s7 += (TextBox "結果入力" 8.8 1.75 4.0 0.4 -fontSize 1400 -color $darkText -bold -id 16)
$s7 += (MultiLineText @("[不通] [NG] [リコール] [興味あり] [案件化]","","[v] 有効接続  [v] 担当者接続","","リコール日時: 2024/03/09 15:00","メモ: 人事部の山田様と通話。","来週月曜に再度ご連絡する約束。","","[保存して次へ]") 8.8 2.3 4.0 4.2 -fontSize 1000 -color $grayText -id 17)
MakeSlide $s7 7

# ============================================
# SLIDE 8: 自動架電リスト
# ============================================
$s8 = (FilledRect 0 0 13.33 1.2 $navy -id 50)
$s8 += (TextBox "自動架電リスト - ゴールデンタイム" 0.7 0.25 11 0.7 -fontSize 2400 -color $white -bold -id 2)

# ゴールデンタイム表
$s8 += (FilledRect 0.5 1.6 5.5 2.8 $white -id 60)
$s8 += (TextBox "業種別ゴールデンタイム" 0.7 1.7 5.0 0.4 -fontSize 1400 -color $darkText -bold -id 10)
$s8 += (MultiLineText @("飲食:  10:00-11:30 / 15:00-17:00","製造:   9:00-11:00 / 14:00-16:00","小売:  11:00-13:00 / 16:00-18:00") 0.7 2.3 5.0 2.0 -fontSize 1200 -color $darkText -id 11)

# 優先順位
$s8 += (FilledRect 6.5 1.6 6.0 2.8 $white -id 61)
$s8 += (TextBox "架電優先順位ロジック" 6.7 1.7 5.5 0.4 -fontSize 1400 -color $darkText -bold -id 12)
$priorities = @("1. リコール期限到来 (最優先)","2. ゴールデンタイム一致企業","3. 未接触企業","4. 前回不通 (2時間以上経過)")
$s8 += (MultiLineText $priorities 6.7 2.3 5.5 2.0 -fontSize 1200 -color $darkText -id 13)

# フロー説明
$s8 += (FilledRect 0.5 4.8 12.0 1.8 "F8FAFC" -id 62)
$s8 += (TextBox "架電フロー" 0.7 4.9 11.5 0.4 -fontSize 1400 -color $teal -bold -id 20)
$s8 += (TextBox "自動で次の企業を選定 --> 企業情報表示 --> 架電開始(Zoom Phone) --> 結果入力 --> 保存 --> 次の企業を自動表示" 0.7 5.4 11.5 0.8 -fontSize 1200 -color $darkText -id 21)
MakeSlide $s8 8

# ============================================
# SLIDE 9: リコール管理
# ============================================
$s9 = (FilledRect 0 0 13.33 1.2 $navy -id 50)
$s9 += (TextBox "リコール管理画面" 0.7 0.25 11 0.7 -fontSize 2400 -color $white -bold -id 2)

# 3タブ
$tabs = @(
    @{ label = "今日 (5)"; color = $accent; x = 0.5 },
    @{ label = "明日 (3)"; color = "F59E0B"; x = 2.5 },
    @{ label = "期限超過 (2)"; color = "EF4444"; x = 4.5 }
)
foreach ($tab in $tabs) {
    $s9 += (FilledRect $tab.x 1.5 1.8 0.45 $tab.color -id ([int](60 + $tab.x)))
    $s9 += (TextBox $tab.label $tab.x 1.52 1.8 0.4 -fontSize 1100 -color $white -bold -align "ctr" -id ([int](10 + $tab.x)))
}

# テーブル
$s9 += (FilledRect 0.5 2.2 12.0 0.5 "F1F5F9" -id 65)
$s9 += (TextBox "リコール日時     |  企業名                |  電話番号         |  業種    |  前回メモ                    |  操作" 0.7 2.25 11.5 0.4 -fontSize 1000 -color $grayText -bold -id 20)

$rows = @(
    "03/09 10:00  |  株式会社レストランA  |  03-1234-5001  |  飲食  |  担当者不在。15時以降に      |  [完了] [取消]",
    "03/09 14:00  |  有限会社ファクトリーB  |  06-2345-6002  |  製造  |  資料送付後に再連絡          |  [完了] [取消]",
    "03/09 15:30  |  株式会社ショップC      |  052-345-7003  |  小売  |  部長に確認後折返し予定      |  [完了] [取消]"
)
for ($i = 0; $i -lt $rows.Count; $i++) {
    $ry = 2.8 + ($i * 0.55)
    $s9 += (FilledRect 0.5 $ry 12.0 0.5 $white -id (70+$i))
    $s9 += (TextBox $rows[$i] 0.7 ($ry + 0.05) 11.5 0.4 -fontSize 1000 -color $darkText -id (30+$i))
}

$s9 += (TextBox "リコールを消化すると自動的にステータスが更新され、架電リストの優先順位も調整されます。" 0.5 5.5 12.0 0.5 -fontSize 1100 -color $grayText -id 40)
MakeSlide $s9 9

# ============================================
# SLIDE 10: 案件管理画面
# ============================================
$s10 = (FilledRect 0 0 13.33 1.2 $navy -id 50)
$s10 += (TextBox "案件管理画面" 0.7 0.25 11 0.7 -fontSize 2400 -color $white -bold -id 2)

# ステータスフロー
$statuses = @(
    @{ label = "NEW"; color = $accent },
    @{ label = "MAIL_SENT"; color = "F59E0B" },
    @{ label = "INTERVIEW_SET"; color = "8B5CF6" },
    @{ label = "INTERVIEW_DONE"; color = "6366F1" },
    @{ label = "WAITING_RESULT"; color = "F97316" },
    @{ label = "HIRED"; color = $mint },
    @{ label = "LOST"; color = "EF4444" }
)
for ($i = 0; $i -lt 7; $i++) {
    $cx = 0.3 + ($i * 1.8)
    $st = $statuses[$i]
    $s10 += (FilledRect $cx 1.5 1.6 0.4 $st.color -id (60+$i))
    $s10 += (TextBox $st.label $cx 1.52 1.6 0.35 -fontSize 900 -color $white -bold -align "ctr" -id (10+$i))
}

# テーブルヘッダー
$s10 += (FilledRect 0.3 2.3 12.4 0.5 "F1F5F9" -id 80)
$s10 += (TextBox "企業名          |  電話番号       |  担当者     |  面接日      |  メール  |  形式       |  書類  |  ステータス" 0.5 2.35 12.0 0.4 -fontSize 1000 -color $grayText -bold -id 20)

$projRows = @(
    @{ text = "株式会社レストランA  |  03-1234-5001  |  田中太郎  |  2024/03/15  |  送信済  |  オンライン  |  なし  |  面接設定済"; stColor = "8B5CF6" },
    @{ text = "有限会社ファクトリーB  |  06-2345-6002  |  鈴木花子  |  -           |  送信済  |  -           |  あり  |  メール送信済"; stColor = "F59E0B" },
    @{ text = "株式会社ショップC     |  052-345-7003  |  田中太郎  |  2024/03/12  |  送信済  |  対面        |  なし  |  採用"; stColor = $mint },
    @{ text = "株式会社ダイニングG   |  03-1234-5007  |  佐藤次郎  |  -           |  未送信  |  -           |  -    |  新規"; stColor = $accent }
)
for ($i = 0; $i -lt $projRows.Count; $i++) {
    $ry = 2.9 + ($i * 0.55)
    $s10 += (FilledRect 0.3 $ry 12.4 0.5 $white -id (82+$i))
    $s10 += (TextBox $projRows[$i].text 0.5 ($ry + 0.05) 12.0 0.4 -fontSize 1000 -color $darkText -id (30+$i))
}

$s10 += (TextBox "最新順(created_at DESC)で表示。ステータスフィルターで絞り込み可能。" 0.5 5.8 12.0 0.4 -fontSize 1100 -color $grayText -id 40)
MakeSlide $s10 10

# ============================================
# SLIDE 11: 案件詳細画面
# ============================================
$s11 = (FilledRect 0 0 13.33 1.2 $navy -id 50)
$s11 += (TextBox "案件詳細画面" 0.7 0.25 11 0.7 -fontSize 2400 -color $white -bold -id 2)

# 左: 企業情報 + 編集
$s11 += (FilledRect 0.5 1.6 5.8 5.0 $white -id 60)
$s11 += (FilledRect 0.5 1.6 5.8 0.06 $teal -id 70)
$s11 += (TextBox "企業情報 & 案件編集" 0.7 1.75 5.4 0.4 -fontSize 1400 -color $darkText -bold -id 10)
$s11 += (MultiLineText @("企業名: 株式会社レストランA","電話: 03-1234-5001  |  業種: 飲食","案件化日時: 2024/03/09 15:30","担当: 田中 太郎","","[ステータス]   面接設定済 v","[面接日時]     2024/03/15 10:00","[面接形式]     オンライン v","[書類選考]     なし v","[v] メール送信済み","[メモ]         オンライン面接のURL送信済み","","        [ 更新 ]") 0.7 2.3 5.4 4.0 -fontSize 1000 -color $darkText -id 11)

# 右: 通話履歴
$s11 += (FilledRect 6.6 1.6 6.0 5.0 $white -id 61)
$s11 += (FilledRect 6.6 1.6 6.0 0.06 $accent -id 71)
$s11 += (TextBox "通話履歴" 6.8 1.75 5.6 0.4 -fontSize 1400 -color $darkText -bold -id 12)
$s11 += (MultiLineText @("2024/03/09 15:30  PROJECT  田中太郎","  人事部山田様。ホールスタッフ採用に興味。","  来週月曜オンライン面接で合意。","","2024/03/08 14:30  RECALL  田中太郎","  担当者不在。15時以降に再架電希望。","","2024/03/07 10:15  NO_ANSWER  田中太郎","  応答なし。") 6.8 2.3 5.6 4.0 -fontSize 1000 -color $grayText -id 13)
MakeSlide $s11 11

# ============================================
# SLIDE 12: AI通話評価
# ============================================
$s12 = (FilledRect 0 0 13.33 1.2 $navy -id 50)
$s12 += (TextBox "AI通話評価 (OpenAI GPT-4)" 0.7 0.25 11 0.7 -fontSize 2400 -color $white -bold -id 2)

# 左: スコア
$s12 += (FilledRect 0.5 1.6 4.0 5.0 $white -id 60)
$s12 += (TextBox "総合スコア" 0.5 1.7 4.0 0.35 -fontSize 1200 -color $grayText -align "ctr" -id 10)
$s12 += (TextBox "75" 0.5 2.1 4.0 1.0 -fontSize 4800 -color $accent -bold -align "ctr" -id 11)
$s12 += (TextBox "/100" 0.5 3.0 4.0 0.4 -fontSize 1200 -color $grayText -align "ctr" -id 12)

$scores = @(
    @{ label = "第一声"; score = "82" },
    @{ label = "明瞭さ"; score = "70" },
    @{ label = "ヒアリング"; score = "78" },
    @{ label = "切り返し"; score = "65" },
    @{ label = "クロージング"; score = "80" }
)
for ($i = 0; $i -lt 5; $i++) {
    $sy = 3.6 + ($i * 0.55)
    $sc = $scores[$i]
    $s12 += (TextBox "$($sc.label): $($sc.score)/100" 0.7 $sy 3.6 0.4 -fontSize 1100 -color $darkText -id (20+$i))
}

# 右: フィードバック
$s12 += (FilledRect 4.8 1.6 7.8 2.3 "F0FDF4" -id 61)
$s12 += (TextBox "良かった点" 5.0 1.7 7.4 0.35 -fontSize 1200 -color $mint -bold -id 30)
$s12 += (MultiLineText @("第一声で会社名と名前を明確に伝えている","相手の課題を丁寧にヒアリングできている","次回アクションを具体的に設定できている") 5.0 2.1 7.4 1.5 -fontSize 1100 -color $darkText -bullet -id 31)

$s12 += (FilledRect 4.8 4.1 7.8 1.5 "FEF2F2" -id 62)
$s12 += (TextBox "改善点" 5.0 4.2 7.4 0.35 -fontSize 1200 -color "EF4444" -bold -id 32)
$s12 += (MultiLineText @("用件の説明がやや長い。30秒以内に要点をまとめる","忙しいという反論への切り返しが弱い") 5.0 4.6 7.4 1.0 -fontSize 1100 -color $darkText -bullet -id 33)

$s12 += (FilledRect 4.8 5.8 7.8 0.8 "EFF6FF" -id 63)
$s12 += (TextBox "次回改善: 最初の30秒でサービスの3つのメリットを端的に伝えるスクリプトを用意する" 5.0 5.9 7.4 0.6 -fontSize 1100 -color $accent -id 34)
MakeSlide $s12 12

# ============================================
# SLIDE 13: 通話ログ検索
# ============================================
$s13 = (FilledRect 0 0 13.33 1.2 $navy -id 50)
$s13 += (TextBox "通話ログ検索" 0.7 0.25 11 0.7 -fontSize 2400 -color $white -bold -id 2)

$s13 += (TextBox "電話番号を入力するとCRM内DB + Google Sheetsの両方から通話ログを横断検索します。" 0.7 1.6 12.0 0.5 -fontSize 1300 -color $grayText -id 3)

# 検索バー
$s13 += (FilledRect 0.5 2.3 8.0 0.5 "F8FAFC" -id 60)
$s13 += (TextBox "03-1234-5001" 0.7 2.35 6.0 0.4 -fontSize 1200 -color $darkText -id 10)
$s13 += (FilledRect 8.7 2.3 1.5 0.5 $accent -id 61)
$s13 += (TextBox "検索" 8.7 2.33 1.5 0.4 -fontSize 1200 -color $white -bold -align "ctr" -id 11)

# CRM結果
$s13 += (FilledRect 0.5 3.2 12.0 0.4 $teal -id 62)
$s13 += (TextBox "CRM通話履歴 (3件)" 0.7 3.23 11.5 0.35 -fontSize 1100 -color $white -bold -id 12)

$s13 += (FilledRect 0.5 3.7 12.0 0.4 "F1F5F9" -id 63)
$s13 += (TextBox "通話日時          |  企業名                 |  オペレーター  |  結果      |  AI評価  |  メモ" 0.7 3.73 11.5 0.35 -fontSize 1000 -color $grayText -bold -id 13)

$s13 += (TextBox "2024/03/09 15:30  |  株式会社レストランA  |  田中太郎     |  PROJECT  |  75点    |  案件化" 0.7 4.2 11.5 0.35 -fontSize 1000 -color $darkText -id 14)
$s13 += (TextBox "2024/03/08 14:30  |  株式会社レストランA  |  田中太郎     |  RECALL    |  -        |  担当者不在" 0.7 4.6 11.5 0.35 -fontSize 1000 -color $darkText -id 15)

# Sheets結果
$s13 += (FilledRect 0.5 5.3 12.0 0.4 "F59E0B" -id 64)
$s13 += (TextBox "Google Sheets通話ログ (2件)" 0.7 5.33 11.5 0.35 -fontSize 1100 -color $white -bold -id 16)
$s13 += (TextBox "Zoom Phoneの録音データ・文字起こしデータとの紐付けが可能" 0.7 5.85 11.5 0.35 -fontSize 1100 -color $grayText -id 17)
MakeSlide $s13 13

# ============================================
# SLIDE 14: CSVインポート
# ============================================
$s14 = (FilledRect 0 0 13.33 1.2 $navy -id 50)
$s14 += (TextBox "CSVインポート機能" 0.7 0.25 11 0.7 -fontSize 2400 -color $white -bold -id 2)

# フォーマット
$s14 += (FilledRect 0.5 1.6 5.5 2.5 "EFF6FF" -id 60)
$s14 += (TextBox "CSVフォーマット" 0.7 1.7 5.0 0.4 -fontSize 1400 -color $accent -bold -id 10)
$s14 += (TextBox "company_name,phone_number,industry,region" 0.7 2.2 5.0 0.4 -fontSize 1200 -color $darkText -bold -id 11)
$s14 += (MultiLineText @("company_name: 企業名 (必須)","phone_number: 電話番号 (必須)","industry: 業種 (任意)","region: 地域 (任意)") 0.7 2.7 5.0 1.2 -fontSize 1100 -color $grayText -id 12)

# 機能
$s14 += (FilledRect 6.5 1.6 6.0 2.5 "F0FDF4" -id 61)
$s14 += (TextBox "インポート機能" 6.7 1.7 5.6 0.4 -fontSize 1400 -color $mint -bold -id 13)
$s14 += (MultiLineText @("電話番号の重複チェック","必須項目のバリデーション","トランザクション処理 (途中失敗時ロールバック)","エラー行のスキップ & レポート","最大10MBまでのファイル対応") 6.7 2.2 5.6 1.8 -fontSize 1100 -color $darkText -bullet -id 14)

# 結果例
$s14 += (FilledRect 0.5 4.5 12.0 2.2 $white -id 62)
$s14 += (TextBox "インポート結果例" 0.7 4.6 11.5 0.4 -fontSize 1400 -color $darkText -bold -id 20)
$s14 += (TextBox "総行数: 150  |  成功: 142件  |  スキップ: 8件" 0.7 5.1 11.5 0.4 -fontSize 1400 -color $darkText -id 21)
$s14 += (MultiLineText @("行23: 電話番号重複: 03-1234-5001","行45: 企業名が空です","行89: 電話番号重複: 06-2345-6002") 0.7 5.6 11.5 1.0 -fontSize 1100 -color "EF4444" -id 22)
MakeSlide $s14 14

# ============================================
# SLIDE 15: セキュリティ対策
# ============================================
$s15 = (FilledRect 0 0 13.33 1.2 $navy -id 50)
$s15 += (TextBox "セキュリティ対策" 0.7 0.25 11 0.7 -fontSize 2400 -color $white -bold -id 2)

$secItems = @(
    @{ title = "JWT認証"; desc = "有効期限付きトークンでステートレス認証。Authorization Bearer方式。"; color = $teal },
    @{ title = "bcryptハッシュ"; desc = "パスワードをbcryptで不可逆ハッシュ化。ソルト自動生成。"; color = $accent },
    @{ title = "SQLインジェクション対策"; desc = "全クエリでプリペアドステートメント使用。動的SQL排除。"; color = $mint },
    @{ title = "レートリミット"; desc = "API: 15分500回 / ログイン: 15分10回。DDoS/ブルートフォース防止。"; color = "F59E0B" },
    @{ title = "Helmet"; desc = "セキュリティヘッダー自動設定。XSS/クリックジャッキング対策。"; color = "8B5CF6" },
    @{ title = "CORS設定"; desc = "許可されたオリジンからのみAPIアクセス可能。credentials対応。"; color = "EF4444" }
)
for ($i = 0; $i -lt 6; $i++) {
    $row = [math]::Floor($i / 3)
    $col = $i % 3
    $cx = 0.5 + ($col * 4.1)
    $cy = 1.6 + ($row * 2.5)
    $sec = $secItems[$i]
    $s15 += (FilledRect $cx $cy 3.8 2.1 "F8FAFC" -id (60+$i))
    $s15 += (FilledRect $cx $cy 0.1 2.1 $sec.color -id (70+$i))
    $s15 += (TextBox $sec.title ($cx + 0.3) ($cy + 0.15) 3.3 0.4 -fontSize 1400 -color $darkText -bold -id (10+$i))
    $s15 += (TextBox $sec.desc ($cx + 0.3) ($cy + 0.65) 3.3 1.2 -fontSize 1100 -color $grayText -id (20+$i))
}
MakeSlide $s15 15

# ============================================
# SLIDE 16: デプロイ構成
# ============================================
$s16 = (FilledRect 0 0 13.33 1.2 $navy -id 50)
$s16 += (TextBox "デプロイ構成" 0.7 0.25 11 0.7 -fontSize 2400 -color $white -bold -id 2)

# サーバー構成
$s16 += (FilledRect 0.5 1.6 5.8 3.5 $white -id 60)
$s16 += (FilledRect 0.5 1.6 5.8 0.06 $teal -id 70)
$s16 += (TextBox "サーバー構成" 0.7 1.75 5.4 0.4 -fontSize 1400 -color $darkText -bold -id 10)
$s16 += (MultiLineText @("ホスティング: お名前.comレンタルサーバー","プロセス管理: PM2","バックエンド: Node.js (port 3001)","フロントエンド: Next.js (port 3000)","DB: MySQL 8 (port 3306)") 0.7 2.3 5.4 2.5 -fontSize 1200 -color $darkText -bullet -id 11)

# デプロイ手順
$s16 += (FilledRect 6.6 1.6 6.0 3.5 $white -id 61)
$s16 += (FilledRect 6.6 1.6 6.0 0.06 $accent -id 71)
$s16 += (TextBox "デプロイ手順" 6.8 1.75 5.6 0.4 -fontSize 1400 -color $darkText -bold -id 12)
$s16 += (MultiLineText @("1. git clone でリポジトリ取得","2. .env ファイルを設定","3. npm install (バックエンド)","4. npm run build (フロントエンド)","5. MySQLマイグレーション実行","6. PM2でサーバー起動") 6.8 2.3 5.6 2.5 -fontSize 1200 -color $darkText -id 13)

# Git戦略
$s16 += (FilledRect 0.5 5.5 12.0 1.5 "F8FAFC" -id 62)
$s16 += (TextBox "Gitブランチ戦略" 0.7 5.6 11.5 0.4 -fontSize 1400 -color $teal -bold -id 20)
$s16 += (TextBox "main (本番) <-- develop (開発) <-- feature/* (機能開発)" 0.7 6.1 11.5 0.4 -fontSize 1300 -color $darkText -id 21)
$s16 += (TextBox "feature完了後、developにマージ。テスト確認後、mainにリリース。" 0.7 6.5 11.5 0.4 -fontSize 1100 -color $grayText -id 22)
MakeSlide $s16 16

# ============================================
# SLIDE 17: まとめ・導入効果
# ============================================
$s17 = (FilledRect 0 0 13.33 7.5 $navy -id 50)
$s17 += (FilledRect 0 0 0.15 7.5 $teal -id 51)
$s17 += (TextBox "まとめ・導入効果" 1.0 0.5 11 0.8 -fontSize 3000 -color $white -bold -align "ctr" -id 2)
$s17 += (FilledRect 5.5 1.4 2.3 0.04 $teal -id 52)

$effects = @(
    @{ title = "架電効率 30%向上"; desc = "ゴールデンタイム自動判定 + リコール管理で無駄な架電を削減" },
    @{ title = "案件管理の一元化"; desc = "架電から採用までのパイプラインを可視化。進捗漏れゼロへ" },
    @{ title = "AI評価で教育コスト削減"; desc = "6項目の自動評価でオペレーター個人の課題を特定。育成を効率化" },
    @{ title = "データ駆動の営業戦略"; desc = "業種別・時間帯別の分析で最適な架電戦略をデータで立案" }
)
for ($i = 0; $i -lt 4; $i++) {
    $cy = 1.8 + ($i * 1.2)
    $ef = $effects[$i]
    $s17 += (FilledRect 1.5 $cy 10.0 1.0 "1E2761" -id (60+$i))
    $s17 += (FilledRect 1.5 $cy 0.08 1.0 $teal -id (70+$i))
    $s17 += (TextBox $ef.title 1.8 ($cy + 0.05) 9.5 0.45 -fontSize 1600 -color $white -bold -id (10+$i))
    $s17 += (TextBox $ef.desc 1.8 ($cy + 0.5) 9.5 0.4 -fontSize 1200 -color "94A3B8" -id (20+$i))
}

$s17 += (TextBox "Thank you" 1.0 6.5 11 0.6 -fontSize 2000 -color "94A3B8" -align "ctr" -id 40)
MakeSlide $s17 17

# ============================================
# ZIP圧縮してPPTX生成
# ============================================
Write-Host "PPTXファイルを生成中..."

# 既存ファイル削除
if (Test-Path $outputPath) { Remove-Item $outputPath -Force }

# PowerShell ZipFile
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($tempDir, $outputPath)

# 一時ディレクトリ削除
Remove-Item -Recurse -Force $tempDir

Write-Host "完了: $outputPath"
Write-Host "スライド数: $slideCount"
