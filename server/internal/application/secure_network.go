package application

import (
	"context"
	"jpano.dev/portfolio/internal/networkpolicy"
	"net/http"
	"net/netip"
	"time"
)

func allowedIP(ip netip.Addr) bool     { return networkpolicy.AllowedIP(ip) }
func publicNetworkURL(url string) bool { return networkpolicy.PublicNetworkURL(url) }
func publicHTTPClient(timeout time.Duration) *http.Client {
	return networkpolicy.PublicHTTPClient(timeout)
}
func projectURLReachableContext(ctx context.Context, url string) bool {
	return networkpolicy.ProjectURLReachableContext(ctx, url)
}
