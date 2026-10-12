package main

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

var blockedNetworks = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("10.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("127.0.0.0/8"), netip.MustParsePrefix("169.254.0.0/16"), netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"), netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/3"), netip.MustParsePrefix("::/128"), netip.MustParsePrefix("::1/128"),
	netip.MustParsePrefix("fc00::/7"), netip.MustParsePrefix("fe80::/10"), netip.MustParsePrefix("ff00::/8"), netip.MustParsePrefix("2001:db8::/32"), netip.MustParsePrefix("64:ff9b::/96"), netip.MustParsePrefix("64:ff9b:1::/48"), netip.MustParsePrefix("2002::/16"),
}

func allowedIP(value netip.Addr) bool {
	value = value.Unmap()
	if !value.IsValid() || !value.IsGlobalUnicast() {
		return false
	}
	for _, prefix := range blockedNetworks {
		if prefix.Contains(value) {
			return false
		}
	}
	return true
}
func publicNetworkURL(value string) bool {
	u, err := url.Parse(value)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.User == nil && u.Hostname() != "" && !strings.EqualFold(u.Hostname(), "localhost") && !strings.HasSuffix(strings.ToLower(u.Hostname()), ".local")
}
func publicHTTPClient(timeout time.Duration) *http.Client {
	transport := &http.Transport{
		// No environment HTTP proxy: pin the validated address used for the connection.
		TLSHandshakeTimeout: 3 * time.Second, ResponseHeaderTimeout: timeout,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			if port != "80" && port != "443" {
				return nil, errors.New("only public web ports are allowed")
			}
			ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
			if err != nil || len(ips) == 0 {
				return nil, errors.New("host could not be resolved")
			}
			for _, ip := range ips {
				if !allowedIP(ip) {
					return nil, errors.New("private or reserved network destinations are not allowed")
				}
			}
			var last error
			for _, ip := range ips {
				conn, e := (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
				if e == nil {
					return conn, nil
				}
				last = e
			}
			return nil, last
		},
	}
	return &http.Client{Timeout: timeout, Transport: transport, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 || !publicNetworkURL(req.URL.String()) {
			return errors.New("redirect not allowed")
		}
		return nil
	}}
}
func projectURLReachableContext(ctx context.Context, value string) bool {
	if !publicNetworkURL(value) {
		return false
	}
	client := publicHTTPClient(4 * time.Second)
	defer client.CloseIdleConnections()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, value, nil)
	if err != nil {
		return false
	}
	req.Header.Set("User-Agent", "JPano-Portfolio-Status/4.0")
	res, err := client.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	if res.StatusCode == 401 || res.StatusCode == 403 {
		return true
	}
	if res.StatusCode < 200 || res.StatusCode >= 400 {
		return false
	}
	bytes, _ := io.ReadAll(io.LimitReader(res.Body, 96*1024))
	body := strings.ToLower(string(bytes))
	for _, marker := range []string{"cloudflare tunnel error", "error code 1033", "web server is down", "origin is unreachable", "tunnel is currently unavailable"} {
		if strings.Contains(body, marker) {
			return false
		}
	}
	return true
}
