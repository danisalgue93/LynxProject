# Lynx Market — Security Hardening Guide

> Security best practices, threat model, and incident response procedures.

---

## Threat Model

### High-Risk Threats

1. **Unauthorized wallet access** → User loses funds
2. **Stolen JWT tokens** → Account takeover
3. **Database breach** → Leakage of all user data, emails, password hashes
4. **Smart contract exploit** → Protocol-wide fund loss
5. **Private key exposure** (treasury/managed wallets) → Permanent fund loss
6. **DDoS attack** → Service unavailability

### Medium-Risk Threats

1. **Order manipulation** → Unfair market outcomes
2. **Phishing** → User credential theft
3. **Man-in-the-middle (MITM)** → JWT or signature interception
4. **SQL injection** (Prisma mitigates most) → Database query interference
5. **Cross-site scripting (XSS)** → Session hijacking via JavaScript

### Low-Risk Threats

1. **Account enumeration** → Leak valid email addresses
2. **Rate limit bypass** → Resource exhaustion
3. **Timing attacks** → Information leakage

---

## Production Checklist

### Secrets Management

- [ ] All JWT/REFRESH secrets are 64+ hex characters (use `openssl rand -hex 64`)
- [ ] `TREASURY_SECRET_KEY` is stored in a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.), NOT in `.env`
- [ ] `MANAGED_WALLET_SEED` is stored securely and rotated quarterly
- [ ] `ADMIN_API_TOKEN` is rotated monthly
- [ ] `MOONPAY_SECRET_KEY` and `RESEND_API_KEY` are in a secrets manager
- [ ] No secrets are logged, even in Sentry
- [ ] `.env` file is in `.gitignore` and never committed

### Network Security

- [ ] TLS/HTTPS is enabled on all endpoints
- [ ] nginx CSP header is deployed (`Content-Security-Policy` with `default-src 'self'`)
- [ ] X-Content-Type-Options: `nosniff` is set (prevents MIME type sniffing)
- [ ] X-Frame-Options: `DENY` is set (prevents clickjacking)
- [ ] Referrer-Policy: `strict-origin-when-cross-origin` is set
- [ ] CORS origins are restricted to your frontend domain only
- [ ] HTTP is redirected to HTTPS (port 80 → 443)
- [ ] Firewall blocks all inbound traffic except:
  - Port 80 (ACME renewal)
  - Port 443 (HTTPS)
  - Database: internal only
  - Redis: internal only

### Authentication & Authorization

- [ ] JWT expiry is 15 minutes (short-lived)
- [ ] Refresh token expiry is 7 days
- [ ] Refresh tokens are HTTP-only cookies (cannot be accessed by JavaScript)
- [ ] Wallet login uses ed25519 signature verification (not just address check)
- [ ] Email verification is required in production (`REQUIRE_EMAIL_VERIFICATION=true`)
- [ ] Admin endpoints require `ADMIN_API_TOKEN` (not just JWT role check)
- [ ] Multi-admin setup (at least 2 admins in `ADMIN_WALLETS`)
- [ ] Password hashing uses bcrypt with salt rounds ≥ 10
- [ ] No session fixation vulnerabilities (tokens are random)

### Database Security

- [ ] PostgreSQL password is 32+ characters (use `openssl rand -hex 32`)
- [ ] Database user has least-privilege permissions (SELECT, INSERT, UPDATE, DELETE only)
- [ ] Database backups are encrypted at rest
- [ ] Database backups are stored off-site (separate cloud account or physical location)
- [ ] Database connection uses TLS/SSL (if remote)
- [ ] Connection pooling is configured (Prisma defaults to pool_size=10)
- [ ] `DATABASE_URL` is in a secrets manager, not in `.env`
- [ ] No public Internet access to database (VPC/security group restricted)

### Frontend Security

- [ ] React is built with `NODE_ENV=production` (minified, optimized)
- [ ] Source maps are NOT deployed (`npm run build` excludes them)
- [ ] CSP header blocks unsafe inline scripts
- [ ] no eval(), innerHTML, or other code injection vectors
- [ ] Third-party libraries (Magic, MoonPay) are loaded from CDN with integrity hashes
- [ ] VITE_* environment variables do not contain sensitive secrets
- [ ] Local storage only contains non-sensitive data
- [ ] Session tokens are stored in memory or HTTP-only cookies

### API Security

