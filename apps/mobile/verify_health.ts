// @ts-nocheck
import axios from 'axios';

async function checkHealth() {
    const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:8081/v1';

    // 1. Login as Admin
    console.log(`Logging in as Admin at ${API_URL}/auth/login...`);
    try {
        const loginRes = await axios.post(`${API_URL}/auth/login`, {
            email: 'admin@proxyhub.com',
            password: 'password123'
        });
        const token = loginRes.data.access_token;
        console.log("Admin Login Successful.");

        // 2. Check Public Health (Sanity)
        try {
            const pubHealth = await axios.get(`${API_URL.replace('/v1', '')}/health`);
            console.log("Public Health Check:", pubHealth.data);
        } catch (e: any) {
            console.error("Public Health Check Failed:", e.message);
        }

        // 3. Check Admin Nodes (Existing Route)
        console.log("Checking Admin Nodes...");
        try {
            await axios.get(`${API_URL}/admin/health/nodes`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log("Admin Nodes Route: OK");
        } catch (e: any) {
            console.error("Admin Nodes Route Failed:", e.response?.status, e.response?.data);
        }

        // 4. Check System Health
        console.log("Checking System Health...");
        const healthRes = await axios.get(`${API_URL}/admin/health/system`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        console.log("Health Status:", JSON.stringify(healthRes.data, null, 2));

        if (healthRes.data.healthy && healthRes.data.database.healthy && healthRes.data.redis.healthy) {
            console.log("SUCCESS: System is HEALTHY.");
        } else {
            console.error("FAILURE: System is UNHEALTHY.");
            process.exit(1);
        }

    } catch (err: any) {
        console.error("Error:", err.response?.data || err.message);
        process.exit(1);
    }
}

checkHealth();
