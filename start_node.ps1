$jwt = Get-Content jwt.txt -Raw
.\services\provider-node\target\debug\provider-node.exe start --gateway-addr localhost:3128 --jwt-token $jwt --debug
