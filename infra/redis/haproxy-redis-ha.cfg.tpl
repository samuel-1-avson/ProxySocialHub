# HAProxy TCP gateway in front of Redis Sentinel master/replica.
# Password is injected at deploy into the AUTH check line only.
global
  log stdout format raw local0
  maxconn 4096

defaults
  log global
  mode tcp
  timeout connect 3s
  timeout client 10s
  timeout server 10s
  timeout check 2s
  timeout tunnel 10s

frontend redis_front
  bind *:6379
  default_backend redis_masters

backend redis_masters
  mode tcp
  balance first
  option tcp-check
  tcp-check connect
  tcp-check send AUTH\ __REDIS_PASSWORD__\r\n
  tcp-check expect string +OK
  tcp-check send PING\r\n
  tcp-check expect string +PONG
  tcp-check send info\ replication\r\n
  tcp-check expect string role:master
  default-server inter 2s fall 2 rise 2 on-marked-down shutdown-sessions
  server redis redis:6379 check
  server redis_replica redis-replica:6379 check
