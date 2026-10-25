package utils

import "time"

// UnixMillis keeps missing or invalid upstream dates unavailable rather than
// wrapping Go's zero date into a very large unsigned timestamp.
func UnixMillis(value time.Time) uint64 {
	if value.IsZero() || value.UnixMilli() <= 0 {
		return 0
	}
	return uint64(value.UnixMilli())
}
