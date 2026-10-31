package vendoralist

import (
	"context"
	"errors"
	"testing"

	"github.com/synctv-org/vendors/api/alist"
)

func TestFolderSubtitlesReadOnlyOneCompleteDirectory(t *testing.T) {
	f := &searchFixture{pages: []*alist.FsListResp{
		{Total: 6, Content: []*alist.FsListResp_FsListContent{{Name: "Show.01.mkv"}, {Name: "Show.01.ass"}, {Name: "folder.ass", IsDir: true}}},
		{Total: 6, Content: []*alist.FsListResp_FsListContent{{Name: "Show.01.zh.srt"}, {Name: "different episode.srt"}, {Name: "Show.01.xml"}}},
	}}
	tracks, err := listFolderSubtitles(context.Background(), f, &alist.FsListReq{Path: "/media/TV"}, "Show.01.mkv")
	if err != nil {
		t.Fatal(err)
	}
	if f.listCalls != 2 || len(tracks) != 3 {
		t.Fatalf("missing directory entries: %v", tracks)
	}
	if tracks[0].MatchRank != 2 || tracks[1].MatchRank != 1 || tracks[2].MatchRank != 0 || tracks[1].Language != "zh" {
		t.Fatalf("wrong automatic candidates: %v", tracks)
	}
}

func TestFolderSubtitlesKeepErrorsAndIncompleteListings(t *testing.T) {
	for _, f := range []*searchFixture{
		{listErr: errors.New("permission denied")},
		{pages: []*alist.FsListResp{{Total: 10001}}},
		{pages: []*alist.FsListResp{{Total: 1}}},
	} {
		if _, err := listFolderSubtitles(context.Background(), f, &alist.FsListReq{Path: "/media/TV"}, "Show.01.mkv"); err == nil {
			t.Fatal("directory failure appeared empty")
		}
	}
}
