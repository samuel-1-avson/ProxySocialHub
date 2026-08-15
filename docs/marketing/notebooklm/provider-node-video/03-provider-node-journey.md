# How a Provider Node Works on ProxyHubb

This is the main narrative source for the provider-focused video.

## Simple mental model
Think of unused residential bandwidth as inventory.

ProxyHubb is the marketplace where that inventory can be listed, bought, and measured.

A **provider node** is the software a provider runs so their capacity can join the network and carry traffic.

## Critical architecture point (explain plainly)
A buyer does **not** connect straight to the provider’s laptop.

1. Buyer traffic hits ProxyHubb’s **edge gateway**
2. The provider node opens an **outbound tunnel** into that gateway
3. When a buyer session needs a residential route, the gateway sends work through the tunnel
4. The provider node reaches the destination on the public internet
5. Bytes move; the edge is designed to meter them
6. Settlement ties back to wallet balances

This outbound-tunnel design matters because many home networks cannot easily accept inbound connections. The node can still join by dialing out.

Do not drown the narration in protocol names. If needed once: the provider tunnel goes to the gateway; buyer sessions use a separate proxy endpoint.

## Provider journey — step by step

### Step 1 — Become a provider
- Connect a Solana wallet
- Complete provider setup in the web dashboard
- Create the provider identity and node registration path the control plane can track

### Step 2 — Get the node software
- Open provider setup / CLI tools in the dashboard
- Download the provider CLI and node config for your OS
- This package is what keeps capacity connected to the network

### Step 3 — Start the node
- Start the tunnel daemon with the downloaded config
- The node enrolls / reuses its node id, opens the outbound tunnel, and stays alive with heartbeats
- When required, it holds a capability lease so the network knows what the node can serve
- Healthy nodes show as online in the provider nodes dashboard

### Step 4 — Publish a listing
- Online capacity alone is not enough for buyers to purchase
- Publish a marketplace listing: what you offer, location context, pricing intent
- The listing is what buyers browse and buy

### Step 5 — Stay healthy while buyers arrive
- Heartbeats and tunnel health keep the node eligible
- Listings should only sell when infrastructure is healthy
- Providers monitor nodes, listings, and earnings from the dashboard

### Step 6 — Earn from real routed usage
- When buyers route through your capacity, traffic flows through your tunnel
- Usage is designed to be measured at the edge — where traffic actually flows
- Earnings are tied to that measured usage model and wallet settlement flows

## What the provider node is doing while running
While online, the node is basically:
- staying authenticated to the control plane
- keeping the outbound tunnel to the edge alive
- advertising that capacity is available
- carrying traffic when selected for a buyer session
- reporting liveness so the marketplace can treat the node as online

## What providers get
- A path to publish capacity without building a full vendor stack
- A node / CLI to join the network
- Marketplace discovery for their supply
- Earnings tied to real routed usage
- Dashboard visibility into nodes and performance

## What providers do not need to become first
- A full proxy company
- A custom billing portal
- A private reseller brand
- An inbound-port networking expert just to join

## Honest limits
ProxyHubb is early and still shipping.
Do not promise guaranteed income, perfect uptime, or “set and forget riches.”
Describe the provider path as a real, usable participation path in an emerging marketplace.

## Closing lines that fit this story
- A provider node turns spare residential capacity into marketplace supply.
- Buyers discover listings. Providers run nodes. The edge measures what actually moved.
- Quiet infrastructure for residential proxy bandwidth — with providers as participants, not invisible inventory.
