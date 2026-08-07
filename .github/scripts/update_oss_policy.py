import os
import sys
import json
import requests
import oss2
from tenacity import retry, stop_after_attempt, wait_fixed

CF_IPS_V4 = "https://www.cloudflare.com/ips-v4"
CF_IPS_V6 = "https://www.cloudflare.com/ips-v6"
MIN_IP_COUNT = 5   # 安全阈值：至少需要这么多 IP 段才更新

@retry(stop=stop_after_attempt(3), wait=wait_fixed(10))
def fetch_ips(url):
    """带重试的 IP 列表获取"""
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    return [line.strip() for line in resp.text.splitlines() if line.strip()]

def get_cloudflare_ips():
    ips = fetch_ips(CF_IPS_V4) + fetch_ips(CF_IPS_V6)
    if len(ips) < MIN_IP_COUNT:
        raise RuntimeError(f"Too few Cloudflare IPs fetched: {len(ips)}. Policy update aborted.")
    return ips

def build_policy(ip_list, bucket_name):
    """构造 Deny + NotIpAddress 的 Bucket Policy"""
    return json.dumps({
        "Version": "1",
        "Statement": [{
            "Effect": "Deny",
            "Principal": ["*"],
            "Action": ["oss:GetObject"],
            "Resource": [f"acs:oss:cn-hongkong:*:{bucket_name}/*"],
            "Condition": {
                "NotIpAddress": {"acs:SourceIp": ip_list}
            }
        }]
    })

def main():
    bucket_name = os.environ["OSS_BUCKET"]
    endpoint = os.environ["OSS_ENDPOINT"]

    # 1. 获取 Cloudflare IP 列表（带重试）
    ips = get_cloudflare_ips()
    print(f"Fetched {len(ips)} Cloudflare IP ranges")

    # 2. 使用 OIDC 注入的 STS 临时凭证连接 OSS
    auth = oss2.StsAuth(
        os.environ["ALIBABA_CLOUD_ACCESS_KEY_ID"],
        os.environ["ALIBABA_CLOUD_ACCESS_KEY_SECRET"],
        os.environ["ALIBABA_CLOUD_SECURITY_TOKEN"]
    )
    bucket = oss2.Bucket(auth, endpoint, bucket_name)

    # 3. （可选）读取并打印当前策略，用于审计
    try:
        current_policy = bucket.get_bucket_policy()
        print("Current policy fetched (for audit):")
        print(current_policy)
    except oss2.exceptions.OssError as e:
        print(f"Warning: could not fetch current policy ({e}). Proceeding with update.")

    # 4. 应用新策略
    policy_text = build_policy(ips, bucket_name)
    result = bucket.put_bucket_policy(policy_text)
    print(f"Policy updated successfully. Status: {result.status}")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"FATAL ERROR: {e}", file=sys.stderr)
        sys.exit(1)