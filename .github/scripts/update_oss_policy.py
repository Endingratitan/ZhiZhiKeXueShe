import os, sys, json
import requests
import oss2
from tenacity import retry, stop_after_attempt, wait_fixed
from aliyunsdkcore.client import AcsClient
from aliyunsdkcore.request import CommonRequest
from aliyunsdksts.request.v20150401 import AssumeRoleRequest

CF_IPS_V4 = "https://www.cloudflare.com/ips-v4"
CF_IPS_V6 = "https://www.cloudflare.com/ips-v6"
MIN_IP_COUNT = 5

@retry(stop=stop_after_attempt(3), wait=wait_fixed(10))
def fetch_ips(url):
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    return [line.strip() for line in resp.text.splitlines() if line.strip()]

def get_cloudflare_ips():
    ips = fetch_ips(CF_IPS_V4) + fetch_ips(CF_IPS_V6)
    if len(ips) < MIN_IP_COUNT:
        raise RuntimeError(f"Too few Cloudflare IPs: {len(ips)}")
    return ips

def build_policy(ip_list, bucket_name):
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

def get_sts_token(ak_id, ak_secret, role_arn, region="cn-hongkong"):
    """使用长期AK扮演角色，获取临时安全令牌"""
    sts_endpoint = f"sts.{region}.aliyuncs.com"
    # 修正：构造 Client 时传入正确的 region_id，再用 set_endpoint 指定端点
    client = AcsClient(ak_id, ak_secret, region)
    client.set_endpoint(sts_endpoint)
    req = AssumeRoleRequest.AssumeRoleRequest()
    req.set_RoleArn(role_arn)
    req.set_RoleSessionName("gh-actions-oss-policy")
    req.set_DurationSeconds(3600)
    resp = client.do_action_with_exception(req)
    return json.loads(resp)["Credentials"]

def main():
    bucket_name = os.environ["OSS_BUCKET"]
    endpoint = os.environ["OSS_ENDPOINT"]
    ak_id = os.environ["ALIYUN_ACCESS_KEY_ID"]
    ak_secret = os.environ["ALIYUN_ACCESS_KEY_SECRET"]
    role_arn = os.environ["ALIYUN_ROLE_ARN"]
    region = os.environ.get("ALIYUN_REGION", "cn-hongkong")

    # 1. Cloudflare IPs
    ips = get_cloudflare_ips()
    print(f"Fetched {len(ips)} Cloudflare IP ranges")

    # 2. STS
    creds = get_sts_token(ak_id, ak_secret, role_arn, region)
    print(f"STS token obtained, expiry: {creds['Expiration']}")

    # 3. Audit: print assumed role identity
    verify_client = AcsClient(
        creds["AccessKeyId"], creds["AccessKeySecret"],
        region, security_token=creds["SecurityToken"]
    )
    verify_client.set_endpoint(f"sts.{region}.aliyuncs.com")
    req = CommonRequest()
    req.set_domain(f"sts.{region}.aliyuncs.com")
    req.set_version("2015-04-01")
    req.set_action_name("GetCallerIdentity")
    req.set_method("POST")
    identity = json.loads(verify_client.do_action_with_exception(req))
    print(f"Assumed role principal: {identity.get('Arn', 'unknown')}")

    # 4. Update OSS bucket policy
    auth = oss2.StsAuth(creds["AccessKeyId"], creds["AccessKeySecret"], creds["SecurityToken"])
    bucket = oss2.Bucket(auth, endpoint, bucket_name)
    policy_text = build_policy(ips, bucket_name)
    result = bucket.put_bucket_policy(policy_text)
    print(f"Bucket policy updated. Status: {result.status}")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"FATAL: {e}", file=sys.stderr)
        sys.exit(1)