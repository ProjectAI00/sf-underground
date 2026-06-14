#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE_DIR="$ROOT/deploy/aws/.state"
REGION="${AWS_REGION:-us-east-1}"

if [[ -f "$STATE_DIR/cloudfront-id" ]]; then
  CF_ID="$(cat "$STATE_DIR/cloudfront-id")"
  ETAG="$(aws cloudfront get-distribution-config --id "$CF_ID" --query ETag --output text)"
  aws cloudfront get-distribution-config --id "$CF_ID" --query DistributionConfig > /tmp/cf-config.json
  python3 - << 'PY'
import json
cfg = json.load(open("/tmp/cf-config.json"))
cfg["Enabled"] = False
json.dump(cfg, open("/tmp/cf-config-disabled.json", "w"))
PY
  aws cloudfront update-distribution --id "$CF_ID" --if-match "$ETAG" --distribution-config file:///tmp/cf-config-disabled.json >/dev/null
  aws cloudfront delete-distribution --id "$CF_ID" --if-match "$(aws cloudfront get-distribution --id "$CF_ID" --query ETag --output text)" >/dev/null || true
fi

if [[ -f "$STATE_DIR/eip-allocation" ]]; then
  ALLOC="$(cat "$STATE_DIR/eip-allocation")"
  aws ec2 release-address --allocation-id "$ALLOC" --region "$REGION" 2>/dev/null || true
fi

if [[ -f "$STATE_DIR/instance-id" ]]; then
  IID="$(cat "$STATE_DIR/instance-id")"
  aws ec2 terminate-instances --instance-ids "$IID" --region "$REGION" >/dev/null || true
fi

rm -rf "$STATE_DIR"
echo "Teardown started (CloudFront delete may take a few minutes)."
