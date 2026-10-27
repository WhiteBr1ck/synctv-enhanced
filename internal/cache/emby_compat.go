package cache

import (
	"net/url"
	"strings"

	"github.com/synctv-org/vendors/api/emby"
)

func originalEmbyURL(account *EmbyUserCacheData, itemID string, source *emby.MediaSourceInfo) (string, error) {
	u, err := url.Parse(account.Host)
	if err != nil {
		return "", err
	}
	u.Path, err = url.JoinPath(u.Path, "emby", "Videos", itemID, "stream."+source.GetContainer())
	if err != nil {
		return "", err
	}
	u.RawQuery = url.Values{"api_key": {account.APIKey}, "Static": {"true"}, "MediaSourceId": {source.GetId()}}.Encode()
	return u.String(), nil
}

// The server's automatic route may still request video conversion (for example
// when its bitrate cap is lower than the movie). Never expose that route for HDR.
func wouldConvertHDR(rawURL string, source *emby.MediaSourceInfo) bool {
	codec := ""
	hdr := false
	for _, stream := range source.GetMediaStreamInfo() {
		if stream.GetType() != "Video" {
			continue
		}
		codec = strings.ToLower(stream.GetCodec())
		value := strings.ToLower(stream.GetVideoRange() + " " + stream.GetVideoRangeType() + " " + stream.GetColorTransfer())
		hdr = strings.Contains(value, "hdr") || strings.Contains(value, "hlg") || strings.Contains(value, "dovi") || strings.Contains(value, "dolby") || strings.Contains(value, "smpte2084") || strings.Contains(value, "arib-std-b67")
		break
	}
	if !hdr {
		return false
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return true
	}
	q := map[string]string{}
	for key, values := range u.Query() {
		if len(values) > 0 {
			q[strings.ToLower(key)] = values[0]
		}
	}
	reasons := strings.ToLower(q["transcodereasons"])
	if q["allowvideostreamcopy"] == "false" || reasons == "" || strings.Contains(reasons, "video") || strings.Contains(reasons, "containerbitrate") {
		return true
	}
	requested := strings.Split(strings.ToLower(q["videocodec"]), ",")[0]
	return codec != "" && requested != "" && requested != codec
}

// The H.264 route is opt-in and only offered for explicitly identified SDR.
// Unknown/HDR/PQ/HLG/Dolby Vision sources must never silently become SDR.
func h264CompatibilityURL(rawURL string, source *emby.MediaSourceInfo) (string, bool) {
	videoFound := false
	for _, stream := range source.GetMediaStreamInfo() {
		if stream.GetType() != "Video" {
			continue
		}
		videoFound = true
		rangeType := stream.GetVideoRangeType()
		if rangeType == "" {
			rangeType = stream.GetVideoRange()
		}
		transfer := strings.ToLower(stream.GetColorTransfer())
		if !strings.EqualFold(rangeType, "SDR") || transfer == "smpte2084" || transfer == "arib-std-b67" {
			return "", false
		}
	}
	if !videoFound {
		return "", false
	}
	u, err := url.Parse(rawURL)
	if err != nil || !strings.HasSuffix(strings.ToLower(u.Path), ".m3u8") {
		return "", false
	}
	q := u.Query()
	// Avoid conflicting duplicate keys: Jellyfin treats query names without case.
	values := map[string]string{"VideoCodec": "h264", "AudioCodec": "aac", "AllowVideoStreamCopy": "false", "AllowAudioStreamCopy": "false", "MaxVideoBitDepth": "8", "h264-profile": "high,main,baseline,constrainedbaseline", "h264-rangetype": "SDR", "SubtitleStreamIndex": "-1", "EnableSubtitlesInManifest": "false"}
	for key, value := range values {
		for existing := range q {
			if strings.EqualFold(existing, key) {
				q.Del(existing)
			}
		}
		q.Set(key, value)
	}
	u.RawQuery = q.Encode()
	return u.String(), true
}
