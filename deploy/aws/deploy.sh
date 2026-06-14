#!/usr/bin/env bash
# Deploy Retro Racer SF multiplayer to cheapest AWS stack:
#   EC2 t4g.nano (~$3/mo) + Elastic IP + CloudFront (free TLS wss://)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SERVER_DIR="$ROOT/server"
STATE_DIR="$ROOT/deploy/aws/.state"
REGION="${AWS_REGION:-us-east-1}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t4g.nano}"
KEY_NAME="${KEY_NAME:-imi-train}"
PROJECT="retro-racer-mp"
CACHE_POLICY_ID="4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
ORIGIN_REQUEST_POLICY_ID="b689b0a8-53d0-40ab-baf2-68738e2966ac"

mkdir -p "$STATE_DIR"
log() { printf '==> %s\n' "$*"; }

AMI="$(aws ec2 describe-images \
  --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023*-kernel-6.1-arm64" "Name=state,Values=available" \
  --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
  --output text \
  --region "$REGION")"
log "AMI $AMI"

if [[ -f "$STATE_DIR/sg-id" ]]; then
  SG_ID="$(cat "$STATE_DIR/sg-id")"
else
  VPC_ID="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text --region "$REGION")"
  SG_ID="$(aws ec2 create-security-group \
    --group-name "$PROJECT-sg" \
    --description "Retro Racer SF multiplayer relay" \
    --vpc-id "$VPC_ID" \
    --query GroupId --output text --region "$REGION" 2>/dev/null || true)"
  if [[ -z "$SG_ID" || "$SG_ID" == "None" ]]; then
    SG_ID="$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$PROJECT-sg" --query 'SecurityGroups[0].GroupId' --output text --region "$REGION")"
  fi
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 8787 --cidr 0.0.0.0/0 --region "$REGION" 2>/dev/null || true
  echo "$SG_ID" > "$STATE_DIR/sg-id"
fi
log "Security group $SG_ID"

if [[ -f "$STATE_DIR/instance-id" ]]; then
  INSTANCE_ID="$(cat "$STATE_DIR/instance-id")"
  STATE="$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].State.Name' --output text --region "$REGION" 2>/dev/null || echo terminated)"
  if [[ "$STATE" == "terminated" || "$STATE" == "shutting-down" ]]; then
    rm -f "$STATE_DIR/instance-id" "$STATE_DIR/public-dns" "$STATE_DIR/eip-allocation"
  fi
fi

BUNDLE_B64="$(tar -C "$SERVER_DIR" -cz --exclude node_modules package.json package-lock.json index.js | base64 | tr -d '\n')"

if [[ ! -f "$STATE_DIR/instance-id" ]]; then
  USER_DATA="#!/bin/bash
set -eux
dnf install -y nodejs npm tar
mkdir -p /opt/retro-racer-mp
echo '$BUNDLE_B64' | base64 -d | tar -xz -C /opt/retro-racer-mp
cd /opt/retro-racer-mp
npm ci --omit=dev
cat > /etc/systemd/system/retro-racer-mp.service << 'UNIT'
[Unit]
Description=Retro Racer SF Multiplayer
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/retro-racer-mp
Environment=PORT=8787
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now retro-racer-mp
"
  INSTANCE_ID="$(aws ec2 run-instances \
    --image-id "$AMI" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SG_ID" \
    --user-data "$USER_DATA" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$PROJECT}]" \
    --query Instances[0].InstanceId \
    --output text \
    --region "$REGION")"
  echo "$INSTANCE_ID" > "$STATE_DIR/instance-id"
  log "Launched $INSTANCE_ID ($INSTANCE_TYPE)"
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"
else
  INSTANCE_ID="$(cat "$STATE_DIR/instance-id")"
  log "Reusing instance $INSTANCE_ID"
fi

PUBLIC_DNS="$(aws ec2 describe-instances \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicDnsName' \
  --output text \
  --region "$REGION")"
echo "$PUBLIC_DNS" > "$STATE_DIR/public-dns"

