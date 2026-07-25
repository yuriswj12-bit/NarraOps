# Alibaba Cloud public beta deployment

This guide deploys NarraOps on a small Alibaba Cloud ECS or Simple Application Server using Docker Compose and Caddy.

The public beta exposes:

- `/`
- `/app`
- `/api/v1/health`
- review-only `/api/v1/*` endpoints
- `/api/v1/events`

Keep `REAL_EXECUTION_ENABLED=false`. Do not configure production wallet custody, private keys, signer services, or real transaction broadcasting for this beta.

## Required Alibaba Cloud resources

- One Linux server, preferably Ubuntu 22.04 or 24.04.
- Public IPv4 address.
- Security group inbound rules for TCP `22`, `80`, and `443`.
- Domain A records pointing to the server public IP.

Recommended minimum server for beta:

- 2 vCPU
- 2 GB RAM
- 40 GB disk

## DNS

In Alibaba Cloud DNS, create:

```text
Type: A
Host: @
Value: YOUR_SERVER_PUBLIC_IP
TTL: 600

Type: A
Host: www
Value: YOUR_SERVER_PUBLIC_IP
TTL: 600
```

DNS can take a few minutes to propagate. Verify from your local machine:

```powershell
nslookup narraops.example.com
nslookup www.narraops.example.com
```

## Server bootstrap

SSH into the server and run:

```bash
curl -fsSL https://raw.githubusercontent.com/yuriswj12-bit/NarraOps/main/scripts/deploy/alicloud-bootstrap.sh | sudo bash
```

Then reconnect so your user can access Docker:

```bash
exit
ssh <user>@<server-ip>
```

## Deploy

Clone the repository:

```bash
sudo mkdir -p /opt/narraops
sudo chown "$USER:$USER" /opt/narraops
git clone https://github.com/yuriswj12-bit/NarraOps.git /opt/narraops
cd /opt/narraops
```

Create `.env` from `.env.example` and set at least:

```bash
cp .env.example .env
nano .env
```

Production beta values:

```text
APP_ORIGIN=https://narraops.example.com
SECURE_COOKIES=true
REAL_EXECUTION_ENABLED=false
```

Install the Caddy config:

```bash
sudo cp deploy/alicloud/Caddyfile.example /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Start NarraOps:

```bash
docker compose -f deploy/docker/docker-compose.alicloud.yml up --build -d
```

## Verify

From the server:

```bash
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/api/v1/health
```

From your local machine:

```powershell
curl.exe -I https://narraops.example.com/
curl.exe -I https://narraops.example.com/app
curl.exe https://narraops.example.com/api/v1/health
```

## Update deployment

```bash
cd /opt/narraops
git pull --ff-only
docker compose -f deploy/docker/docker-compose.alicloud.yml up --build -d
docker image prune -f
```

## Rollback

Find the previous commit and reset only on the server checkout:

```bash
cd /opt/narraops
git log --oneline -5
git checkout <previous-good-commit>
docker compose -f deploy/docker/docker-compose.alicloud.yml up --build -d
```

After rollback, keep `REAL_EXECUTION_ENABLED=false` and verify health checks.
