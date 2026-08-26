# Security Policy

The **Graywood Reader** team takes the security of our application, self-hosted deployments, and user data seriously. We appreciate responsible disclosure of any potential vulnerabilities.

---

## 🛡️ Supported Versions

We provide security updates and patches for the latest active release versions:

| Version | Supported |
|---|---|
| `1.0.x` (Current) | :white_check_mark: Yes |

---

## 🚨 Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

### How to Report

1. **GitHub Private Vulnerability Reporting (Preferred)**:
   Navigate to the repository's **Security** tab and click **[Report a vulnerability](https://github.com/gogz95/Remix-ManhuaSync-to-a-reader/security/advisories/new)** to submit an advisory draft directly to maintainers.

2. **Alternative Disclosure**:
   If private vulnerability reporting is unavailable, contact the repository maintainers directly with the details of the issue.

### Information to Include

To help us investigate and resolve the issue quickly, please provide:

- A clear description of the vulnerability.
- Steps to reproduce the vulnerability (proof of concept, curl commands, or reproduction script).
- The affected component (e.g., Image Proxy, OPDS feed, SQLite DAL, Auth, FlareSolverr bridge, SSRF filter).
- Potential impact and attack scenarios.
- Any suggested mitigations or patches if you have developed one.

### Response Timeline

- **Initial Acknowledgment**: Within 48 hours of receipt.
- **Triage & Assessment**: Within 5 business days with an assessment of severity and impact.
- **Fix & Patch**: A patched release will be published promptly, with coordinated public advisory disclosure following reasonable patch adoption time.

---

## 🔒 Self-Hosting Security Best Practices

When deploying Graywood Reader in production or exposing it over the internet, we strongly recommend following these security guidelines:

### 1. Configure a Strong Encryption Secret
Graywood Reader uses AES-256-GCM to encrypt sensitive tokens (e.g., FlareSolverr tokens, AniList credentials, session state).
- Set `ENCRYPTION_SECRET` in your `.env` to a high-entropy string of at least **32 characters**.
- Do **not** commit `.env` or database files (`data/manga.db`) into source control.

### 2. Enable Multi-User Authentication for Public Access
- If running on a server accessible outside `127.0.0.1`, set:
  ```env
  REQUIRE_AUTH=1
  ```
  This enforces session authentication tokens on all non-loopback API and web requests.

### 3. Deploy Behind a Secure Reverse Proxy
- Always terminate TLS/HTTPS using **Nginx**, **Caddy**, **Traefik**, or **Cloudflare Tunnel**.
- Restrict internal management ports and database files from direct web exposure.
- Enforce HTTP Strict Transport Security (`HSTS`) and appropriate rate-limiting headers.

### 4. Server-Side Request Forgery (SSRF) Protection
- The built-in image proxy and scraper client filter out loopback, link-local, and RFC 1918 private IP addresses (e.g., `127.0.0.1`, `10.0.0.0/8`, `169.254.0.0/16`, `192.168.0.0/16`) to prevent intranet scanning.
- If integrating external solver services (e.g., FlareSolverr), place them in an isolated Docker network.

### 5. Automated Backups & Permissions
- Store database snapshots (`data/manga.db`) in a read/write-restricted directory owned by a non-root application user.
- Export periodic Tachiyomi JSON or full server migration ZIP backups for offsite disaster recovery.