if [[ ! -f "$STATE_DIR/eip-allocation" ]]; then
  ALLOC="$(aws ec2 allocate-address --domain vpc --query AllocationId --output text --region "$REGION")"
  echo "$ALLOC" > "$STATE_DIR/eip-allocation"
  aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC" --region "$REGION" >/dev/null
  log "Attached Elastic IP"
fi

PUBLIC_IP="$(aws ec2 describe-instances \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text \
  --region "$REGION")"
echo "$PUBLIC_IP" > "$STATE_DIR/public-ip"
log "Public IP $PUBLIC_IP"

log "Waiting for origin health http://$PUBLIC_IP:8787/health ..."
for i in $(seq 1 60); do
  if curl -sf --max-time 5 "http://$PUBLIC_IP:8787/health" >/dev/null 2>&1; then
    log "Origin healthy"
    break
  fi
  sleep 10
  if [[ "$i" -eq 60 ]]; then
    echo "Origin health timeout — check instance console log:" >&2
    echo "  aws ec2 get-console-output --instance-id $INSTANCE_ID --region $REGION" >&2
    exit 1
  fi
done

if [[ ! -f "$STATE_DIR/cloudfront-id" ]]; then
  CALLER="retro-racer-mp-$(date +%s)"
  CF_JSON="$(mktemp)"
  cat > "$CF_JSON" << EOF
{
  "CallerReference": "$CALLER",
  "Comment": "Retro Racer SF multiplayer WebSocket",
  "Enabled": true,
  "HttpVersion": "http2and3",
  "PriceClass": "PriceClass_100",
  "Origins": {
    "Quantity": 1,
    "Items": [{
      "Id": "mp-origin",
      "DomainName": "$PUBLIC_DNS",
      "CustomOriginConfig": {
        "HTTPPort": 8787,
        "HTTPSPort": 443,
        "OriginProtocolPolicy": "http-only",
        "OriginSslProtocols": { "Quantity": 1, "Items": ["TLSv1.2"] },
        "OriginReadTimeout": 60,
        "OriginKeepaliveTimeout": 5
      }
    }]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "mp-origin",
    "ViewerProtocolPolicy": "https-only",
    "AllowedMethods": {
      "Quantity": 7,
      "Items": ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
      "CachedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] }
    },
    "CachePolicyId": "$CACHE_POLICY_ID",
    "OriginRequestPolicyId": "$ORIGIN_REQUEST_POLICY_ID",
    "Compress": false
  }
}
EOF
  CF_OUT="$(aws cloudfront create-distribution --distribution-config "file://$CF_JSON" --region "$REGION")"
  CF_ID="$(echo "$CF_OUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['Distribution']['Id'])")"
  CF_DOMAIN="$(echo "$CF_OUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['Distribution']['DomainName'])")"
  echo "$CF_ID" > "$STATE_DIR/cloudfront-id"
  echo "$CF_DOMAIN" > "$STATE_DIR/cloudfront-domain"
  rm -f "$CF_JSON"
  log "CloudFront $CF_ID ($CF_DOMAIN) — allow ~5 min to propagate"
else
  CF_DOMAIN="$(cat "$STATE_DIR/cloudfront-domain")"
  log "Reusing CloudFront $CF_DOMAIN"
fi

MP_URL="wss://${CF_DOMAIN}"
echo "$MP_URL" > "$STATE_DIR/mp-url"

python3 - "$ROOT/src/config.js" "$MP_URL" << 'PY'
import re, sys
path, url = sys.argv[1], sys.argv[2]
text = open(path).read()
text = re.sub(
    r'return "wss://[^"]+";',
    f'return "{url}";',
    text,
    count=1,
)
open(path, "w").write(text)
PY

log "Done"
echo
echo "Multiplayer URL: $MP_URL"
echo "EC2 instance:    $INSTANCE_ID ($INSTANCE_TYPE) @ $PUBLIC_IP"
echo "Est. cost:       ~\$4/month (t4g.nano + disk; CloudFront free tier for game traffic)"
echo
echo "Updated src/config.js — redeploy the Vercel static site to ship the new wss URL."