- [ ] All endpoints validate input with Zod schemas
- [ ] All endpoints check authentication/authorization
- [ ] Rate limiting is enabled (100 req/15 min per IP)
- [ ] Rate limiting uses Redis (distributed across instances)
- [ ] Sensitive fields (password, signature, token) are redacted in logs
- [ ] Error responses don't leak internal details (Prisma, stack traces)
- [ ] Request logging includes wallet redaction
- [ ] All POST/PATCH/DELETE endpoints are CSRF-protected (implicit via token validation)

### Monitoring & Logging

- [ ] Sentry is configured for backend errors
- [ ] Sentry is configured for frontend errors
- [ ] Admin actions are logged (market resolution, user creation, etc.)
- [ ] Failed login attempts are logged
- [ ] All errors are indexed in Sentry with severity levels
- [ ] Sentry alerts are configured for:
  - Any 500 error
  - Rate limit exhaustion
  - Database connection failures
  - Authentication failures (suspicious patterns)
- [ ] Log retention is set appropriately (30+ days)

### Smart Contract Security

- [ ] Anchor program has been audited by a third party
- [ ] Program upgrade authority is multi-sig or DAO-controlled
- [ ] Program is deployed to mainnet (not devnet)
- [ ] IDL file is published and matches on-chain program
- [ ] All treasury operations require multi-sig approval
- [ ] Emergency pause mechanism is documented and tested

### Incident Response

- [ ] Security contact email is documented
- [ ] Incident response playbook exists (who to contact, what to do)
- [ ] Regular security audits are scheduled (quarterly minimum)
- [ ] Penetration testing is planned before mainnet launch
- [ ] Disaster recovery plan is documented (data restoration, key recovery)
- [ ] Bug bounty program is announced (HackerOne, Immunefi, etc.)

---

## Common Vulnerabilities & Mitigations

### SQL Injection

**Mitigation**: Use Prisma (parameterized queries by default).

**Verification**:
```bash
# Grep for raw queries
grep -r "queryRaw\|$queryRawUnsafe" backend/src/
# Should be empty; if not, verify SQL is parameterized
```

### Cross-Site Scripting (XSS)

**Mitigation**: React escapes HTML by default; CSP header blocks inline scripts.

**Verification**:
```bash
# Check for innerHTML
grep -r "innerHTML" frontend/src/
# Check for eval, Function, etc.
grep -r "eval\|Function(" frontend/src/
# Should be empty
```

### Cross-Site Request Forgery (CSRF)

**Mitigation**: All state-changing requests require JWT (Bearer token), not cookies.

**Verification**: Attacker cannot POST to `/api/trades` without a valid JWT in `Authorization` header.

### Broken Authentication

**Mitigation**:
- Passwords are hashed with bcrypt (not MD5 or SHA1)
- JWT secrets are strong (64+ hex characters)
- Token expiry is short (15 minutes)
- Refresh tokens are HTTP-only cookies

**Verification**:
```bash
grep -r "md5\|sha1" backend/src/
# Should find nothing (bcrypt only)
```

### Sensitive Data Exposure

**Mitigation**:
- TLS/HTTPS is required
- Sensitive fields are redacted in logs
- No secrets in source code
- Error responses don't leak internals

**Verification**:
```bash
# Check for hardcoded secrets
grep -r "pk_test_\|sk_test_\|secret_" backend/src/ frontend/src/
# Should find nothing (only in .env.example with placeholders)

# Check .gitignore
cat .gitignore | grep "\.env"
# Should include .env and .env.local
```

### Insecure Deserialization

**Mitigation**: Zod validates all JSON input before deserialization.

**Verification**: All endpoints use Zod schemas in the async route handler.

### Using Components with Known Vulnerabilities

**Mitigation**: Run `npm audit` regularly and apply patches.

**Command**:
```bash
npm audit --audit-level=high
# Should return 0 vulnerabilities at high/critical level
```

### Broken Access Control

**Mitigation**:
- Routes check JWT and wallet ownership
- Admin endpoints require `ADMIN_API_TOKEN`
- Rate limiting prevents brute force

**Example**:
```typescript
// ✓ Good: Validates wallet belongs to logged-in user
GET /api/portfolio?wallet=...
// Only returns portfolio if wallet === JWT.userId

// ✗ Bad: No validation
GET /api/portfolio/secret-data
// Would leak data to any authenticated user
```

---

## Security Audit Checklist

Run this before every deployment:

