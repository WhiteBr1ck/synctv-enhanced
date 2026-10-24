package emby

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	pb "github.com/synctv-org/vendors/api/emby"
	client "github.com/synctv-org/vendors/vendors/emby"
)

func TestFsListOmitsPlaybackSources(t *testing.T) {
	listed := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/emby/Users/user/Items/library":
			fmt.Fprint(w, `{"Id":"library","Name":"TV","Type":"CollectionFolder","CollectionType":"tvshows","IsFolder":true}`)
		case "/emby/Users/user/Items":
			listed = true
			if strings.Contains(r.URL.Query().Get("Fields"), "MediaSources") {
				t.Error("directory requested playback sources")
			}
			if r.URL.Query().Get("Limit") != "10000" {
				t.Error("batch size was lost")
			}
			if r.URL.Query().Get("EnableImages") != "false" || r.URL.Query().Get("EnableUserData") != "false" {
				t.Error("directory requested unused artwork or watch-state metadata")
			}
			fmt.Fprint(w, `{"Items":[{"Id":"series","Name":"Series 2","Type":"Series","IsFolder":true}],"TotalRecordCount":1}`)
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	service := NewEmbyService(nil)
	result, err := service.FsList(context.Background(), &pb.FsListReq{Host: server.URL, UserId: "user", Token: "test-key", Path: "library", Limit: 10000})
	if err != nil {
		t.Fatal(err)
	}
	if !listed || len(result.GetItems()) != 1 || result.GetItems()[0].GetName() != "Series 2" {
		t.Fatal("directory listing changed")
	}
}

func TestEpisodeDisplayNames(t *testing.T) {
	for _, tc := range []struct{ input, expected string }{
		{`{"Name":"Title","Type":"Episode","IndexNumber":1,"ParentIndexNumber":1}`, "S01E01 · Title"},
		{`{"Name":"Special","Type":"Episode","IndexNumber":2,"ParentIndexNumber":0}`, "S00E02 · Special"},
		{`{"Name":"Double","Type":"Episode","IndexNumber":9,"IndexNumberEnd":10,"ParentIndexNumber":2}`, "S02E09-E10 · Double"},
		{`{"Name":"Title","Type":"Episode","IndexNumber":5}`, "E05 · Title"},
		{`{"Name":"Unknown","Type":"Episode"}`, "Unknown"},
		{`{"Name":"Movie","Type":"Movie","IndexNumber":1}`, "Movie"},
	} {
		var item client.Items
		if err := json.Unmarshal([]byte(tc.input), &item); err != nil {
			t.Fatal(err)
		}
		if got := item2pb(&item).GetName(); got != tc.expected {
			t.Fatalf("got %q, expected %q", got, tc.expected)
		}
	}
}

func TestPlaybackItemLookupKeepsMediaSources(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Query().Get("Fields"), "MediaSources") {
			t.Error("playback sources were removed")
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"Items":[{"Id":"episode","Name":"Episode","Type":"Episode","MediaSources":[{"Id":"source","Container":"mkv"}]}],"TotalRecordCount":1}`)
	}))
	defer server.Close()
	result, err := NewEmbyService(nil).GetItems(context.Background(), &pb.GetItemsReq{Host: server.URL, UserId: "user", Token: "test-key", ParentId: "season"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.GetItems()) != 1 || len(result.GetItems()[0].GetMediaSourceInfo()) != 1 {
		t.Fatal("playback media metadata missing")
	}
}
