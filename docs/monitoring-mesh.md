# ProxyHubb Service Mesh Monitoring & Management

This document explains how to monitor and manage the Service Mesh in both Kubernetes and Docker Compose environments.

---

## 1. Kubernetes (Linkerd)

Linkerd provides instant "Golden Metrics" (Success Rate, Latency, Throughput) and automated mTLS.

### Accessing the Dashboard (Viz)
1. Ensure the Linkerd Viz extension is installed:
   ```bash
   linkerd viz install | kubectl apply -f -
   ```
2. Open the dashboard:
   ```bash
   linkerd viz dashboard
   ```

### Verifying mTLS
Check the security status of your deployments:
```bash
linkerd viz -n proxyhubb edges deployment
```
You should see a "locked" icon 🔒 indicating 100% mTLS coverage for internal traffic.

### Key Metrics to Monitor
- **Success Rate**: Target 99.9% for Control API.
- **P99 Latency**: Target <50ms for Edge Gateway internal calls.
- **RPS**: Monitor for spikes indicating unusual consumer behavior.

---

## 2. Docker Compose (Consul Connect)

For local development, we use Consul to simulate a service mesh environment.

### Accessing the Consul UI
The Consul dashboard is available at:
[http://localhost:8500](http://localhost:8500)

### Running with the Mesh
To start ProxyHubb with the service mesh enabled:
```bash
docker-compose -f docker-compose.yml -f docker-compose.mesh.yml up -d
```

### How it Works
- **mTLS**: Consul manages certificates and handles automated rotation.
- **Upstreams**: Traffic between `edge-gateway` and `control-api` is routed through encrypted local proxies.
- **Service Discovery**: Services find each other via Consul DNS/API.

---

## 3. Observability Best Practices

1. **Don't Over-Probe**: Let the mesh handle retries; redundant application-level retries can lead to "retry storms."
2. **Watch the Sidecar Overhead**: Monitor the memory usage of Envoy/Linkerd sidecars, especially for the high-throughput Edge Gateway.
3. **Trace the Path**: Use the integrated Tap feature (`linkerd viz tap`) to inspect requests in real-time without logging sensitive proxy data.

---
*Maintained by ProxyHubb DevOps.*
