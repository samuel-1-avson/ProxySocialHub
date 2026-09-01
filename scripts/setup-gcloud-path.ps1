$gitBin = "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\Git\cmd"
$gcloudBin = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")

$newPath = $userPath
if ($newPath -notlike "*$gcloudBin*") {
    $newPath = "$newPath;$gcloudBin"
}
if ($newPath -notlike "*$gitBin*") {
    $newPath = "$newPath;$gitBin"
}

if ($newPath -ne $userPath) {
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Output "Successfully updated User PATH with Git and gcloud."
} else {
    Write-Output "Git and gcloud are already in User PATH."
}
