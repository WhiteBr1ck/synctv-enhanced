package utils

import (
	"testing"
	"time"
)

func TestUnixMillisKeepsMissingDatesUnknown(t *testing.T) {
	for _, input := range []time.Time{{}, time.UnixMilli(-1), time.UnixMilli(0)} {
		if UnixMillis(input) != 0 {
			t.Fatal("invalid time was wrapped into an unsigned future date")
		}
	}
	if UnixMillis(time.UnixMilli(1700000000123)) != 1700000000123 {
		t.Fatal("millisecond precision lost")
	}
}
