#!/usr/bin/env bash
# Create CloudFront distribution for wss:// (requires cloudfront:CreateDistribution IAM).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE_DIR="$ROOT/deploy/aws/.state"
REGION="${AWS_REGION:-us-east-1}"
CACHE_POLICY_ID="4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
ORIGIN_REQUEST_POLICY_ID="b689b0a8-53d0-40ab-baf2-68738e2966ac"

PUBLIC_DNS="$(cat "$STATE_DIR/public-dns")"
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

CF_OUT="$(aws cloudfront create-distribution --distribution-config "file://$CF_JSON")"
CF_ID="$(echo "$CF_OUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['Distribution']['Id'])")"
CF_DOMAIN="$(echo "$CF_OUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['Distribution']['DomainName'])")"
echo "$CF_ID" > "$STATE_DIR/cloudfront-id"
echo "$CF_DOMAIN" > "$STATE_DIR/cloudfront-domain"
echo "wss://$CF_DOMAIN" > "$STATE_DIR/mp-url"
rm -f "$CF_JSON"

python3 - "$ROOT/src/config.js" "wss://$CF_DOMAIN" << 'PY'
import re, sys
path, url = sys.argv[1], sys.argv[2]
text = open(path).read()
text = re.sub(r'return "wss?://[^"]+";', f'return "{url}";', text, count=1)
open(path, "w").write(text)
PY

echo "CloudFront ready (propagate ~5 min): wss://$CF_DOMAIN"
