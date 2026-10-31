package cache

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/synctv-org/synctv/internal/model"
)

func TestAlistSubtitleMoviePathStaysInsideSharedFolder(t *testing.T) {
	for _, tc := range []struct {
		root, sub, want string
		valid           bool
	}{
		{"/media/TV", "/Season/Show.01.mkv", "/media/TV/Season/Show.01.mkv", true},
		{"/", "/Show.01.mkv", "/Show.01.mkv", true},
		{"/media/TV", "../TV2/Show.01.mkv", "", false},
		{"/media/TV", "../../private.srt", "", false},
		{"/media/TV", "", "", false},
	} {
		movie := &model.Movie{MovieBase: model.MovieBase{IsFolder: true, VendorInfo: model.VendorInfo{Alist: &model.AlistStreamingInfo{Path: model.FormatAlistPath("server", tc.root)}}}}
		_, got, err := AlistMoviePath(movie, tc.sub)
		if (err == nil) != tc.valid || (tc.valid && got != tc.want) {
			t.Errorf("%+v: got %q, %v", tc, got, err)
		}
	}
}

func TestSubtitleReadRejectsUnknownLengthOversizedBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		_, _ = w.Write([]byte(strings.Repeat("x", subtitleMaxLength+1)))
	}))
	defer server.Close()
	if _, err := FetchSubtitleContent(context.Background(), server.URL); err == nil {
		t.Fatal("oversized subtitle was silently truncated")
	}
}
