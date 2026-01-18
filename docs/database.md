# Database Schemas & Smart Contracts

## PostgreSQL Core Tables

### users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE,
  role TEXT CHECK (role IN ('buyer','provider')),
  created_at TIMESTAMP
);
```

### providers
```sql
CREATE TABLE providers (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  reputation_score INT,
  active BOOLEAN
);
```

### clans
```sql
CREATE TABLE clans (
  id UUID PRIMARY KEY,
  name TEXT,
  owner_id UUID REFERENCES users(id)
);
```

### proxies
```sql
CREATE TABLE proxies (
  id UUID PRIMARY KEY,
  provider_id UUID REFERENCES providers(id),
  ip_address TEXT,
  port INT,
  active BOOLEAN
);
```

### sessions
```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  buyer_id UUID,
  proxy_id UUID,
  bytes_used BIGINT,
  started_at TIMESTAMP,
  ended_at TIMESTAMP
);
```

### billing
```sql
CREATE TABLE billing (
  id UUID PRIMARY KEY,
  session_id UUID,
  cost NUMERIC,
  settled BOOLEAN
);
```

## Smart Contract (Solidity – Future)
```solidity
contract ProxyBilling {
  mapping(address => uint256) public balances;

  function recordUsage(address provider, uint256 amount) public {
    balances[provider] += amount;
  }

  function withdraw() public {
    payable(msg.sender).transfer(balances[msg.sender]);
    balances[msg.sender] = 0;
  }
}
```

