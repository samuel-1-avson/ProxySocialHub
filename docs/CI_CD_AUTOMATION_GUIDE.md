# ProxyHubb CI/CD Automation & Auto-Deployment Guide

This document outlines the **Continuous Integration (CI)** and **Continuous Deployment (CD)** pipelines configured for the ProxyHubb Protocol ecosystem.

---

## 1. Pipeline Architecture

```
                                  GitHub Repository (origin/main)
                                                │
                                    ┌───────────┴───────────┐
                                    ▼                       ▼
                              [Pull Requests]         [Push to main]
                                    │                       │
                                    ▼                       ▼
                              Stage 1: CI             Stage 1: CI
                          (Lint, Test, Gate)      (Lint, Test, Gate)
                                                            │
                                                     (Passes Gate)
                                                            │
                                                            ▼
                                                       Stage 2: CD
                                                 (Deploy to GCP Testnet)
                                                            │
                                                            ▼
                                                       Stage 3: QA
                                                (Live Smoke Verification)
```

---

## 2. Workflows Overview

| Workflow | File | Trigger | Purpose |
| :--- | :--- | :--- | :--- |
| **ProxyHubb CI** | [`.github/workflows/proxyhubb-ci.yml`](../.github/workflows/proxyhubb-ci.yml) | Push / PR to `main`, `develop` | Security scans (Gitleaks), Go tests & migrations, Rust edge-gateway clippy/test, Next.js Web typecheck & contracts, Docs build. |
| **GCP Testnet CD** | [`.github/workflows/deploy-gcp-testnet.yml`](../.github/workflows/deploy-gcp-testnet.yml) | Push to `main`, Manual Dispatch | Automated zero-downtime deployment to GCP VM `proxyhubb-testnet` + live public HTTP smoke verification. |
| **QA Live Smoke** | [`.github/workflows/qa-live-testnet.yml`](../.github/workflows/qa-live-testnet.yml) | Cron (`*/30 * * * *`), Dispatch | Continuous health probing and regression testing against production endpoints. |

---

## 3. GitHub Secrets Configuration

To enable automated zero-downtime deployments from GitHub Actions to your GCP VM, add the following secrets in your GitHub repository:

> **Navigate to:** `GitHub Repository → Settings → Secrets and variables → Actions → New repository secret`

### Recommended: SSH Key Authentication

| Secret Name | Required | Description | Example |
| :--- | :---: | :--- | :--- |
| `GCP_SSH_PRIVATE_KEY` | **Yes** | OpenSSH Private Key authorized on the VM | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `GCP_VM_HOST` | Optional | External IP of the `proxyhubb-testnet` VM | `34.68.134.20` |
| `GCP_VM_USER` | Optional | Linux user on the VM (defaults to `samuelavson360`) | `samuelavson360` |

#### How to Generate and Authorize a Deploy Key:

1. **Generate a dedicated deploy keypair** on your local terminal:
   ```bash
   ssh-keygen -t ed25519 -f ./gcp_deploy_key -C "github-actions-deploy" -N ""
   ```

2. **Add the public key** to your GCP VM:
   ```powershell
   # Using gcloud CLI from your terminal:
   .\scripts\gcloud.cmd compute ssh proxyhubb-testnet --zone=us-central1-a --command="cat << 'EOF' >> ~/.ssh/authorized_keys
   $(Get-Content ./gcp_deploy_key.pub)
   EOF
   chmod 600 ~/.ssh/authorized_keys"
   ```

3. **Add the private key** (`gcp_deploy_key`) to GitHub Secrets as `GCP_SSH_PRIVATE_KEY`.

---

### Alternative: Google Cloud Service Account Authentication

If you prefer using GCP IAM Service Accounts instead of SSH keys:

| Secret Name | Required | Description |
| :--- | :---: | :--- |
| `GCP_SA_KEY` | Optional | JSON service account key with `Compute Instance Admin (v1)` permissions |

---

## 4. Manual Deployment Trigger

You can deploy on-demand directly from GitHub Actions without pushing new code:

1. Go to **GitHub Actions** → **GCP Testnet CD (Auto-Deploy)**.
2. Click **Run workflow**.
3. Select options:
   - **Microservices to build/deploy**: e.g., `web docs` or `control-api` or `db-migrate control-api web docs`.
   - **Dry run**: `true` / `false`.

---

## 5. Local & Remote Deployment Commands

### Run Deployment from Local Terminal (via gcloud):
```powershell
.\scripts\gcloud.cmd compute ssh proxyhubb-testnet --zone=us-central1-a --command="cd /opt/proxyhubb && bash scripts/gcp-ci-deploy.sh"
```

### Run Deployment Directly on the VM:
```bash
cd /opt/proxyhubb
bash scripts/gcp-ci-deploy.sh --services "web docs"
```

---

## 6. Live Verification Endpoints

After every deployment, verify the live services:

- **Main Web App**: [`https://proxyhubb.com`](https://proxyhubb.com)
- **Whitepaper Interactive Viewer**: [`https://proxyhubb.com/whitepaper`](https://proxyhubb.com/whitepaper)
- **Documentation Hub**: [`https://docs.proxyhubb.com/docs/whitepaper`](https://docs.proxyhubb.com/docs/whitepaper)
- **Control API Health**: [`https://api.proxyhubb.com/api/health`](https://api.proxyhubb.com/api/health)
