# 打包扩展为 .vsix（上传前先提 version）
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Get-ChildItem .\src\*.js | ForEach-Object { node --check $_.FullName }
node --check .\scripts\repair-index.js
if ($LASTEXITCODE -ne 0) { throw '语法检查未通过' }
Write-Host '语法 OK，开始打包…'
npx --yes @vscode/vsce package --allow-missing-repository
if ($LASTEXITCODE -ne 0) { throw '打包失败（上面有 vsce 的报错）' }
Get-ChildItem *.vsix | ForEach-Object { Write-Host ("产物：{0}  ({1:N0} KB)" -f $_.Name, ($_.Length / 1KB)) }
