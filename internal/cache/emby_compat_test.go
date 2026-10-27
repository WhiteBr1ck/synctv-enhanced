package cache

import (
	"net/url"
	"strings"
	"testing"

	"github.com/synctv-org/synctv/internal/model"
	"github.com/synctv-org/vendors/api/emby"
)

func TestAutomaticHDRNeverUsesVideoTranscoding(t *testing.T) {
	source := &emby.MediaSourceInfo{Container: "mkv", MediaStreamInfo: []*emby.MediaStreamInfo{{Type: "Video", Codec: "hevc", VideoRangeType: "HDR10", ColorTransfer: "smpte2084"}}}
	for _, tc := range []struct {
		query  string
		unsafe bool
	}{
		{"VideoCodec=hevc&TranscodeReasons=AudioCodecNotSupported,ContainerNotSupported", false},
		{"VideoCodec=hevc&TranscodeReasons=ContainerBitrateExceedsLimit", true},
		{"VideoCodec=h264&TranscodeReasons=AudioCodecNotSupported", true},
		{"VideoCodec=hevc&AllowVideoStreamCopy=false&TranscodeReasons=AudioCodecNotSupported", true},
		{"VideoCodec=hevc", true},
	} {
		source.TranscodingUrl = "/Videos/episode/master.m3u8?" + tc.query
		if wouldConvertHDR(source.TranscodingUrl, source) != tc.unsafe {
			t.Fatal("HDR conversion classification failed", tc.query)
		}
		u, _ := url.Parse("https://example.test")
		result, err := processMediaSource(source, &model.Movie{}, &EmbyUserCacheData{Host: u.String(), APIKey: "test"}, "episode", u)
		if err != nil {
			t.Fatal(err)
		}
		if tc.unsafe && (result.IsTranscode || !strings.Contains(result.URL, "/stream.mkv")) {
			t.Fatal("unsafe HDR stream offered")
		}
	}
}

func TestCompatibilityRequiresExplicitSDR(t *testing.T) {
	for _, tc := range []struct {
		name, videoRange, rangeType, transfer string
		allowed                               bool
	}{
		{"SDR", "SDR", "SDR", "bt709", true},
		{"old server SDR", "SDR", "", "", true},
		{"unknown", "", "", "", false},
		{"HDR10", "HDR", "HDR10", "smpte2084", false},
		{"HLG", "HDR", "HLG", "arib-std-b67", false},
		{"Dolby Vision", "HDR", "DOVI", "", false},
		{"inconsistent PQ metadata", "SDR", "SDR", "smpte2084", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := &emby.MediaSourceInfo{MediaStreamInfo: []*emby.MediaStreamInfo{{Type: "Video", VideoRange: tc.videoRange, VideoRangeType: tc.rangeType, ColorTransfer: tc.transfer}}}
			raw := "https://media.example/emby/Videos/item/master.m3u8?ApiKey=test&PlaySessionId=old&allowVideoStreamCopy=true&VideoCodec=hevc"
			compat, ok := h264CompatibilityURL(raw, source)
			if ok != tc.allowed {
				t.Fatalf("compatibility allowed=%v", ok)
			}
			if !ok {
				return
			}
			u, _ := url.Parse(compat)
			q := u.Query()
			if q.Get("VideoCodec") != "h264" || q.Get("AllowVideoStreamCopy") != "false" || q.Has("allowVideoStreamCopy") || q.Get("MaxVideoBitDepth") != "8" || q.Get("ApiKey") != "test" || q.Get("SubtitleStreamIndex") != "-1" {
				t.Fatal("wrong compatibility request")
			}
		})
	}
}

func TestEmbySubtitleKeepsASSAndAuthentication(t *testing.T) {
	u, _ := url.Parse("https://media.example/")
	source := &emby.MediaSourceInfo{Id: "source", MediaStreamInfo: []*emby.MediaStreamInfo{{Type: "Subtitle", Codec: "ass", Index: 2, DisplayTitle: "Chinese ASS"}, {Type: "Subtitle", Codec: "subrip", Index: 3, DisplayTitle: "Chinese SRT"}}}
	tracks := processEmbySubtitles(source, "episode", u, "test-token")
	if len(tracks) != 2 || tracks[0].Type != "ass" || tracks[1].Type != "srt" {
		t.Fatal("subtitle formats were lost")
	}
	parsed, _ := url.Parse(tracks[0].URL)
	if parsed.Path != "/emby/Videos/episode/source/Subtitles/2/Stream.ass" || parsed.Query().Get("api_key") != "test-token" {
		t.Fatal("wrong subtitle request")
	}
	if u.Path != "/" || u.RawQuery != "" {
		t.Fatal("subtitle generation mutated the shared source URL")
	}
}
