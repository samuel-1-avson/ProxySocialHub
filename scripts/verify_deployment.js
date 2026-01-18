const http = require('http');

function check(url, name) {
    return new Promise((resolve) => {
        console.log(`Checking ${name} at ${url}...`);
        http.get(url, (res) => {
            if (res.statusCode >= 200 && res.statusCode < 400) {
                console.log(`[PASS] ${name} is UP (Status: ${res.statusCode})`);
                resolve(true);
            } else {
                console.log(`[FAIL] ${name} returned status ${res.statusCode}`);
                resolve(false);
            }
        }).on('error', (e) => {
            console.log(`[FAIL] ${name} unreachable: ${e.message}`);
            resolve(false);
        });
    });
}

async function verify() {
    console.log("Starting System Verification...");

    // 1. Control API Health (Port 8081 due to 8080 conflict)
    const api = await check('http://127.0.0.1:8081/health', 'Control API');

    // 2. Web Frontend
    const web = await check('http://127.0.0.1:3006', 'Web Dashboard');

    // 3. Prometheus (if exposed)
    // const prom = await check('http://127.0.0.1:9091/-/healthy', 'Prometheus');

    if (api && web) {
        console.log("\n>>> SYSTEM DEPLOYMENT SUCCESSFUL <<<");
        process.exit(0);
    } else {
        console.log("\n>>> SYSTEM DEPLOYMENT FAILED <<<");
        process.exit(1);
    }
}

// Wait 10s for services to initialize after verify is called
setTimeout(verify, 10000);
