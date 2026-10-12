package main

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type wsConn struct {
	conn net.Conn
	rw   *bufio.ReadWriter
	mu   sync.Mutex
}

func upgradeWebSocket(w http.ResponseWriter, r *http.Request) (*wsConn, error) {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") || !headerContains(r.Header.Get("Connection"), "upgrade") || r.Header.Get("Sec-WebSocket-Version") != "13" {
		return nil, errors.New("invalid websocket upgrade")
	}
	key := strings.TrimSpace(r.Header.Get("Sec-WebSocket-Key"))
	decoded, err := base64.StdEncoding.DecodeString(key)
	if err != nil || len(decoded) != 16 {
		return nil, errors.New("invalid websocket key")
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("websocket unavailable")
	}
	conn, rw, err := hijacker.Hijack()
	if err != nil {
		return nil, err
	}
	sum := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	accept := base64.StdEncoding.EncodeToString(sum[:])
	_, err = rw.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n")
	if err == nil {
		err = rw.Flush()
	}
	if err != nil {
		conn.Close()
		return nil, err
	}
	_ = conn.SetDeadline(time.Time{})
	return &wsConn{conn: conn, rw: rw}, nil
}

func headerContains(value, token string) bool {
	for _, part := range strings.Split(value, ",") {
		if strings.EqualFold(strings.TrimSpace(part), token) {
			return true
		}
	}
	return false
}
func (c *wsConn) close() { _ = c.conn.Close() }

func (c *wsConn) writeFrame(op byte, payload []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(8 * time.Second))
	defer c.conn.SetWriteDeadline(time.Time{})
	first := byte(0x80) | (op & 0x0f)
	if err := c.rw.WriteByte(first); err != nil {
		return err
	}
	n := len(payload)
	switch {
	case n < 126:
		if err := c.rw.WriteByte(byte(n)); err != nil {
			return err
		}
	case n <= 65535:
		if err := c.rw.WriteByte(126); err != nil {
			return err
		}
		var b [2]byte
		binary.BigEndian.PutUint16(b[:], uint16(n))
		if _, err := c.rw.Write(b[:]); err != nil {
			return err
		}
	default:
		if err := c.rw.WriteByte(127); err != nil {
			return err
		}
		var b [8]byte
		binary.BigEndian.PutUint64(b[:], uint64(n))
		if _, err := c.rw.Write(b[:]); err != nil {
			return err
		}
	}
	if _, err := c.rw.Write(payload); err != nil {
		return err
	}
	return c.rw.Flush()
}
func (c *wsConn) writeText(payload []byte) error { return c.writeFrame(0x1, payload) }
func (c *wsConn) writeJSON(payload []byte) error { return c.writeText(payload) }

func (c *wsConn) readText() ([]byte, error) {
	for {
		_ = c.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		h := make([]byte, 2)
		if _, err := io.ReadFull(c.rw, h); err != nil {
			return nil, err
		}
		fin := h[0]&0x80 != 0
		op := h[0] & 0x0f
		masked := h[1]&0x80 != 0
		n := uint64(h[1] & 0x7f)
		if !fin {
			return nil, errors.New("fragmented websocket frames are not supported")
		}
		if n == 126 {
			var b [2]byte
			if _, err := io.ReadFull(c.rw, b[:]); err != nil {
				return nil, err
			}
			n = uint64(binary.BigEndian.Uint16(b[:]))
		}
		if n == 127 {
			var b [8]byte
			if _, err := io.ReadFull(c.rw, b[:]); err != nil {
				return nil, err
			}
			n = binary.BigEndian.Uint64(b[:])
		}
		if n > 65536 {
			return nil, errors.New("websocket frame too large")
		}
		if !masked {
			return nil, errors.New("client websocket frame must be masked")
		}
		var mask [4]byte
		if _, err := io.ReadFull(c.rw, mask[:]); err != nil {
			return nil, err
		}
		payload := make([]byte, n)
		if _, err := io.ReadFull(c.rw, payload); err != nil {
			return nil, err
		}
		for i := range payload {
			payload[i] ^= mask[i%4]
		}
		switch op {
		case 0x1:
			return payload, nil
		case 0x8:
			_ = c.writeFrame(0x8, nil)
			return nil, io.EOF
		case 0x9:
			if err := c.writeFrame(0xA, payload); err != nil {
				return nil, err
			}
		case 0xA:
			continue
		default:
			return nil, errors.New("unsupported websocket frame")
		}
	}
}
