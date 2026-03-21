$resp = Invoke-RestMethod -Uri 'http://localhost:8080/v1/provider/auth' -Method Post -ContentType 'application/json' -InFile 'payload.json'
$resp.jwt_token | Out-File -FilePath 'jwt.txt' -NoNewline
