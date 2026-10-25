package vendoralist

import (
	"context"
	"errors"
	"testing"

	"github.com/synctv-org/vendors/api/alist"
)

type searchFixture struct {
	searchErr    error
	searchResult *alist.FsSearchResp
	listErr      error
	pages        []*alist.FsListResp
	listCalls    int
}

func (f *searchFixture) FsSearch(context.Context, *alist.FsSearchReq) (*alist.FsSearchResp, error) {
	return f.searchResult, f.searchErr
}
func (f *searchFixture) FsList(_ context.Context, req *alist.FsListReq) (*alist.FsListResp, error) {
	f.listCalls++
	if req.GetPath() != "/media/TV" {
		return nil, errors.New("searched a different directory")
	}
	if f.listErr != nil {
		return nil, f.listErr
	}
	if int(req.GetPage()) > len(f.pages) {
		return nil, errors.New("unexpected extra page")
	}
	return f.pages[req.GetPage()-1], nil
}

func TestSearchFallbackFiltersWholeDirectoryBeforePagination(t *testing.T) {
	f := &searchFixture{searchErr: errors.New("alist: search not available"), pages: []*alist.FsListResp{
		{Total: 4, Content: []*alist.FsListResp_FsListContent{{Name: "Other"}, {Name: "TARGET 1"}}},
		{Total: 4, Content: []*alist.FsListResp_FsListContent{{Name: "target 2", IsDir: true, Created: 1700000000000, Modified: 1800000000000}, {Name: "Other 2"}}},
	}}
	r, local, err := searchWithFallback(context.Background(), f, &alist.FsSearchReq{Parent: "/media/TV", Keywords: "Target", Page: 2, PerPage: 1})
	if err != nil {
		t.Fatal(err)
	}
	if !local || r.GetTotal() != 2 || len(r.GetContent()) != 1 || r.GetContent()[0].GetName() != "target 2" || r.GetContent()[0].GetParent() != "/media/TV" || !r.GetContent()[0].GetIsDir() || f.listCalls != 2 {
		t.Fatalf("directory search or pagination broken: %v", r)
	}
	if r.GetContent()[0].GetCreated() != 1700000000000 || r.GetContent()[0].GetModified() != 1800000000000 {
		t.Fatal("fallback search discarded source dates")
	}
}

func TestSearchKeepsUpstreamResultsAndErrors(t *testing.T) {
	for _, searchErr := range []error{nil, errors.New("permission denied"), errors.New("upstream timeout")} {
		f := &searchFixture{searchErr: searchErr, searchResult: &alist.FsSearchResp{Total: 1, Content: []*alist.FsSearchResp_FsSearchContent{{Name: "Nested", Parent: "/media/TV/Series"}}}}
		r, local, err := searchWithFallback(context.Background(), f, &alist.FsSearchReq{Parent: "/media/TV", Keywords: "Nested"})
		if local || err != searchErr || r != f.searchResult || f.listCalls != 0 {
			t.Fatal("native search or authorization error was replaced")
		}
	}
}

func TestSearchFallbackKeepsListErrorsAndBounds(t *testing.T) {
	for _, f := range []*searchFixture{
		{searchErr: errors.New("search not available"), listErr: errors.New("directory password required")},
		{searchErr: errors.New("search not available"), pages: []*alist.FsListResp{{Total: 10001}}},
	} {
		if _, _, err := searchWithFallback(context.Background(), f, &alist.FsSearchReq{Parent: "/media/TV", Keywords: "Title"}); err == nil {
			t.Fatal("incomplete or inaccessible directory should not appear empty")
		}
	}
}

func TestSearchResultSubPath(t *testing.T) {
	for _, tc := range []struct{ root, parent, name, expected string }{
		{"/kuake/Media", "/kuake/Media/TV Play-K", "最后的生还者 第2季", "/TV Play-K/最后的生还者 第2季"},
		{"/kuake/Media", "kuake/Media", "Episode.mkv", "/Episode.mkv"},
		{"/", "/media/TV", "Title", "/media/TV/Title"},
	} {
		got, err := searchResultSubPath(tc.root, tc.parent, tc.name)
		if err != nil || got != tc.expected {
			t.Fatalf("got %q, %v; expected %q", got, err, tc.expected)
		}
	}
	if _, err := searchResultSubPath("/media/TV", "/media/TV2", "Title"); err == nil {
		t.Fatal("directory prefix boundary lost")
	}
}
