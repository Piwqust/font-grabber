use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use anyhow::{anyhow, bail, Context, Result};
use url::{Host, Url};

/// Validate a URL before the server uses it as an outbound request target.
///
/// The hosted app is an authenticated proxy, so it must not be able to reach
/// loopback, link-local, private, or otherwise reserved network addresses.
pub async fn validate_public_url(raw: &str) -> Result<Url> {
    let parsed = Url::parse(raw).with_context(|| format!("Invalid URL: {raw}"))?;
    validate_public_target(&parsed).await?;
    Ok(parsed)
}

pub async fn validate_public_target(url: &Url) -> Result<()> {
    validate_url_shape(url)?;
    if !matches!(url.scheme(), "http" | "https") {
        bail!("Only http:// and https:// URLs are supported");
    }
    if !url.username().is_empty() || url.password().is_some() {
        bail!("URLs with embedded credentials are not supported");
    }

    let host = url.host().ok_or_else(|| anyhow!("URL has no hostname"))?;

    match host {
        Host::Ipv4(address) => {
            if is_blocked_ip(IpAddr::V4(address)) {
                bail!("Requests to private or reserved network addresses are blocked");
            }
        }
        Host::Ipv6(address) => {
            if is_blocked_ip(IpAddr::V6(address)) {
                bail!("Requests to private or reserved network addresses are blocked");
            }
        }
        Host::Domain(domain) => {
            let lower = domain.trim_end_matches('.').to_ascii_lowercase();
            if lower == "localhost"
                || lower.ends_with(".localhost")
                || lower == "local"
                || lower.ends_with(".local")
            {
                bail!("Local hostnames are blocked");
            }

            let port = url.port_or_known_default().unwrap_or(443);
            let addresses = tokio::net::lookup_host((domain, port))
                .await
                .with_context(|| format!("Could not resolve hostname {domain}"))?;
            let mut found_address = false;
            for address in addresses {
                found_address = true;
                if is_blocked_ip(address.ip()) {
                    bail!("Hostname resolves to a private or reserved network address");
                }
            }
            if !found_address {
                bail!("Hostname did not resolve to an address");
            }
        }
    }

    Ok(())
}

pub(crate) fn is_blocked_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => is_blocked_ipv4(address),
        IpAddr::V6(address) => is_blocked_ipv6(address),
    }
}

fn is_blocked_ipv4(address: Ipv4Addr) -> bool {
    let [a, b, c, _] = address.octets();
    a == 0
        || a == 10
        || a == 127
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 192 && b == 168)
        || (a == 198 && (18..=19).contains(&b))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 224
}

fn is_blocked_ipv6(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    let ipv4_mapped = segments[..5].iter().all(|segment| *segment == 0) && segments[5] == 0xffff;
    if ipv4_mapped {
        let high = segments[6];
        let low = segments[7];
        return is_blocked_ipv4(Ipv4Addr::new(
            (high >> 8) as u8,
            high as u8,
            (low >> 8) as u8,
            low as u8,
        ));
    }

    address.is_unspecified()
        || (segments[0] & 0xe000) != 0x2000
        || address.is_loopback()
        || address.is_multicast()
        || (segments[0] & 0xfe00) == 0xfc00
        || (segments[0] & 0xffc0) == 0xfe80
        || (segments[0] == 0x2001 && segments[1] == 0x0db8)
}

pub(crate) fn validate_url_shape(url: &Url) -> Result<()> {
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        bail!("Only public HTTP/HTTPS URLs without credentials are supported");
    }
    match url.host().ok_or_else(|| anyhow!("URL has no hostname"))? {
        Host::Ipv4(ip) if is_blocked_ip(ip.into()) => {
            bail!("Private network addresses are blocked")
        }
        Host::Ipv6(ip) if is_blocked_ip(ip.into()) => {
            bail!("Private network addresses are blocked")
        }
        Host::Domain(name) => {
            let name = name.trim_end_matches('.').to_ascii_lowercase();
            if name == "localhost"
                || name.ends_with(".localhost")
                || name == "local"
                || name.ends_with(".local")
            {
                bail!("Local hostnames are blocked");
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_private_and_reserved_ip_ranges() {
        for value in [
            "10.0.0.1",
            "127.0.0.1",
            "169.254.169.254",
            "192.168.1.1",
            "224.0.0.1",
            "::1",
            "fc00::1",
            "fe80::1",
        ] {
            let address: IpAddr = value.parse().unwrap();
            assert!(is_blocked_ip(address), "{value} should be blocked");
        }
    }

    #[tokio::test]
    async fn rejects_local_urls_before_network_access() {
        assert!(validate_public_url("http://127.0.0.1:8787/").await.is_err());
        assert!(validate_public_url("http://localhost/").await.is_err());
    }
}
