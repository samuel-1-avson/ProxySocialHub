# Smart Contracts – Expanded

## Escrow Billing Contract
```solidity
contract EscrowBilling {
  struct Session {
    address buyer;
    address provider;
    uint256 amount;
    bool settled;
  }

  mapping(bytes32 => Session) public sessions;

  function openSession(bytes32 id, address provider) payable public {
    sessions[id] = Session(msg.sender, provider, msg.value, false);
  }

  function settle(bytes32 id) public {
    Session storage s = sessions[id];
    require(!s.settled);
    payable(s.provider).transfer(s.amount);
    s.settled = true;
  }
}
```

## Clan Revenue Split
```solidity
function splitPayment(address[] memory members) internal {
  uint share = msg.value / members.length;
  for(uint i=0;i<members.length;i++){
    payable(members[i]).transfer(share);
  }
}
```

