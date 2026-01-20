const crypto = require('crypto');
const nacl = require('tweetnacl');
const { encode, decode } = require('tweetnacl-util');

// Install: npm install tweetnacl tweetnacl-util

class AgentSigner {
    constructor(privateKeyHex) {
        // tweetnacl expects Uint8Array
        this.keyPair = nacl.sign.keyPair.fromSecretKey(
            Buffer.from(privateKeyHex, 'hex')
        );
    }

    getPublicKey() {
        return Buffer.from(this.keyPair.publicKey).toString('hex');
    }

    signOutput(contentStr, metadata = {}) {
        // 1. Hash the content (SHA256)
        const hash = crypto.createHash('sha256').update(contentStr).digest('hex');
        const hashBytes = Buffer.from(hash, 'hex');

        // 2. Sign the HASH
        const signatureBytes = nacl.sign.detached(hashBytes, this.keyPair.secretKey);
        const signatureHex = Buffer.from(signatureBytes).toString('hex');

        return {
            content_hash: hash,
            signature: signatureHex,
            metadata: {
                timestamp: Math.floor(Date.now() / 1000),
                agent_version: "1.0.0",
                ...metadata
            }
        };
    }
}

// Example Usage
if (require.main === module) {
    // 1. Generate Keypair for demo
    const keyPair = nacl.sign.keyPair();
    const privKey = Buffer.from(keyPair.secretKey).toString('hex');
    console.log(`Agent Private Key: ${privKey}`);

    const agent = new AgentSigner(privKey);
    console.log(`Agent Public Key: ${agent.getPublicKey()}`);

    // 2. Sign Work
    const outputText = "Sentiment Analysis: Positive trend detected in DeFi sector.";
    const payload = agent.signOutput(outputText, { model: "claude-3-opus", source: "twitter" });

    console.log("\n--- Payload for POST /registry/agents/verify/output ---");
    console.log(JSON.stringify({
        agent_id: "[YOUR_AGENT_UUID]",
        ...payload
    }, null, 2));
}
