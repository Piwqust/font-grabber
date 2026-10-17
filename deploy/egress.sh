#!/bin/sh
# Run on the Linux Docker host. Only Fount app 172.30.87.2 is affected.
#   egress.sh          apply (idempotent, no unfiltered gap while the app runs)
#   egress.sh boot     apply before dockerd starts (creates DOCKER-USER if missing)
#   egress.sh ensure   re-apply only when a rule has disappeared (for the timer)
#   egress.sh remove   undo everything
# Optional: FOUNT_PROXY_USER=caddy limits host-originated connections to the app
# port to that user, so no other local process can pose as the trusted proxy.
# Optional: FOUNT_HOST_IP=<public IPv4 of this host> also blocks the app from
# calling back into the host through its own public address.
set -eu
if [ "$(id -u)" != 0 ]; then echo "Run with sudo." >&2; exit 1; fi
app_ip=172.30.87.2
app_port=8787
chain=FOUNT-EGRESS
proxy_user=${FOUNT_PROXY_USER:-}

has_rules() {
    iptables -C DOCKER-USER -s "$app_ip" -j "$chain" 2>/dev/null &&
        iptables -C INPUT -s "$app_ip" -m conntrack --ctstate NEW -j REJECT 2>/dev/null &&
        { [ -z "$proxy_user" ] || iptables -C OUTPUT -d "$app_ip" -p tcp --dport "$app_port" -m owner ! --uid-owner "$proxy_user" -j REJECT 2>/dev/null; }
}

if [ "${1:-}" = "remove" ]; then
    iptables -C DOCKER-USER -s "$app_ip" -j "$chain" 2>/dev/null && iptables -D DOCKER-USER -s "$app_ip" -j "$chain" || :
    iptables -C INPUT -s "$app_ip" -m conntrack --ctstate NEW -j REJECT 2>/dev/null && iptables -D INPUT -s "$app_ip" -m conntrack --ctstate NEW -j REJECT || :
    if [ -n "$proxy_user" ]; then
        iptables -C OUTPUT -d "$app_ip" -p tcp --dport "$app_port" -m owner ! --uid-owner "$proxy_user" -j REJECT 2>/dev/null &&
            iptables -D OUTPUT -d "$app_ip" -p tcp --dport "$app_port" -m owner ! --uid-owner "$proxy_user" -j REJECT || :
    fi
    iptables -F "$chain" 2>/dev/null || :
    iptables -X "$chain" 2>/dev/null || :
    exit 0
fi
if [ "${1:-}" = "ensure" ] && has_rules; then exit 0; fi
if [ "${1:-}" = "boot" ]; then
    # dockerd keeps an existing DOCKER-USER chain and its rules, so the filter is
    # in place before any container can be restarted by the daemon itself.
    iptables -nL DOCKER-USER >/dev/null 2>&1 || iptables -N DOCKER-USER
fi
iptables -nL DOCKER-USER >/dev/null 2>&1 || { echo "Docker iptables backend with DOCKER-USER is required. No rules changed." >&2; exit 1; }

# Rebuilding the live chain would briefly allow everything, so hold new
# connections from the app with a temporary reject while it is rebuilt.
iptables -I DOCKER-USER 1 -s "$app_ip" -m conntrack --ctstate NEW -j REJECT
trap 'iptables -D DOCKER-USER -s "$app_ip" -m conntrack --ctstate NEW -j REJECT 2>/dev/null || :' EXIT
iptables -N "$chain" 2>/dev/null || :
iptables -F "$chain"
iptables -A "$chain" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
for subnet in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/3 ${FOUNT_HOST_IP:+$FOUNT_HOST_IP/32}; do
    iptables -A "$chain" -d "$subnet" -j REJECT
done
iptables -A "$chain" -j RETURN
iptables -C DOCKER-USER -s "$app_ip" -j "$chain" 2>/dev/null || iptables -I DOCKER-USER 2 -s "$app_ip" -j "$chain"

iptables -C INPUT -s "$app_ip" -m conntrack --ctstate NEW -j REJECT 2>/dev/null || iptables -I INPUT 1 -s "$app_ip" -m conntrack --ctstate NEW -j REJECT
if [ -n "$proxy_user" ]; then
    id -u "$proxy_user" >/dev/null 2>&1 || { echo "User $proxy_user does not exist." >&2; exit 1; }
    iptables -C OUTPUT -d "$app_ip" -p tcp --dport "$app_port" -m owner ! --uid-owner "$proxy_user" -j REJECT 2>/dev/null ||
        iptables -I OUTPUT 1 -d "$app_ip" -p tcp --dport "$app_port" -m owner ! --uid-owner "$proxy_user" -j REJECT
fi
echo "Fount private-network egress blocked."