```bash
# 1. Check for hardcoded secrets
grep -r "pk_test_\|sk_test_\|secret_\|CHANGE_ME" \
  backend/src frontend/src cripto/admin-panel/src \
  --exclude-dir=node_modules --exclude-dir=.next

# 2. Run dependency audit
npm audit --audit-level=high
cd backend && npm audit --audit-level=high
cd ../frontend && npm audit --audit-level=high

# 3. Check for dangerous patterns
grep -r "eval\|innerHTML\|queryRawUnsafe\|\$queryRawUnsafe" \
  backend/src frontend/src \
  --exclude-dir=node_modules

# 4. Verify environment variables
./scripts/validate-env.sh

# 5. Check secrets are not logged
grep -r "password\|JWT_SECRET\|REFRESH_SECRET" \
  backend/src/server.ts | grep -v "REDACTED\|Filtered"
# Should return nothing

# 6. Verify CSP header is set
grep -i "content-security-policy" nginx/nginx.conf

# 7. Check TLS is enforced
grep -i "ssl_protocols\|ssl_ciphers" nginx/nginx.conf
```

---

## Secrets Rotation Schedule

| Secret | Frequency | Procedure |
|--------|-----------|-----------|
| JWT_SECRET | Quarterly | Generate new value, restart backend, existing tokens invalidated (users re-login) |
| REFRESH_SECRET | Quarterly | Same as JWT_SECRET |
| ADMIN_API_TOKEN | Monthly | Update in secrets manager, restart backend, notify admins |
| TREASURY_SECRET_KEY | Annually | Move treasury to new wallet, disable old key, test recovery |
| MANAGED_WALLET_SEED | Quarterly | Generate new seed, migrate user wallets, test recovery |
| Database password | Annually | Update in secrets manager, restart backend and migrate service |

---

## Incident Response Procedures

### Suspected JWT Compromise

1. **Immediate**: Rotate `JWT_SECRET` and `REFRESH_SECRET`
2. **Notify**: Email affected users with instructions to re-login
3. **Monitor**: Watch Sentry for suspicious activity (trades, transfers, etc.)
4. **Document**: Record incident in incident log, timeline, and resolution

### Suspected Private Key Exposure (treasury or managed wallet)

1. **Immediate**: Revoke the exposed key in a multi-sig transaction
2. **Move funds**: Transfer treasury funds to new wallet
3. **Rotate**: Generate new `TREASURY_SECRET_KEY` or `MANAGED_WALLET_SEED`
4. **Notify**: Email users and post incident disclosure

### DDoS Attack

1. **Immediate**: Enable Cloudflare/Akamai rate limiting
2. **Contact**: Reach out to hosting provider DDoS mitigation team
3. **Scale**: Increase backend/database resources
4. **Monitor**: Watch uptime dashboards and error rates

### Database Breach

1. **Immediate**: Take affected services offline
2. **Assess**: Determine what data was exposed and how
3. **Notify**: Email users per privacy regulations (GDPR, CCPA, etc.)
4. **Restore**: Restore from clean backup
5. **Investigate**: Conduct forensic analysis to prevent recurrence

### Malicious Market Resolution (admin abuse)

1. **Detect**: Monitor for resolution on closed markets or markets where outcome is already known
2. **Freeze**: Disable the admin account immediately
3. **Investigate**: Check audit logs for unauthorized resolution
4. **Rollback**: If possible, revert the resolution via smart contract multi-sig
5. **Compensate**: Reimburse affected users if necessary

---

## Security Testing

### Manual Security Testing

```bash
# Test CORS rejection
curl -H "Origin: https://attacker.com" \
     -H "Access-Control-Request-Method: POST" \
     https://yourdomain.com/api/trades
# Should return 403 or CORS error

# Test missing JWT
curl https://yourdomain.com/api/markets
# Should return 401 Unauthorized

# Test invalid JWT
curl -H "Authorization: Bearer invalid_token" \
     https://yourdomain.com/api/markets
# Should return 401 Unauthorized

# Test rate limiting
for i in {1..150}; do
  curl -H "Authorization: Bearer $token" \
       https://yourdomain.com/api/markets
done
# Should return 429 after 100 requests

# Test Zod validation
curl -X POST https://yourdomain.com/auth/register \
     -H "Content-Type: application/json" \
     -d '{"email": "not-an-email", "password": "short"}'
# Should return 400 with specific validation errors
```

### Automated Security Testing

```bash
# OWASP ZAP scan
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t https://yourdomain.com

# Snyk vulnerability scan
snyk test backend/
snyk test frontend/

# SonarQube code quality
docker run --rm -e SONAR_HOST_URL=https://sonarcloud.io \
  -e SONAR_LOGIN=$SONAR_TOKEN \
  -v $(pwd):/usr/src \
  sonarsource/sonar-scanner-cli
```

---

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/)
- [Solana Security Best Practices](https://docs.solana.com/developing/onchain-programs/debugging#security-considerations)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
