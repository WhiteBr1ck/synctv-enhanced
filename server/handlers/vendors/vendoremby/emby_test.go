package vendoremby

import (
	"net/url"
	"testing"
)

func TestCompatibilitySessionsArePerViewer(t *testing.T) {
	raw := "https://media.example/master.m3u8?ApiKey=test&PlaySessionId=old"
	one, _ := url.Parse(viewerSourceURL(raw, true))
	two, _ := url.Parse(viewerSourceURL(raw, true))
	if one.Query().Get("PlaySessionId") == two.Query().Get("PlaySessionId") || one.Query().Get("PlaySessionId") == "old" {
		t.Fatal("viewers share an encoder session")
	}
	if one.Query().Get("ApiKey") != "test" || viewerSourceURL(raw, false) != raw {
		t.Fatal("original source changed")
	}
}
