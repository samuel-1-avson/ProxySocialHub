port 26379
sentinel resolve-hostnames yes
sentinel announce-hostnames yes
sentinel monitor mymaster redis 6379 2
sentinel auth-pass mymaster __REDIS_PASSWORD__
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 15000
sentinel parallel-syncs mymaster 1
