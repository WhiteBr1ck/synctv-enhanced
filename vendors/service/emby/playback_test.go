package emby

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	pb "github.com/synctv-org/vendors/api/emby"
)

func TestPlaybackDefaultBitrateMatchesDeviceProfile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			MaxStreamingBitrate int
			DeviceProfile       struct{ MaxStreamingBitrate int }
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		if request.MaxStreamingBitrate != request.DeviceProfile.MaxStreamingBitrate || request.MaxStreamingBitrate < 120000000 {
			t.Error("playback silently forces high-bitrate original video into transcoding")
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"MediaSources":[],"PlaySessionId":"test"}`)
	}))
	defer server.Close()
	_, err := NewEmbyService(nil).PlaybackInfo(context.Background(), &pb.PlaybackInfoReq{Host: server.URL, UserId: "user", ItemId: "movie", Token: "test"})
	if err != nil {
		t.Fatal(err)
	}
}

func TestStopEncodingSupportsBothServersAndRequiresSession(t *testing.T) {
	for _, jellyfin := range []bool{false, true} {
		t.Run(fmt.Sprintf("jellyfin=%t", jellyfin), func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Query().Get("PlaySessionId") != "only-this-session" {
					t.Error("cleanup must be scoped to the requested session")
				}
				if r.Method == http.MethodPost && r.URL.Path == "/emby/Videos/ActiveEncodings/Delete" {
					if jellyfin {
						w.WriteHeader(http.StatusNotFound)
					} else {
						w.WriteHeader(http.StatusNoContent)
					}
					return
				}
				if !jellyfin || r.Method != http.MethodDelete || r.URL.Path != "/emby/Videos/ActiveEncodings" || r.URL.Query().Get("DeviceId") == "" {
					t.Error("unexpected cleanup request")
				}
				w.WriteHeader(http.StatusNoContent)
			}))
			defer server.Close()
			service := NewEmbyService(nil)
			request := &pb.DeleteActiveEncodeingsReq{Host: server.URL, Token: "test", PalySessionId: "only-this-session"}
			if _, err := service.DeleteActiveEncodeings(context.Background(), request); err != nil {
				t.Fatal(err)
			}
			want := 1
			if jellyfin {
				want = 2
			}
			if calls != want {
				t.Fatal("cleanup retry count", calls)
			}
			request.PalySessionId = ""
			if _, err := service.DeleteActiveEncodeings(context.Background(), request); err == nil || calls != want {
				t.Fatal("empty session must never reach the server")
			}
		})
	}
}
